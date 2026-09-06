/**
 * Model-routing waterfalls (`agent/request` / `agent/request-error`).
 *
 * Transition stays in the core: both handlers take the core's `fire`
 * (transitionOrLog) and are the only places `model/hard-fail` is emitted from
 * the request path (docs/重构方案-v3.md §2-D).
 */
import { isTerminal } from '../types.js';
export async function onRequest(engine, fire, payload, next) {
    const { agents, requestRetries, lastBinding, registry, router, health, sessionOverrides } = engine;
    const agent = payload.agent;
    const sessionId = agent?.id;
    const resolved = await next();
    if (!sessionId)
        return resolved;
    agents.set(sessionId, agent);
    if (requestRetries.get(sessionId))
        requestRetries.delete(sessionId); // a request succeeded
    const task = registry.activeForSession(sessionId);
    if (!task || isTerminal(task.state)) {
        lastBinding.set(sessionId, { provider: resolved.provider, model: resolved.model });
        return resolved;
    }
    task.snapshot.llmCalls++;
    const { binding, hardFail } = router.bindingForState(task.state, task.snapshot.fixEscalated, engine.riskOf(task.snapshot), sessionOverrides.get(sessionId));
    if (hardFail) {
        await fire(task, 'model/hard-fail');
        return resolved;
    }
    lastBinding.set(sessionId, { provider: binding.provider ?? resolved.provider, model: binding.model });
    // a successful request clears the model's failure window (health recovery)
    health.recordSuccess(binding.provider ?? resolved.provider, binding.model);
    if (binding.degraded && !task.snapshot.degradedStages.includes(engine.stageOfState(task.state))) {
        task.snapshot.degradedStages.push(engine.stageOfState(task.state)); // audit trail (§11.2)
    }
    const changed = (binding.provider && binding.provider !== resolved.provider) ||
        binding.model !== resolved.model ||
        binding.reasoningEffort !== undefined;
    if (!changed)
        return resolved;
    return {
        ...resolved,
        provider: binding.provider ?? resolved.provider,
        model: binding.model,
        ...(binding.reasoningEffort === undefined ? {} : { reasoningEffort: binding.reasoningEffort }),
    };
}
export async function onRequestError(engine, fire, payload, next) {
    const { requestRetries, lastBinding, registry, router, health, sessionOverrides } = engine;
    const sessionId = payload.agent?.id;
    const provider = payload.provider;
    const failure = payload.failure;
    if (sessionId) {
        const binding = lastBinding.get(sessionId);
        health.recordFailure(provider, binding?.model ?? 'unknown', failure?.code ?? 'unknown');
        // consecutive-failure cap: after 3 own-recovery retries in a row, surface
        // the error instead of looping (a config error would retry forever)
        const retries = (requestRetries.get(sessionId) ?? 0) + 1;
        requestRetries.set(sessionId, retries);
        const task = registry.activeForSession(sessionId);
        if (retries <= 3 && task && !isTerminal(task.state)) {
            const { hardFail } = router.bindingForState(task.state, task.snapshot.fixEscalated, engine.riskOf(task.snapshot), sessionOverrides.get(sessionId));
            if (hardFail) {
                await fire(task, 'model/hard-fail');
                return next();
            }
            engine.noticeOnce(sessionId, `degrade:${failure?.code ?? 'unknown'}`, `【编排】模型请求失败（${failure?.code ?? 'unknown'}），自动重试（${retries}/3）；连续失败将按健康链降级`);
            return { kind: 'retry' }; // own recovery: bindingForState applies the degraded chain on the retry
        }
    }
    return next();
}
//# sourceMappingURL=request.js.map