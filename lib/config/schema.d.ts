import { z } from 'zod';
declare const stageSchema: z.ZodObject<{
    model: z.ZodString;
    provider: z.ZodOptional<z.ZodString>;
    reasoning_effort: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high", "max"]>>;
    on_failure: z.ZodDefault<z.ZodEnum<["hard_fail", "auto_degrade"]>>;
    fallback_chain: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    model: string;
    reasoning_effort: "off" | "low" | "medium" | "high" | "max";
    on_failure: "hard_fail" | "auto_degrade";
    fallback_chain: string[];
    provider?: string | undefined;
}, {
    model: string;
    provider?: string | undefined;
    reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
    on_failure?: "hard_fail" | "auto_degrade" | undefined;
    fallback_chain?: string[] | undefined;
}>;
export declare const orchestratorConfigSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["auto", "passthrough", "gated"]>>;
    gate: z.ZodDefault<z.ZodObject<{
        passthrough_patterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        orchestrate_patterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        modify_intent_verbs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        short_len: z.ZodDefault<z.ZodNumber>;
        long_len: z.ZodDefault<z.ZodNumber>;
        default: z.ZodDefault<z.ZodEnum<["orchestrate", "passthrough"]>>;
    }, "strip", z.ZodTypeAny, {
        passthrough_patterns: string[];
        orchestrate_patterns: string[];
        modify_intent_verbs: string[];
        short_len: number;
        long_len: number;
        default: "passthrough" | "orchestrate";
    }, {
        passthrough_patterns?: string[] | undefined;
        orchestrate_patterns?: string[] | undefined;
        modify_intent_verbs?: string[] | undefined;
        short_len?: number | undefined;
        long_len?: number | undefined;
        default?: "passthrough" | "orchestrate" | undefined;
    }>>;
    stages: z.ZodOptional<z.ZodObject<{
        plan: z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            fallback_chain: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        } & {
            on_failure: z.ZodDefault<z.ZodEnum<["hard_fail", "auto_degrade"]>>;
            reasoning_effort: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high", "max"]>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            reasoning_effort: "off" | "low" | "medium" | "high" | "max";
            on_failure: "hard_fail" | "auto_degrade";
            fallback_chain: string[];
            provider?: string | undefined;
        }, {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        }>;
        execute: z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            on_failure: z.ZodDefault<z.ZodEnum<["hard_fail", "auto_degrade"]>>;
            fallback_chain: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        } & {
            reasoning_effort: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high", "max"]>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            reasoning_effort: "off" | "low" | "medium" | "high" | "max";
            on_failure: "hard_fail" | "auto_degrade";
            fallback_chain: string[];
            provider?: string | undefined;
        }, {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        }>;
        review: z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            on_failure: z.ZodDefault<z.ZodEnum<["hard_fail", "auto_degrade"]>>;
            fallback_chain: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        } & {
            reasoning_effort: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high", "max"]>>;
            dimensions: z.ZodDefault<z.ZodEnum<["full", "defects_only", "consistency_only"]>>;
            input_token_budget: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            reasoning_effort: "off" | "low" | "medium" | "high" | "max";
            on_failure: "hard_fail" | "auto_degrade";
            fallback_chain: string[];
            dimensions: "full" | "defects_only" | "consistency_only";
            input_token_budget: number;
            provider?: string | undefined;
        }, {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
            dimensions?: "full" | "defects_only" | "consistency_only" | undefined;
            input_token_budget?: number | undefined;
        }>;
        plan_audit: z.ZodOptional<z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodOptional<z.ZodString>;
            reasoning_effort: z.ZodDefault<z.ZodEnum<["off", "low", "medium", "high", "max"]>>;
            on_failure: z.ZodDefault<z.ZodEnum<["hard_fail", "auto_degrade"]>>;
            fallback_chain: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            reasoning_effort: "off" | "low" | "medium" | "high" | "max";
            on_failure: "hard_fail" | "auto_degrade";
            fallback_chain: string[];
            provider?: string | undefined;
        }, {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
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
    }, {
        plan: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        };
        execute: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        };
        review: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
            dimensions?: "full" | "defects_only" | "consistency_only" | undefined;
            input_token_budget?: number | undefined;
        };
        plan_audit?: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        }[] | undefined;
    }>>;
    fix_loop: z.ZodDefault<z.ZodObject<{
        max_cycles: z.ZodDefault<z.ZodNumber>;
        strategy: z.ZodDefault<z.ZodEnum<["incremental", "batch"]>>;
        escalate_after_consecutive_fails: z.ZodDefault<z.ZodNumber>;
        exhausted_delivery: z.ZodDefault<z.ZodEnum<["flagged", "abort"]>>;
        minor_issues: z.ZodDefault<z.ZodEnum<["report_only", "fix"]>>;
    }, "strip", z.ZodTypeAny, {
        max_cycles: number;
        strategy: "incremental" | "batch";
        escalate_after_consecutive_fails: number;
        exhausted_delivery: "flagged" | "abort";
        minor_issues: "report_only" | "fix";
    }, {
        max_cycles?: number | undefined;
        strategy?: "incremental" | "batch" | undefined;
        escalate_after_consecutive_fails?: number | undefined;
        exhausted_delivery?: "flagged" | "abort" | undefined;
        minor_issues?: "report_only" | "fix" | undefined;
    }>>;
    mechanical_verification: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        commands: z.ZodDefault<z.ZodObject<{
            compile: z.ZodOptional<z.ZodString>;
            tests: z.ZodOptional<z.ZodString>;
            lint: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            compile?: string | undefined;
            tests?: string | undefined;
            lint?: string | undefined;
        }, {
            compile?: string | undefined;
            tests?: string | undefined;
            lint?: string | undefined;
        }>>;
        timeout_ms: z.ZodDefault<z.ZodNumber>;
        parallel: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        commands: {
            compile?: string | undefined;
            tests?: string | undefined;
            lint?: string | undefined;
        };
        timeout_ms: number;
        parallel: boolean;
    }, {
        enabled?: boolean | undefined;
        commands?: {
            compile?: string | undefined;
            tests?: string | undefined;
            lint?: string | undefined;
        } | undefined;
        timeout_ms?: number | undefined;
        parallel?: boolean | undefined;
    }>>;
    limits: z.ZodDefault<z.ZodObject<{
        plan_retry_max: z.ZodDefault<z.ZodNumber>;
        exec_retry_max: z.ZodDefault<z.ZodNumber>;
        replan_cycle_max: z.ZodDefault<z.ZodNumber>;
        planning_steps_max: z.ZodDefault<z.ZodNumber>;
        executing_steps_max: z.ZodDefault<z.ZodNumber>;
        execution_log_max: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        plan_retry_max: number;
        exec_retry_max: number;
        replan_cycle_max: number;
        planning_steps_max: number;
        executing_steps_max: number;
        execution_log_max: number;
    }, {
        plan_retry_max?: number | undefined;
        exec_retry_max?: number | undefined;
        replan_cycle_max?: number | undefined;
        planning_steps_max?: number | undefined;
        executing_steps_max?: number | undefined;
        execution_log_max?: number | undefined;
    }>>;
    circuit_breaker: z.ZodDefault<z.ZodObject<{
        total_llm_calls_max: z.ZodDefault<z.ZodNumber>;
        total_tokens_max: z.ZodDefault<z.ZodNumber>;
        wall_clock_max_min: z.ZodDefault<z.ZodNumber>;
        review_dispatch_timeout_ms: z.ZodDefault<z.ZodNumber>;
        audit_dispatch_timeout_ms: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        total_llm_calls_max: number;
        total_tokens_max: number;
        wall_clock_max_min: number;
        review_dispatch_timeout_ms: number;
        audit_dispatch_timeout_ms: number;
    }, {
        total_llm_calls_max?: number | undefined;
        total_tokens_max?: number | undefined;
        wall_clock_max_min?: number | undefined;
        review_dispatch_timeout_ms?: number | undefined;
        audit_dispatch_timeout_ms?: number | undefined;
    }>>;
    budget: z.ZodDefault<z.ZodObject<{
        daily_limit_cny: z.ZodDefault<z.ZodNumber>;
        task_limit_cny: z.ZodDefault<z.ZodNumber>;
        on_exhausted: z.ZodDefault<z.ZodLiteral<"abort">>;
        count_passthrough: z.ZodDefault<z.ZodBoolean>;
        pricing: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            input: number;
            output: number;
        }, {
            input: number;
            output: number;
        }>>>;
        pricing_unknown: z.ZodDefault<z.ZodUnion<[z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            input: number;
            output: number;
        }, {
            input: number;
            output: number;
        }>, z.ZodNull]>>;
    }, "strip", z.ZodTypeAny, {
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
    }, {
        daily_limit_cny?: number | undefined;
        task_limit_cny?: number | undefined;
        on_exhausted?: "abort" | undefined;
        count_passthrough?: boolean | undefined;
        pricing?: Record<string, {
            input: number;
            output: number;
        }> | undefined;
        pricing_unknown?: {
            input: number;
            output: number;
        } | null | undefined;
    }>>;
    visibility: z.ZodDefault<z.ZodObject<{
        progress: z.ZodDefault<z.ZodEnum<["milestone_push", "quiet"]>>;
    }, "strip", z.ZodTypeAny, {
        progress: "milestone_push" | "quiet";
    }, {
        progress?: "milestone_push" | "quiet" | undefined;
    }>>;
    risk_profile: z.ZodDefault<z.ZodObject<{
        sensitive_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        high_diff_lines: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        sensitive_paths: string[];
        high_diff_lines: number;
    }, {
        sensitive_paths?: string[] | undefined;
        high_diff_lines?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
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
}, {
    mode?: "passthrough" | "auto" | "gated" | undefined;
    gate?: {
        passthrough_patterns?: string[] | undefined;
        orchestrate_patterns?: string[] | undefined;
        modify_intent_verbs?: string[] | undefined;
        short_len?: number | undefined;
        long_len?: number | undefined;
        default?: "passthrough" | "orchestrate" | undefined;
    } | undefined;
    stages?: {
        plan: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        };
        execute: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        };
        review: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
            dimensions?: "full" | "defects_only" | "consistency_only" | undefined;
            input_token_budget?: number | undefined;
        };
        plan_audit?: {
            model: string;
            provider?: string | undefined;
            reasoning_effort?: "off" | "low" | "medium" | "high" | "max" | undefined;
            on_failure?: "hard_fail" | "auto_degrade" | undefined;
            fallback_chain?: string[] | undefined;
        }[] | undefined;
    } | undefined;
    fix_loop?: {
        max_cycles?: number | undefined;
        strategy?: "incremental" | "batch" | undefined;
        escalate_after_consecutive_fails?: number | undefined;
        exhausted_delivery?: "flagged" | "abort" | undefined;
        minor_issues?: "report_only" | "fix" | undefined;
    } | undefined;
    mechanical_verification?: {
        enabled?: boolean | undefined;
        commands?: {
            compile?: string | undefined;
            tests?: string | undefined;
            lint?: string | undefined;
        } | undefined;
        timeout_ms?: number | undefined;
        parallel?: boolean | undefined;
    } | undefined;
    limits?: {
        plan_retry_max?: number | undefined;
        exec_retry_max?: number | undefined;
        replan_cycle_max?: number | undefined;
        planning_steps_max?: number | undefined;
        executing_steps_max?: number | undefined;
        execution_log_max?: number | undefined;
    } | undefined;
    circuit_breaker?: {
        total_llm_calls_max?: number | undefined;
        total_tokens_max?: number | undefined;
        wall_clock_max_min?: number | undefined;
        review_dispatch_timeout_ms?: number | undefined;
        audit_dispatch_timeout_ms?: number | undefined;
    } | undefined;
    budget?: {
        daily_limit_cny?: number | undefined;
        task_limit_cny?: number | undefined;
        on_exhausted?: "abort" | undefined;
        count_passthrough?: boolean | undefined;
        pricing?: Record<string, {
            input: number;
            output: number;
        }> | undefined;
        pricing_unknown?: {
            input: number;
            output: number;
        } | null | undefined;
    } | undefined;
    visibility?: {
        progress?: "milestone_push" | "quiet" | undefined;
    } | undefined;
    risk_profile?: {
        sensitive_paths?: string[] | undefined;
        high_diff_lines?: number | undefined;
    } | undefined;
}>;
export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;
export type StageConfig = z.infer<typeof stageSchema>;
/** Merge a session-level stage-model override ({plan: model, ...}, from /orch set) onto a base config. */
export declare function mergeOverride(base: OrchestratorConfig, override: Record<string, string>): OrchestratorConfig;
export {};
//# sourceMappingURL=schema.d.ts.map