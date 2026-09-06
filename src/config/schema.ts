import { z } from 'zod';

/**
 * Full configuration schema — v5.0 §7.2 as revised by change-set
 * A9 (structured gate), #26 (fenced default), #27 (count_passthrough),
 * #28 (fixer on_failure).
 */

const effortEnum = z.enum(['off', 'low', 'medium', 'high', 'max']);

const stageSchema = z.object({
  model: z.string().min(1),
  provider: z.string().optional(),
  reasoning_effort: effortEnum.default('medium'),
  on_failure: z.enum(['hard_fail', 'auto_degrade']).default('auto_degrade'),
  fallback_chain: z.array(z.string()).default([]),
});

const gateSchema = z.object({
  passthrough_patterns: z.array(z.string()).default([
    '^(什么|为什么|怎么|如何|哪个|是否|能不能|帮我看看|解释|翻译)',
  ]),
  orchestrate_patterns: z.array(z.string()).default([
    '(实现|重构|修复|新增|删除|迁移|编写|开发|优化)',
  ]),
  modify_intent_verbs: z.array(z.string()).default(['改', '加', '删', '重构', '实现', '修复', '写']),
  short_len: z.number().int().positive().default(40),
  long_len: z.number().int().positive().default(200),
  default: z.enum(['orchestrate', 'passthrough']).default('orchestrate'),
});

export const orchestratorConfigSchema = z.object({
  mode: z.enum(['auto', 'passthrough', 'gated']).default('auto'),

  gate: gateSchema.default(gateSchema.parse({})),

  stages: z
    .object({
      plan: stageSchema.extend({
        on_failure: z.enum(['hard_fail', 'auto_degrade']).default('hard_fail'), // ADR #2+9
        reasoning_effort: effortEnum.default('high'),
      }),
      execute: stageSchema.extend({ reasoning_effort: effortEnum.default('low') }),
      review: stageSchema.extend({
        reasoning_effort: effortEnum.default('max'),
        // v3 (C4): which review dimensions the reviewer is asked to check.
        // `full` is the historical behaviour; the narrower modes let a cheap
        // reviewer model be used without silently dropping part of the
        // contract — the prompt declares the dimension set it is working with.
        dimensions: z.enum(['full', 'defects_only', 'consistency_only']).default('full'), // ADR #17
        input_token_budget: z.number().int().positive().default(50000),
      }),
      // v5.2 plan-audit extension: 0-2 plan auditor models; absent/empty → gate disabled
      plan_audit: z.array(stageSchema).max(2).optional(),
    })
    .optional(), // absent => passthrough mode (ADR #13)

  // v3 (C1/C2/C3): every key here is now actually read at runtime. All three
  // were single-value `z.literal` in v2 — parseable, storable, and invisible
  // to the engine, i.e. users believed they were configuring behaviour that
  // did not exist.
  fix_loop: z
    .object({
      max_cycles: z.number().int().min(1).default(3),
      // C1: `incremental` sends one issue list per round (historical);
      // `batch` tells the executor to batch dependent issues into a single
      // convergence pass, trading per-round fidelity for fewer rounds.
      strategy: z.enum(['incremental', 'batch']).default('incremental'),
      escalate_after_consecutive_fails: z.number().int().min(1).default(2),
      // C2: what happens when fix_cycle is exhausted. `flagged` delivers the
      // product with a flag report (historical, safer); `abort` terminates.
      exhausted_delivery: z.enum(['flagged', 'abort']).default('flagged'),
      // C3: `report_only` (historical) keeps minor-severity issues out of the
      // fix queue; `fix` admits them, at the cost of consuming fix rounds.
      minor_issues: z.enum(['report_only', 'fix']).default('report_only'),
    })
    .default({
      max_cycles: 3,
      strategy: 'incremental',
      escalate_after_consecutive_fails: 2,
      exhausted_delivery: 'flagged',
      minor_issues: 'report_only',
    }),

  mechanical_verification: z
    .object({
      enabled: z.boolean().default(true),
      commands: z
        .object({
          compile: z.string().optional(),
          tests: z.string().optional(),
          lint: z.string().optional(),
        })
        .default({}),
      timeout_ms: z.number().int().positive().default(120_000),
      // true => compile/lint/tests run concurrently (opt-in: most test suites
      // depend on the compile output, so serial stays the default)
      parallel: z.boolean().default(false),
    })
    .default({ enabled: true, commands: {}, timeout_ms: 120_000, parallel: false }),

  limits: z
    .object({
      plan_retry_max: z.number().int().min(1).default(2),
      exec_retry_max: z.number().int().min(1).default(2),
      replan_cycle_max: z.number().int().min(1).default(3),
      planning_steps_max: z.number().int().min(1).default(12),
      executing_steps_max: z.number().int().min(1).default(60),
      // audit-trail lines kept in the snapshot (older lines are trimmed)
      execution_log_max: z.number().int().positive().default(200),
    })
    .default({ plan_retry_max: 2, exec_retry_max: 2, replan_cycle_max: 3, planning_steps_max: 12, executing_steps_max: 60, execution_log_max: 200 }),

  circuit_breaker: z
    .object({
      total_llm_calls_max: z.number().int().positive().default(40),
      total_tokens_max: z.number().int().positive().default(800_000),
      wall_clock_max_min: z.number().positive().default(30),
      // one reviewer dispatch (parent turn blocked on the child) — hard ceiling
      // so a hung reviewer child cannot hang the pipeline forever
      review_dispatch_timeout_ms: z.number().int().positive().default(300_000),
      // auditor prompts are shorter than reviewer prompts — separate, smaller ceiling
      audit_dispatch_timeout_ms: z.number().int().positive().default(180_000),
    })
    .default({ total_llm_calls_max: 40, total_tokens_max: 800_000, wall_clock_max_min: 30, review_dispatch_timeout_ms: 300_000, audit_dispatch_timeout_ms: 180_000 }),

  budget: z
    .object({
      daily_limit_cny: z.number().positive().default(50.0),
      task_limit_cny: z.number().positive().default(5.0),
      on_exhausted: z.literal('abort').default('abort'), // ADR #15
      count_passthrough: z.boolean().default(false), // ADR #27 (revised)
      // CNY per million tokens, per model — overrides the built-in table below.
      // A model that ends up unpriced bills ¥0, which silently disables the two
      // limits above for it, so this is how the guardrails start to bite (P0-03).
      pricing: z
        .record(z.string(), z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }))
        .default({}),
      // rates applied to a model present in neither `pricing` nor the built-in
      // table; null keeps the historical ¥0 (estimated) behaviour
      pricing_unknown: z
        .union([z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }), z.null()])
        .default(null),
    })
    .default({ daily_limit_cny: 50.0, task_limit_cny: 5.0, on_exhausted: 'abort', count_passthrough: false, pricing: {}, pricing_unknown: null }),

      // ADR #19: v1 is strictly serial — one running task per host, the rest queued.
      // (The former `concurrency.max_parallel_tasks` key was removed: it was plumbed
      // into the scheduler but never consumed.)

  // v3 (C6): milestone visibility. `milestone_push` is historical; `quiet`
  // only speaks up for terminal states and aborts, keeping the process noise
  // out of the conversation while the task is still running.
  visibility: z
    .object({
      progress: z.enum(['milestone_push', 'quiet']).default('milestone_push'), // ADR #14
    })
    .default({ progress: 'milestone_push' }),

  risk_profile: z
    .object({
      sensitive_paths: z.array(z.string()).default(['**/auth/**', '**/payment/**', '**/security/**']),
      high_diff_lines: z.number().int().positive().default(500),
    })
    .default({ sensitive_paths: ['**/auth/**', '**/payment/**', '**/security/**'], high_diff_lines: 500 }),
});

export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;
export type StageConfig = z.infer<typeof stageSchema>;

/** Merge a session-level stage-model override ({plan: model, ...}, from /orch set) onto a base config. */
export function mergeOverride(base: OrchestratorConfig, override: Record<string, string>): OrchestratorConfig {
  const next = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const m = /^(plan|execute|review)$/.exec(key);
    if (m && next.stages) {
      next.stages[m[1] as 'plan' | 'execute' | 'review'].model = value;
    }
  }
  return next;
}
