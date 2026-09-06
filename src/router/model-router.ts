import type { ModelBinding, RiskLevel } from '../types.js';
import type { OrchestratorConfig, StageConfig } from '../config/schema.js';
import { mergeOverride } from '../config/schema.js';
import type { ModelHealthService } from './health.js';
import { mapEffort, type InternalEffort } from './effort.js';

export type StageKey = 'plan' | 'execute' | 'review';
export type StageFailurePolicy = 'hard_fail' | 'auto_degrade';

/**
 * ModelRouter (v5.0 §6, revised): state-driven binding + fault degradation +
 * fixer escalation policy (ADR #28 — fixer degrades, does not inherit plan
 * hard_fail).
 */
export class ModelRouter {
  constructor(
    private getConfig: () => OrchestratorConfig,
    private health: ModelHealthService,
  ) {}

  /** Resolve the binding for a stage under current health, applying policy. */
  resolve(
    stageKey: StageKey,
    opts?: { role?: 'fixer'; risk?: RiskLevel; override?: Record<string, string> },
  ): { binding: ModelBinding; hardFail: boolean } {
    const base = this.getConfig();
    const cfg: OrchestratorConfig =
      opts?.override && Object.keys(opts.override).length ? mergeOverride(base, opts.override) : base;
    if (!cfg.stages) return { binding: { model: '' }, hardFail: false };
    const stage: StageConfig = cfg.stages[stageKey];
    // risk=high forbids review degradation (v5.0 §4.3 override rule)
    const allowDegrade =
      !(stageKey === 'review' && opts?.risk === 'high');

    const onFailure: StageFailurePolicy =
      opts?.role === 'fixer'
        ? 'auto_degrade' // #28: fixer role degrades to executor-first chain
        : (stage.on_failure as StageFailurePolicy);

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
  private chainFor(stageKey: StageKey, stage: StageConfig, fixer: boolean, cfg: OrchestratorConfig): string[] {
    if (fixer) {
      const exec = cfg.stages?.execute;
      const chain = [exec?.model, ...stage.fallback_chain].filter((m): m is string => Boolean(m) && m !== stage.model);
      return [...new Set(chain)];
    }
    if (stage.fallback_chain.length > 0) return stage.fallback_chain;
    // empty => same-family automatic fallback: for plan/review use the configured
    // execute model as the light sibling (v5.0 §6.2 hybrid default)
    const exec = cfg.stages?.execute;
    const sibling = stageKey === 'execute' ? cfg.stages?.review?.model : exec?.model;
    return [sibling].filter((m): m is string => Boolean(m) && m !== stage.model);
  }

  private binding(stage: StageConfig): ModelBinding {
    const effort = mapEffort(stage.model, stage.reasoning_effort as InternalEffort);
    const b: ModelBinding = { model: stage.model, reasoningEffort: effort };
    if (stage.provider) b.provider = stage.provider;
    return b;
  }

  /** Binding for a task state (v5.0 §6.1 modelForState, fixer branch included). */
  bindingForState(
    state: string,
    fixEscalated: boolean,
    risk: RiskLevel,
    override?: Record<string, string>,
  ): { binding: ModelBinding; hardFail: boolean } {
    switch (state) {
      case 'PLANNING':
      case 'PLAN_FAIL':
      case 'RE-PLANNING':
        return this.resolve('plan', { override });
      case 'EXECUTING':
        if (fixEscalated) return this.resolve('plan', { role: 'fixer', override });
        return this.resolve('execute', { risk, override });
      case 'REVIEWING':
        return this.resolve('review', { risk, override });
      default:
        return this.resolve('execute', { risk, override });
    }
  }
}
