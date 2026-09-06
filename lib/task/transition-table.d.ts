import type { TaskEventName, TaskState } from '../types.js';
/**
 * The revised transition table — a 1:1 code transcription of
 * 设计修订-v5.1-变更单 §2. Data-driven so scripts/ci-checks.mjs can verify
 * closure (every reachable event has a rule per non-terminal state), absence
 * of zero-cost cycles, and fallback DAG depth ≤ 2.
 *
 * Guard predicates receive the runtime task wrapper; actions mutate the
 * snapshot and/or invoke hooks (injection, collection, dispatch).
 */
export interface TransitionContext {
    counters: {
        plan_retry: number;
        exec_retry: number;
        replan_cycle: number;
        fix_cycle: number;
        review_supplement: number;
        review_dispatch_retry: number;
    };
    limits: {
        plan_retry_max: number;
        exec_retry_max: number;
        replan_cycle_max: number;
        fix_loop_max: number;
    };
    /** quick-channel guard: review_hint=skip && execErrorCount==0 && risk!=high && mechanical pass */
    quickChannelOk: boolean;
    /** last review verdict said pass but mechanical verification failed */
    mechanicalFailedAfterPass: boolean;
    configValid: boolean;
    budgetOk: boolean;
    planSchemaOk: boolean;
    /**
     * v3 (C2) — `fix_loop.exhausted_delivery: 'abort'`. When true, a fix-cycle
     * that runs out delivers nothing and terminates instead of the default
     * `DONE_FLAGGED` hand-off. Mirrors the engine-side budget flag below.
     */
    fixExhaustionAborts: boolean;
    /** v3 (C5) — `budget.on_exhausted: 'abort'` (the default). */
    budgetExhaustionAborts: boolean;
}
export interface TransitionAction {
    /** hook name invoked by the engine after the state mutation */
    hook?: string;
    /** inline counter mutations applied atomically with the transition */
    counters?: Partial<Record<'plan_retry++' | 'exec_retry++' | 'exec_retry=0' | 'replan_cycle++' | 'fix_cycle++' | 'fix_cycle=0' | 'review_supplement++' | 'review_supplement=0' | 'review_dispatch_retry++' | 'review_dispatch_retry=0' | 'plan_steps=0' | 'execute_steps=0', true>>;
    /** set planningReturnState */
    planningReturnState?: 'PLANNING' | 'RE-PLANNING';
    /** plan version bump */
    planVersionBump?: boolean;
    /** replace pendingFixes from the latest verdict (non-minor) */
    replacePendingFixes?: boolean;
    /** record issue fail streaks from the latest verdict */
    recordStreaks?: boolean;
    /** synthesized blocker issue (plan-defect exhaustion) */
    synthesizePlanDefectIssue?: boolean;
    /** mark degraded=false clears fixEscalated */
    clearFixEscalated?: boolean;
}
export interface TransitionRule {
    to: TaskState;
    guard?: (c: TransitionContext) => boolean;
    /** composite row or global event to try when the guard rejects */
    fallback?: TaskEventName;
    action?: TransitionAction;
}
/**
 * Row keys: exact event names, or `${event}:variant` composite rows. NOTE
 * (P1-07): `fsm.transition` tries the EXACT row first, then guarded variants
 * in definition order — an unguarded exact row shadows all variants of that
 * event (the engine must then emit the composite name explicitly; enforced by
 * ci-checks invariant 5).
 */
export type TransitionTable = Partial<Record<TaskState, Record<string, TransitionRule>>>;
export declare const TRANSITION_TABLE: TransitionTable;
/** Events that are "any non-terminal state" global interrupts. */
export declare const GLOBAL_EVENTS: Record<string, TransitionRule>;
//# sourceMappingURL=transition-table.d.ts.map