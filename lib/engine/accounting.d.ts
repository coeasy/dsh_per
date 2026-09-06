import type { TaskEventName } from '../types.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { ChildSessionInfo, EngineCtx } from './ctx.js';
/**
 * Verified built-in rates (CNY per million tokens) — the deepseek family only,
 * the four values the plugin shipped with. Everything else is left unpriced
 * unless configured: a guessed rate would make the daily/task limit fire at the
 * wrong amount, which is the same guardrail failure as ¥0 (P0-03). Users add
 * their own numbers via `budget.pricing` (per model) or `budget.pricing_unknown`
 * (a single conservative fallback for every unpriced model).
 */
export declare const BUILTIN_PRICING: Record<string, {
    input: number;
    output: number;
}>;
export interface PricingConfigLike {
    pricing?: Record<string, {
        input: number;
        output: number;
    }>;
    pricing_unknown?: {
        input: number;
        output: number;
    } | null;
}
/** Effective rate lookup: `budget.pricing` > built-in table > `budget.pricing_unknown` > null (¥0). */
export declare function resolvePricingRate(cfg: PricingConfigLike, model: string): {
    input: number;
    output: number;
} | null;
/** True when a model would bill ¥0 — the CNY limits above it cannot fire. */
export declare function isUnpricedModel(cfg: PricingConfigLike, model: string): boolean;
/**
 * Debit one assistant message and evaluate the circuit breakers.
 *
 * @returns the transition event the core should fire, or `null` for "nothing to
 *          do" — `budget/exhausted` on a depleted task/daily budget,
 *          `circuit/broken` on a token or call count overflow.
 */
export declare function accountUsage(ctx: EngineCtx, task: OrchestratorTask | undefined, child: ChildSessionInfo | undefined, sessionId: string, usage: {
    inputTokens: number;
    outputTokens: number;
}): TaskEventName | null;
//# sourceMappingURL=accounting.d.ts.map