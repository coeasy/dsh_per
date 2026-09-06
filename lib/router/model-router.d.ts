import type { ModelBinding, RiskLevel } from '../types.js';
import type { OrchestratorConfig } from '../config/schema.js';
import type { ModelHealthService } from './health.js';
export type StageKey = 'plan' | 'execute' | 'review';
export type StageFailurePolicy = 'hard_fail' | 'auto_degrade';
/**
 * ModelRouter (v5.0 §6, revised): state-driven binding + fault degradation +
 * fixer escalation policy (ADR #28 — fixer degrades, does not inherit plan
 * hard_fail).
 */
export declare class ModelRouter {
    private getConfig;
    private health;
    constructor(getConfig: () => OrchestratorConfig, health: ModelHealthService);
    /** Resolve the binding for a stage under current health, applying policy. */
    resolve(stageKey: StageKey, opts?: {
        role?: 'fixer';
        risk?: RiskLevel;
        override?: Record<string, string>;
    }): {
        binding: ModelBinding;
        hardFail: boolean;
    };
    /** Explicit fallback chain, else same-family siblings from the config family map. */
    private chainFor;
    private binding;
    /** Binding for a task state (v5.0 §6.1 modelForState, fixer branch included). */
    bindingForState(state: string, fixEscalated: boolean, risk: RiskLevel, override?: Record<string, string>): {
        binding: ModelBinding;
        hardFail: boolean;
    };
}
//# sourceMappingURL=model-router.d.ts.map