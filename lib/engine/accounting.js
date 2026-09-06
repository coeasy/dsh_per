import { isTerminal } from '../types.js';
/**
 * Verified built-in rates (CNY per million tokens) — the deepseek family only,
 * the four values the plugin shipped with. Everything else is left unpriced
 * unless configured: a guessed rate would make the daily/task limit fire at the
 * wrong amount, which is the same guardrail failure as ¥0 (P0-03). Users add
 * their own numbers via `budget.pricing` (per model) or `budget.pricing_unknown`
 * (a single conservative fallback for every unpriced model).
 */
export const BUILTIN_PRICING = {
    'deepseek-v4-flash': { input: 0.15, output: 0.6 },
    'deepseek-v4-pro': { input: 0.42, output: 1.68 },
    'deepseek-chat': { input: 2.0, output: 8.0 },
    'deepseek-reasoner': { input: 4.0, output: 16.0 },
};
/** Effective rate lookup: `budget.pricing` > built-in table > `budget.pricing_unknown` > null (¥0). */
export function resolvePricingRate(cfg, model) {
    return cfg.pricing?.[model] ?? BUILTIN_PRICING[model] ?? cfg.pricing_unknown ?? null;
}
/** True when a model would bill ¥0 — the CNY limits above it cannot fire. */
export function isUnpricedModel(cfg, model) {
    return !(model in (cfg.pricing ?? {})) && !(model in BUILTIN_PRICING);
}
/**
 * Debit one assistant message and evaluate the circuit breakers.
 *
 * @returns the transition event the core should fire, or `null` for "nothing to
 *          do" — `budget/exhausted` on a depleted task/daily budget,
 *          `circuit/broken` on a token or call count overflow.
 */
export function accountUsage(ctx, task, child, sessionId, usage) {
    const { ledger, lastBinding, registry, passthroughObserve } = ctx;
    const cfg = ctx.cfg();
    const binding = lastBinding.get(sessionId);
    const model = binding?.model ?? 'unknown';
    // P0-03: an unpriced model bills ¥0, so daily_limit_cny / task_limit_cny
    // can never fire for it. Surface that once per session cycle instead of
    // letting the limit silently read as "0/5".
    if (model !== 'unknown' && isUnpricedModel(cfg.budget, model)) {
        ctx.noticeOnce(sessionId, `unpriced:${model}`, `【编排】模型 ${model} 未配置单价，本次按 ¥0 记账——日/任务限额对它不生效。请在补丁配置中设置 budget.pricing.${model}（或 budget.pricing_unknown 兜底）。`);
    }
    if (child) {
        const t = registry.get(child.taskId);
        const snap = t?.snapshot;
        if (snap) {
            snap.subTokens[child.role] = (snap.subTokens[child.role] ?? 0) + usage.inputTokens + usage.outputTokens;
            const res = ledger.debit(child.taskId, child.role === 'reviewer' ? 'review' : child.role === 'executor' ? 'execute' : 'plan', binding?.provider, model, usage.inputTokens, usage.outputTokens);
            snap.spentCny = res.taskSpent;
            if (t && !res.ok)
                return 'budget/exhausted';
        }
        return null;
    }
    if (!task || isTerminal(task.state)) {
        if (passthroughObserve.has(sessionId)) {
            // ADR #27 (revised, v4): with `count_passthrough: true` the passthrough
            // usage bills against the daily hard limit via the same debit; hitting
            // the cap does not abort anything (there is no task), it just stops
            // being counted and blocks new orchestration via the launch pre-check.
            if (cfg.budget.count_passthrough) {
                const res = ledger.debit(null, 'passthrough', binding?.provider, model, usage.inputTokens, usage.outputTokens);
                if (!res.ok) {
                    ctx.noticeOnce(sessionId, 'passthrough-budget', '【编排】透传消耗已达今日限额（budget.count_passthrough=true），本次透传不再计入；今日新编排任务将无法启动。');
                }
            }
            else {
                ledger.observePassthrough(model, usage.inputTokens, usage.outputTokens);
            }
        }
        return null;
    }
    const stage = ctx.stageOfState(task.state);
    task.snapshot.stageTokens[stage] += usage.inputTokens + usage.outputTokens;
    const res = ledger.debit(task.id, stage, binding?.provider, model, usage.inputTokens, usage.outputTokens);
    task.snapshot.spentCny = res.taskSpent;
    // circuit breaker (A12: task-level, tokens)
    const totalTokens = Object.values(task.snapshot.stageTokens).reduce((a, b) => a + b, 0);
    if (!res.ok)
        return 'budget/exhausted';
    if (totalTokens > cfg.circuit_breaker.total_tokens_max || task.snapshot.llmCalls > cfg.circuit_breaker.total_llm_calls_max) {
        return 'circuit/broken';
    }
    return null;
}
//# sourceMappingURL=accounting.js.map