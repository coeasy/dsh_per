import { BudgetLedger } from './budget/ledger.js';
import { isUnpricedModel, resolvePricingRate } from './engine/accounting.js';
import type { AgentHandle, EngineDeps, HostContract } from './host-contract.js';
import { MechanicalVerifier } from './protocols/mechanical.js';
import { ModelHealthService } from './router/health.js';
import { TaskRegistry, TaskScheduler } from './task/registry.js';
export type AnyAgent = AgentHandle;
export { isUnpricedModel, resolvePricingRate };
export declare function createEngine(ctx: HostContract, rawConfig: unknown, deps?: Partial<EngineDeps>): {
    config: {
        mode: "passthrough" | "auto" | "gated";
        gate: {
            passthrough_patterns: string[];
            orchestrate_patterns: string[];
            modify_intent_verbs: string[];
            short_len: number;
            long_len: number;
            default: "passthrough" | "orchestrate";
        };
        fix_loop: {
            max_cycles: number;
            strategy: "incremental" | "batch";
            escalate_after_consecutive_fails: number;
            exhausted_delivery: "flagged" | "abort";
            minor_issues: "report_only" | "fix";
        };
        mechanical_verification: {
            enabled: boolean;
            commands: {
                compile?: string | undefined;
                tests?: string | undefined;
                lint?: string | undefined;
            };
            timeout_ms: number;
            parallel: boolean;
        };
        limits: {
            plan_retry_max: number;
            exec_retry_max: number;
            replan_cycle_max: number;
            planning_steps_max: number;
            executing_steps_max: number;
            execution_log_max: number;
        };
        circuit_breaker: {
            total_llm_calls_max: number;
            total_tokens_max: number;
            wall_clock_max_min: number;
            review_dispatch_timeout_ms: number;
            audit_dispatch_timeout_ms: number;
        };
        budget: {
            daily_limit_cny: number;
            task_limit_cny: number;
            on_exhausted: "abort";
            count_passthrough: boolean;
            pricing: Record<string, {
                input: number;
                output: number;
            }>;
            pricing_unknown: {
                input: number;
                output: number;
            } | null;
        };
        visibility: {
            progress: "milestone_push" | "quiet";
        };
        risk_profile: {
            sensitive_paths: string[];
            high_diff_lines: number;
        };
        stages?: {
            plan: {
                model: string;
                reasoning_effort: "off" | "low" | "medium" | "high" | "max";
                on_failure: "hard_fail" | "auto_degrade";
                fallback_chain: string[];
                provider?: string | undefined;
            };
            execute: {
                model: string;
                reasoning_effort: "off" | "low" | "medium" | "high" | "max";
                on_failure: "hard_fail" | "auto_degrade";
                fallback_chain: string[];
                provider?: string | undefined;
            };
            review: {
                model: string;
                reasoning_effort: "off" | "low" | "medium" | "high" | "max";
                on_failure: "hard_fail" | "auto_degrade";
                fallback_chain: string[];
                dimensions: "full" | "defects_only" | "consistency_only";
                input_token_budget: number;
                provider?: string | undefined;
            };
            plan_audit?: {
                model: string;
                reasoning_effort: "off" | "low" | "medium" | "high" | "max";
                on_failure: "hard_fail" | "auto_degrade";
                fallback_chain: string[];
                provider?: string | undefined;
            }[] | undefined;
        } | undefined;
    };
    registry: TaskRegistry;
    scheduler: TaskScheduler;
    ledger: BudgetLedger;
    health: ModelHealthService;
    verifier: MechanicalVerifier;
};
export type OrchestratorEngine = ReturnType<typeof createEngine>;
//# sourceMappingURL=engine.d.ts.map