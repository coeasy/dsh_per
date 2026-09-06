/**
 * Plan-audit gate (docs/重构方案-v3.md §2-D).
 *
 * Spawns up to two auditor children in parallel and merges their verdicts
 * conservatively; runAuditGateIfPending is the turn-end decision that fires
 * plan/ok / plan/fail / plan/retry — through the core fire callback,
 * so the FSM call graph stays auditable in engine.ts.
 */
import type { OrchestratorConfig } from '../config/schema.js';
import type { PlanAuditResponse } from '../protocols/plan.js';
import { latestAudit, type MergedAudit } from '../protocols/plan-audit.js';
import { type PlanAuditRound } from '../types.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { AnyAgent, EngineCtx, TransitionFn } from './ctx.js';
/** Resolve an auditor's own model, walking its fallback chain on health failure. */
export declare function bindAuditor(ctx: EngineCtx, cfg: {
    model: string;
    provider?: string;
    fallback_chain: string[];
}): {
    model: string;
    provider?: string;
} | null;
/**
 * Spawn up to two auditor subagents in parallel (spike-verified: the
 * in-process driver locks per child, concurrent runs do not interact).
 * Each child uses the same outputSchema structured contract as the reviewer.
 * Returns null when NO usable verdict could be produced (fail-open signal).
 */
export declare function dispatchPlanAuditors(ctx: EngineCtx, task: OrchestratorTask, agent: AnyAgent, signal: AbortSignal, cfgs: NonNullable<OrchestratorConfig['stages']>['plan_audit'], previous: PlanAuditRound | null, response: PlanAuditResponse | null): Promise<{
    merged: MergedAudit;
    skipped: number;
} | null>;
export { latestAudit };
/**
 * The audit gate at turn's end: runs when the fence parser parked a plan
 * (pendingPlanAudit) and auditors are configured. Returns true when the turn
 * is fully handled (gate cleared or failed the plan); false → fall through
 * to the legacy planning/replanning paths. Transitions go through the core's
 * `fire` callback.
 */
export declare function runAuditGateIfPending(engine: EngineCtx, fire: TransitionFn, task: OrchestratorTask, agent: AnyAgent, signal: AbortSignal): Promise<boolean>;
//# sourceMappingURL=audit.d.ts.map