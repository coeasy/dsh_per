import { mergeOverride } from '../config/schema.js';
import { mapEffort } from './effort.js';
/**
 * ModelRouter (v5.0 §6, revised): state-driven binding + fault degradation +
 * fixer escalation policy (ADR #28 — fixer degrades, does not inherit plan
 * hard_fail).
 */
export class ModelRouter {
    getConfig;
    health;
    constructor(getConfig, health) {
        this.getConfig = getConfig;
        this.health = health;
    }
    /** Resolve the binding for a stage under current health, applying policy. */
    resolve(stageKey, opts) {
        const base = this.getConfig();
        const cfg = opts?.override && Object.keys(opts.override).length ? mergeOverride(base, opts.override) : base;
        if (!cfg.stages)
            return { binding: { model: '' }, hardFail: false };
        const stage = cfg.stages[stageKey];
        // risk=high forbids review degradation (v5.0 §4.3 override rule)
        const allowDegrade = !(stageKey === 'review' && opts?.risk === 'high');
        const onFailure = opts?.role === 'fixer'
            ? 'auto_degrade' // #28: fixer role degrades to executor-first chain
            : stage.on_failure;
        const primary = this.binding(stage);
        if (!this.health.isFailed(stage.provider, stage.model)) {
            return { binding: primary, hardFail: false };
        }
        if (onFailure === 'hard_fail' || !allowDegrade) {
            return { binding: primary, hardFail: true };
        }
        const chain = this.chainFor(stageKey, stage, opts?.role === 'fixer', cfg);
        for (const model of chain) {
            const provider = undefined; // family default provider
            if (!this.health.isFailed(provider, model)) {
                return { binding: { ...primary, model, provider, degraded: true }, hardFail: false };
            }
        }
        return { binding: primary, hardFail: true };
    }
    /** Explicit fallback chain, else same-family siblings from the config family map. */
    chainFor(stageKey, stage, fixer, cfg) {
        if (fixer) {
            const exec = cfg.stages?.execute;
            const chain = [exec?.model, ...stage.fallback_chain].filter((m) => Boolean(m) && m !== stage.model);
            return [...new Set(chain)];
        }
        if (stage.fallback_chain.length > 0)
            return stage.fallback_chain;
        // empty => same-family automatic fallback: for plan/review use the configured
        // execute model as the light sibling (v5.0 §6.2 hybrid default)
        const exec = cfg.stages?.execute;
        const sibling = stageKey === 'execute' ? cfg.stages?.review?.model : exec?.model;
        return [sibling].filter((m) => Boolean(m) && m !== stage.model);
    }
    binding(stage) {
        const effort = mapEffort(stage.model, stage.reasoning_effort);
        const b = { model: stage.model, reasoningEffort: effort };
        if (stage.provider)
            b.provider = stage.provider;
        return b;
    }
    /** Binding for a task state (v5.0 §6.1 modelForState, fixer branch included). */
    bindingForState(state, fixEscalated, risk, override) {
        switch (state) {
            case 'PLANNING':
            case 'PLAN_FAIL':
            case 'RE-PLANNING':
                return this.resolve('plan', { override });
            case 'EXECUTING':
                if (fixEscalated)
                    return this.resolve('plan', { role: 'fixer', override });
                return this.resolve('execute', { risk, override });
            case 'REVIEWING':
                return this.resolve('review', { risk, override });
            default:
                return this.resolve('execute', { risk, override });
        }
    }
}
//# sourceMappingURL=model-router.js.map