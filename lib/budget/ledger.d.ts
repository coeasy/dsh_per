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
export interface Pricing {
    /** CNY per million tokens; returns null when unknown (estimated mode). */
    rate(provider: string | undefined, model: string): {
        input: number;
        output: number;
    } | null;
}
export declare class BudgetLedger {
    private dataDir;
    private pricing;
    private limits;
    /** wall clock seam (v4): injectable so ledger day-rollover is testable */
    private now;
    private state;
    private dirty;
    constructor(dataDir: string, pricing: Pricing, limits: () => {
        dailyLimitCny: number;
        taskLimitCny: number;
        countPassthrough: boolean;
    }, 
    /** wall clock seam (v4): injectable so ledger day-rollover is testable */
    now?: () => number);
    private get file();
    private load;
    private flush;
    private dayKey;
    daily(at?: number): DailyState;
    taskSpent(taskId: string): number;
    /**
     * Drop per-task spend entries no longer tracked in memory (bounded budget
     * file growth on long-lived hosts). Daily totals are the authoritative
     * limit; per-task records are diagnostic. Daily day-keys older than the
     * 30-day retention window are dropped with them (v4: the daily map used to
     * grow one key per day forever).
     */
    pruneTasks(keep: ReadonlySet<string>): void;
    passthroughToday(at?: number): number;
    estimatedToday(at?: number): number;
    /** Record passthrough observation (report only; not against hard limits by default). */
    observePassthrough(model: string, inputTokens: number, outputTokens: number): void;
    debit(taskId: string | null, stage: string, provider: string | undefined, model: string, inputTokens: number, outputTokens: number): DebitResult;
}
export {};
//# sourceMappingURL=ledger.d.ts.map