import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * BudgetLedger (v5.0 §8.1, adapted to change-set V7/A5/#27): in-process
 * atomic accounting (single-threaded host), durable JSON flush per debit.
 * Subagent tokens bill through the same debit (A5); passthrough tracked
 * separately and not counted against hard limits (#27) unless configured.
 */

export interface DebitResult {
  ok: boolean;
  reason?: 'daily_exhausted' | 'task_exhausted';
  dailySpent: number;
  taskSpent: number;
  utilization: number;
}

export interface LedgerEntry {
  taskId: string | null;
  stage: string;
  provider?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
  at: number;
}

interface DailyState {
  day: string;
  orchestrated: number;
  passthrough: number;
}

interface PersistShape {
  daily: Record<string, DailyState>;
  tasks: Record<string, number>;
  ledger: LedgerEntry[];
}

export interface Pricing {
  /** CNY per million tokens; returns null when unknown (estimated mode). */
  rate(provider: string | undefined, model: string): { input: number; output: number } | null;
}

export class BudgetLedger {
  private state: PersistShape = { daily: {}, tasks: {}, ledger: [] };
  private dirty = false;

  constructor(
    private dataDir: string,
    private pricing: Pricing,
    private limits: () => { dailyLimitCny: number; taskLimitCny: number; countPassthrough: boolean },
  ) {
    mkdirSync(this.dataDir, { recursive: true });
    this.load();
  }

  private get file(): string {
    return join(this.dataDir, 'budget.json');
  }

  private load(): void {
    try {
      if (existsSync(this.file)) {
        this.state = JSON.parse(readFileSync(this.file, 'utf8')) as PersistShape;
      }
    } catch {
      this.state = { daily: {}, tasks: {}, ledger: [] };
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      renameSync(tmp, this.file); // atomic swap: readers never see a half-written file
      this.dirty = false;
    } catch {
      // flush failure is non-fatal; in-memory state remains authoritative
    }
  }

  private dayKey(at = Date.now()): string {
    return new Date(at).toISOString().slice(0, 10);
  }

  daily(at = Date.now()): DailyState {
    const key = this.dayKey(at);
    if (!this.state.daily[key]) this.state.daily[key] = { day: key, orchestrated: 0, passthrough: 0 };
    return this.state.daily[key]!;
  }

  taskSpent(taskId: string): number {
    return this.state.tasks[taskId] ?? 0;
  }

  /**
   * Drop per-task spend entries no longer tracked in memory (bounded budget
   * file growth on long-lived hosts). Daily totals are the authoritative
   * limit; per-task records are diagnostic.
   */
  pruneTasks(keep: ReadonlySet<string>): void {
    for (const id of Object.keys(this.state.tasks)) {
      if (!keep.has(id)) {
        delete this.state.tasks[id];
        this.dirty = true;
      }
    }
    if (this.dirty) this.flush();
  }

  passthroughToday(at = Date.now()): number {
    return this.daily(at).passthrough;
  }

  estimatedToday(at = Date.now()): number {
    return this.daily(at).orchestrated;
  }

  /** Record passthrough observation (report only; not against hard limits by default). */
  observePassthrough(model: string, inputTokens: number, outputTokens: number): void {
    const rate = this.pricing.rate(undefined, model);
    const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
    this.daily().passthrough += cost;
    this.dirty = true;
    this.flush();
  }

  debit(
    taskId: string | null,
    stage: string,
    provider: string | undefined,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): DebitResult {
    const rate = this.pricing.rate(provider, model);
    const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
    const { dailyLimitCny, taskLimitCny, countPassthrough } = this.limits();
    const day = this.daily();
    const againstDaily = stage === 'passthrough' ? countPassthrough : true;

    if (stage !== 'passthrough') {
      const taskSpent = (this.state.tasks[taskId ?? '_global'] ?? 0) + cost;
      if (taskId && taskSpent > taskLimitCny) {
        return { ok: false, reason: 'task_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId), utilization: day.orchestrated / dailyLimitCny };
      }
      if (day.orchestrated + cost > dailyLimitCny) {
        return { ok: false, reason: 'daily_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId ?? '_global'), utilization: day.orchestrated / dailyLimitCny };
      }
      day.orchestrated += cost;
      if (taskId) this.state.tasks[taskId] = taskSpent;
    } else {
      day.passthrough += cost;
      void againstDaily;
    }

    this.state.ledger.push({ taskId, stage, provider, model, inputTokens, outputTokens, costCny: cost, at: Date.now() });
    if (this.state.ledger.length > 5000) this.state.ledger = this.state.ledger.slice(-4000);
    this.dirty = true;
    this.flush();
    return { ok: true, dailySpent: day.orchestrated, taskSpent: taskId ? this.taskSpent(taskId) : 0, utilization: day.orchestrated / dailyLimitCny };
  }
}
