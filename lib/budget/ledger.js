import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** Daily day-keys retained in budget.json (v4: bounded growth). */
const RETENTION_DAYS = 30;
export class BudgetLedger {
    dataDir;
    pricing;
    limits;
    now;
    state = { daily: {}, tasks: {}, ledger: [] };
    dirty = false;
    constructor(dataDir, pricing, limits, 
    /** wall clock seam (v4): injectable so ledger day-rollover is testable */
    now = Date.now) {
        this.dataDir = dataDir;
        this.pricing = pricing;
        this.limits = limits;
        this.now = now;
        mkdirSync(this.dataDir, { recursive: true });
        this.load();
    }
    get file() {
        return join(this.dataDir, 'budget.json');
    }
    load() {
        try {
            if (existsSync(this.file)) {
                this.state = JSON.parse(readFileSync(this.file, 'utf8'));
            }
        }
        catch {
            this.state = { daily: {}, tasks: {}, ledger: [] };
        }
    }
    flush() {
        if (!this.dirty)
            return;
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
            renameSync(tmp, this.file); // atomic swap: readers never see a half-written file
            this.dirty = false;
        }
        catch {
            // flush failure is non-fatal; in-memory state remains authoritative
        }
    }
    dayKey(at = this.now()) {
        return new Date(at).toISOString().slice(0, 10);
    }
    daily(at = this.now()) {
        const key = this.dayKey(at);
        if (!this.state.daily[key])
            this.state.daily[key] = { day: key, orchestrated: 0, passthrough: 0 };
        return this.state.daily[key];
    }
    taskSpent(taskId) {
        return this.state.tasks[taskId] ?? 0;
    }
    /**
     * Drop per-task spend entries no longer tracked in memory (bounded budget
     * file growth on long-lived hosts). Daily totals are the authoritative
     * limit; per-task records are diagnostic. Daily day-keys older than the
     * 30-day retention window are dropped with them (v4: the daily map used to
     * grow one key per day forever).
     */
    pruneTasks(keep) {
        for (const id of Object.keys(this.state.tasks)) {
            if (!keep.has(id)) {
                delete this.state.tasks[id];
                this.dirty = true;
            }
        }
        const cutoff = new Date(this.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
        for (const key of Object.keys(this.state.daily)) {
            if (key < cutoff) {
                delete this.state.daily[key];
                this.dirty = true;
            }
        }
        if (this.dirty)
            this.flush();
    }
    passthroughToday(at = this.now()) {
        return this.daily(at).passthrough;
    }
    estimatedToday(at = this.now()) {
        return this.daily(at).orchestrated;
    }
    /** Record passthrough observation (report only; not against hard limits by default). */
    observePassthrough(model, inputTokens, outputTokens) {
        const rate = this.pricing.rate(undefined, model);
        const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
        this.daily().passthrough += cost;
        this.dirty = true;
        this.flush();
    }
    debit(taskId, stage, provider, model, inputTokens, outputTokens) {
        const rate = this.pricing.rate(provider, model);
        const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
        const { dailyLimitCny, taskLimitCny, countPassthrough } = this.limits();
        const day = this.daily();
        if (stage !== 'passthrough') {
            const taskSpent = (this.state.tasks[taskId ?? '_global'] ?? 0) + cost;
            if (taskId && taskSpent > taskLimitCny) {
                return { ok: false, reason: 'task_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId), utilization: day.orchestrated / dailyLimitCny };
            }
            if (day.orchestrated + cost > dailyLimitCny) {
                return { ok: false, reason: 'daily_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId ?? '_global'), utilization: day.orchestrated / dailyLimitCny };
            }
            day.orchestrated += cost;
            if (taskId)
                this.state.tasks[taskId] = taskSpent;
        }
        else {
            // ADR #27 (revised, v4): passthrough is observed per-day unconditionally;
            // with `count_passthrough: true` it ALSO bills against the daily hard
            // limit, so a passthrough-heavy day blocks new orchestration tasks (the
            // launch pre-check reads the same total). `false` (default) keeps the
            // historic observe-only behaviour.
            day.passthrough += cost;
            if (countPassthrough && day.orchestrated + cost > dailyLimitCny) {
                return { ok: false, reason: 'daily_exhausted', dailySpent: day.orchestrated, taskSpent: 0, utilization: day.orchestrated / dailyLimitCny };
            }
            if (countPassthrough)
                day.orchestrated += cost;
        }
        this.state.ledger.push({ taskId, stage, provider, model, inputTokens, outputTokens, costCny: cost, at: this.now() });
        if (this.state.ledger.length > 5000)
            this.state.ledger = this.state.ledger.slice(-4000);
        this.dirty = true;
        this.flush();
        return { ok: true, dailySpent: day.orchestrated, taskSpent: taskId ? this.taskSpent(taskId) : 0, utilization: day.orchestrated / dailyLimitCny };
    }
}
//# sourceMappingURL=ledger.js.map