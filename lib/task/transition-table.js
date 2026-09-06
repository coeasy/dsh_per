export const TRANSITION_TABLE = {
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
export const GLOBAL_EVENTS = {
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
//# sourceMappingURL=transition-table.js.map