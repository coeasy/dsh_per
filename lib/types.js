/**
 * Core contracts of the orchestrator plugin.
 * Mirrors 设计修订-v5.1-变更单 (change-set v5.1) — the revised transition table,
 * counters and data models.
 */
export const TERMINAL_STATES = ['DONE', 'DONE_FLAGGED', 'ABORTED'];
export function isTerminal(state) {
    return TERMINAL_STATES.includes(state);
}
export const COUNTER_DEFAULTS = {
    plan_retry: 0,
    exec_retry: 0,
    replan_cycle: 0,
    fix_cycle: 0,
    review_supplement: 0,
    review_dispatch_retry: 0,
};
//# sourceMappingURL=types.js.map