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
  counters?: Partial<
    Record<
      | 'plan_retry++'
      | 'exec_retry++'
      | 'exec_retry=0'
      | 'replan_cycle++'
      | 'fix_cycle++'
      | 'fix_cycle=0'
      | 'review_supplement++'
      | 'review_supplement=0'
      | 'review_dispatch_retry++'
      | 'review_dispatch_retry=0'
      | 'plan_steps=0'
      | 'execute_steps=0',
      true
    >
  >;
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

export const TRANSITION_TABLE: TransitionTable = {
  IDLE: {
    'task/launch': {
      to: 'PLANNING',
      guard: (c) => c.configValid && c.budgetOk, // A14: failure => no task created (handled by engine)
    },
  },

  PLANNING: {
    'plan/ok': {
      to: 'EXECUTING',
      guard: (c) => c.planSchemaOk,
      action: { hook: 'handoffBudgetCheck', planVersionBump: true },
    },
    'plan/fail': {
      to: 'PLAN_FAIL',
      guard: (c) => c.counters.plan_retry < c.limits.plan_retry_max,
      action: { counters: { 'plan_retry++': true }, planningReturnState: 'PLANNING', hook: 'recordPlanFailure' },
      fallback: 'model/hard-fail',
    },
    // A13: planning wandering is a quality failure and consumes plan_retry
    'plan/steps-exceeded': {
      to: 'PLAN_FAIL',
      action: { counters: { 'plan_retry++': true }, planningReturnState: 'PLANNING', hook: 'recordPlanWandering' },
      fallback: 'model/hard-fail',
    },
  },

  PLAN_FAIL: {
    // A2: return to the remembered planning substate (PLANNING or RE-PLANNING)
    'plan/retry': {
      to: 'PLANNING', // engine rewrites target to planningReturnState
      guard: (c) => c.counters.plan_retry < c.limits.plan_retry_max,
      action: { counters: { 'plan_steps=0': true }, hook: 'reinjectPlanningWithError' },
      fallback: 'model/hard-fail',
    },
  },

  EXECUTING: {
    'exec/ok': {
      to: 'REVIEWING',
      action: { hook: 'collectProduct' },
    },
    // A4: quick channel now requires mechanical_pass
    'exec/ok:DONE': {
      to: 'DONE',
      guard: (c) => c.quickChannelOk,
      action: { hook: 'finalizeReport' },
    },
    'exec/need-replan': {
      to: 'RE-PLANNING',
      guard: (c) => c.counters.replan_cycle < c.limits.replan_cycle_max,
      action: { counters: { 'replan_cycle++': true }, hook: 'replanWithNeedReplanFeedback' },
      fallback: 'exec/defect:EXHAUSTED',
    },
    'exec/fail': {
      to: 'EXECUTING',
      guard: (c) => c.counters.exec_retry < c.limits.exec_retry_max,
      action: { counters: { 'exec_retry++': true }, hook: 'retrySamePlan' },
      // retries exhausted => execution-side plan defect track (A1)
      fallback: 'exec/fail:REPLAN',
    },
    // A1: execution-side plan defects route to RE-PLANNING (consumes replan_cycle)
    'exec/fail:REPLAN': {
      to: 'RE-PLANNING',
      guard: (c) => c.counters.exec_retry >= c.limits.exec_retry_max && c.counters.replan_cycle < c.limits.replan_cycle_max,
      action: { counters: { 'replan_cycle++': true }, hook: 'replanWithExecDefectFeedback' },
      fallback: 'exec/defect:EXHAUSTED',
    },
    'exec/steps-exceeded': {
      to: 'RE-PLANNING',
      guard: (c) => c.counters.replan_cycle < c.limits.replan_cycle_max,
      action: { counters: { 'replan_cycle++': true }, hook: 'replanWithGranularityFeedback' },
      fallback: 'exec/defect:EXHAUSTED',
    },
    // plan-defect exhaustion delivers the product flagged with a synthesized blocker (A1)
    'exec/defect:EXHAUSTED': {
      to: 'DONE_FLAGGED',
      action: { synthesizePlanDefectIssue: true, hook: 'deliverFlagged' },
    },
  },

  'RE-PLANNING': {
    'replan/ok': {
      to: 'EXECUTING',
      guard: (c) => c.planSchemaOk,
      action: { counters: { 'exec_retry=0': true, 'fix_cycle=0': true, 'execute_steps=0': true }, planVersionBump: true, clearFixEscalated: true, hook: 'injectSupersedeAndPlan' },
    },
    // A2: replan quality failure falls back to the plan_retry track, remembering return state
    'replan/fail': {
      to: 'PLAN_FAIL',
      guard: (c) => c.counters.plan_retry < c.limits.plan_retry_max,
      action: { counters: { 'plan_retry++': true }, planningReturnState: 'RE-PLANNING', hook: 'recordPlanFailure' },
      // out of plan-quality retries mid-replan: this is replan budget exhaustion,
      // not「model unavailable」as the old `model/hard-fail` fallback reported (P1-05)
      fallback: 'replan/fail:EXHAUSTED',
    },
    'replan/fail:EXHAUSTED': {
      to: 'ABORTED',
      guard: (c) => c.counters.plan_retry >= c.limits.plan_retry_max,
      action: { hook: 'abortReplanExhausted' },
    },
  },

  REVIEWING: {
    'review/pass': {
      to: 'DONE',
      guard: (c) => !c.mechanicalFailedAfterPass,
      action: { counters: { 'review_dispatch_retry=0': true }, recordStreaks: true, hook: 'finalizeReport' },
    },
    // review said pass but mechanical verification failed => reviewer miss (no fix_cycle cost)
    'review/pass:MISS': {
      to: 'EXECUTING',
      guard: (c) => c.mechanicalFailedAfterPass,
      action: { counters: { 'review_dispatch_retry=0': true, 'execute_steps=0': true }, recordStreaks: true, hook: 'fixFromMechanicalMiss' },
    },
    'review/fail-exec': {
      to: 'EXECUTING',
      guard: (c) => c.counters.fix_cycle < c.limits.fix_loop_max,
      action: { counters: { 'fix_cycle++': true, 'execute_steps=0': true }, replacePendingFixes: true, recordStreaks: true, hook: 'injectFixes' },
      fallback: 'review/fail-exec:DONE',
    },
    // C2: fix-cycle exhaustion normally delivers the product flagged; with
    // `fix_loop.exhausted_delivery: 'abort'` it terminates instead. The default
    // guard keeps the historic path as the unguarded-by-default one.
    'review/fail-exec:DONE': {
      to: 'DONE_FLAGGED',
      guard: (c) => !c.fixExhaustionAborts,
      action: { hook: 'deliverFlagged' },
      fallback: 'review/fail-exec:ABORT',
    },
    'review/fail-exec:ABORT': {
      to: 'ABORTED',
      guard: (c) => c.fixExhaustionAborts,
      action: { hook: 'abortFixExhausted' },
    },
    'review/fail-plan': {
      to: 'RE-PLANNING',
      guard: (c) => c.counters.replan_cycle < c.limits.replan_cycle_max,
      action: { counters: { 'replan_cycle++': true }, hook: 'replanWithReviewFeedback' },
      fallback: 'review/fail-plan:DONE',
    },
    'review/fail-plan:DONE': {
      to: 'DONE_FLAGGED',
      action: { hook: 'deliverFlagged' },
    },
    'review/ambiguous': {
      to: 'REVIEWING',
      guard: (c) => c.counters.review_supplement < 1,
      action: { counters: { 'review_supplement++': true } },
    },
    // A2: reviewer dispatch failure — one re-dispatch, then conservative exec-defect
    'review/deadlock': {
      to: 'REVIEWING',
      guard: (c) => c.counters.review_dispatch_retry < 1,
      action: { counters: { 'review_dispatch_retry++': true } },
      fallback: 'review/fail-exec:DONE', // E5: explicit conservative fallback when both retry and fix_cycle are exhausted
    },
    'review/deadlock:EXEC': {
      to: 'EXECUTING',
      guard: (c) => c.counters.fix_cycle < c.limits.fix_loop_max,
      action: { counters: { 'fix_cycle++': true, 'execute_steps=0': true }, replacePendingFixes: true, recordStreaks: true, hook: 'injectFixes' },
      fallback: 'review/fail-exec:DONE',
    },
  },
};

/** Events that are "any non-terminal state" global interrupts. */
export const GLOBAL_EVENTS: Record<string, TransitionRule> = {
  // C5: `budget.on_exhausted` decides between a hard abort and delivering what
  // was produced so far. Both branches stay inside the global-event table so a
  // budget hit mid-execution, mid-review or mid-planning behaves identically.
  'budget/exhausted': {
    to: 'ABORTED',
    guard: (c) => c.budgetExhaustionAborts,
    fallback: 'budget/exhausted:FLAGGED',
    action: { hook: 'abortBudgetExhausted' },
  },
  'budget/exhausted:FLAGGED': {
    to: 'DONE_FLAGGED',
    guard: (c) => !c.budgetExhaustionAborts,
    action: { hook: 'deliverFlagged' },
  },
  'user/cancel': { to: 'ABORTED', action: { hook: 'abortUserCancelled' } },
  'circuit/broken': { to: 'ABORTED', action: { hook: 'abortCircuitBroken' } },
  'model/hard-fail': { to: 'ABORTED', action: { hook: 'abortModelUnavailable' } },
};
