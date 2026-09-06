import type { AbortReason, CounterName, PlanDocument, TaskEventName, TaskSnapshot, TaskState } from '../types.js';
/** Async side-effects invoked by transition actions; implemented by the engine. */
export type TaskHook = (task: OrchestratorTask) => Promise<void> | void;
export type TaskHooks = Record<string, TaskHook>;
export interface TaskLimits {
    plan_retry_max: number;
    exec_retry_max: number;
    replan_cycle_max: number;
    fix_loop_max: number;
}
export interface EngineFlags {
    configValid: boolean;
    budgetOk: boolean;
    planSchemaOk: boolean;
    quickChannelOk: boolean;
    mechanicalFailedAfterPass: boolean;
    /** v3 (C2) — `fix_loop.exhausted_delivery: 'abort'` */
    fixExhaustionAborts: boolean;
    /** v3 (C5) — `budget.on_exhausted: 'abort'` */
    budgetExhaustionAborts: boolean;
}
export declare class OrchestratorTask {
    snapshot: TaskSnapshot;
    hooks: TaskHooks;
    limits: TaskLimits;
    flags: EngineFlags;
    illegalTransitions: number;
    /** last plan parse error (fed back into retry prompts) */
    lastPlanError?: string;
    /**
     * v5.2: a schema-valid plan parked until the audit gate clears it at turn's
     * end (runtime-only; the snapshot only learns about the audit afterwards)
     */
    pendingPlanAudit?: {
        response: {
            adopted: string[];
            rebutted: Array<{
                id: string;
                justification: string;
            }>;
        } | null;
    } | undefined;
    /** serialized hook execution to keep transitions ordered per task */
    private queue;
    /** wall clock seam (v4): injectable so transition timestamps are testable */
    private readonly now;
    constructor(init: {
        id: string;
        sessionId: string;
        goal: string;
        parentTaskId?: string | null;
        hooks: TaskHooks;
        limits: TaskLimits;
        flags?: Partial<EngineFlags>;
        gateDecision?: TaskSnapshot['gateDecision'];
        /** defaults to Date.now; the engine injects its clock seam */
        now?: () => number;
    });
    get state(): TaskState;
    get id(): string;
    counter(name: CounterName): number;
    /** Chain an async operation onto the per-task queue. */
    enqueue<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * The single state-transition entry point (v5.0 §3.3, revised by A7).
     * Guard failure follows `fallback` (depth ≤ 2); overflow forces ABORTED.
     * Row resolution: exact row first, then guarded variants (`event:*`) in
     * definition order; the first passing guard wins.
     *
     * The whole body — guard scan, state mutation, action application and the
     * follow-up hook — runs inside ONE per-task queue slot (P0-04), so concurrent
     * `transition()` calls on the same task are strictly ordered. Without this,
     * two async entries racing on one task could read a stale snapshot, double
     * increment a counter or double-apply `recordStreaks`.
     */
    transition(event: TaskEventName, depth?: number): Promise<boolean>;
    /**
     * Transition body. Entered inside a queue slot by `transition()` and
     * recursively by the fallback chain. The recursion must stay on this
     * method and never return to `transition()`: re-entering would append to a
     * queue that is already awaiting this call, deadlocking the task.
     */
    private transitionCore;
    /** Hard abort used by guard overflow / engine-level faults (bypasses table). */
    forceAbort(reason: AbortReason): Promise<boolean>;
    private forceAbortCore;
    private context;
    private applyAction;
    /** Escalation check (ADR #18): any tracked issue failed `>=` threshold consecutively. */
    computeEscalation(threshold: number): boolean;
    /** Attach a parsed plan (plan/ok path helper). */
    attachPlan(plan: Omit<PlanDocument, 'version'>): PlanDocument;
}
//# sourceMappingURL=fsm.d.ts.map