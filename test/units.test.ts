import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gate } from '../src/gate/gate.js';
import { orchestratorConfigSchema, mergeOverride } from '../src/config/schema.js';
import { extractFencedPlan, parsePlan } from '../src/protocols/plan.js';
import { routeVerdict, mergeShardedVerdicts } from '../src/protocols/review.js';
import { ModelHealthService } from '../src/router/health.js';
import { ModelRouter } from '../src/router/model-router.js';
import { mapEffort } from '../src/router/effort.js';
import { summarizeTests } from '../src/protocols/mechanical.js';
import { MILESTONES, renderAuditNote } from '../src/visibility/milestones.js';
import { planAuditVerdictSchema, mergeAuditVerdicts, buildAuditPrompt, latestAudit } from '../src/protocols/plan-audit.js';
import type { PlanAuditVerdict } from '../src/protocols/plan-audit.js';
import { BudgetLedger } from '../src/budget/ledger.js';
import { resolvePricingRate, isUnpricedModel } from '../src/engine.js';
import { buildConfigBase, applySettingsOverlay, SETTINGS_NAMESPACE } from '../src/settings/namespace.js';
import type { OrchestratorConfig } from '../src/config/schema.js';
import { orchestratorConfigSchema } from '../src/config/schema.js';

describe('Gate (A9 five-step engine)', () => {
  const gate = new Gate(orchestratorConfigSchema.parse({}).gate);

  it('forced flag wins', () => {
    expect(gate.decide({ text: '什么?', forced: true }).decision).toBe('orchestrate');
  });
  it('passthrough flag second', () => {
    expect(gate.decide({ text: '帮我实现一个功能', passthroughFlag: true }).decision).toBe('passthrough');
  });
  it('question patterns pass through', () => {
    expect(gate.decide({ text: '什么是闭包？' }).decision).toBe('passthrough');
    expect(gate.decide({ text: '帮我看看这段代码' }).decision).toBe('passthrough');
  });
  it('modify intent orchestrates', () => {
    expect(gate.decide({ text: '修复登录 bug' }).decision).toBe('orchestrate');
    expect(gate.decide({ text: '重构这个模块' }).decision).toBe('orchestrate');
  });
  it('short no-verb passes through', () => {
    expect(gate.decide({ text: '今天天气不错' }).decision).toBe('passthrough');
  });
  it('long input orchestrates', () => {
    expect(gate.decide({ text: 'x'.repeat(200) }).decision).toBe('orchestrate');
  });
  it('default conservative orchestrate', () => {
    // 54 chars, no modify verb: past short_len, below long_len → default rule
    const out = gate.decide({ text: '这个项目结构不错啊并且值得深入探讨'.repeat(3) });
    expect(out.rule).toBe('7: default');
    expect(out.decision).toBe('orchestrate');
  });
});

describe('config schema', () => {
  it('defaults: fixer degrades, passthrough not counted', () => {
    const cfg = orchestratorConfigSchema.parse({});
    expect(cfg.budget.count_passthrough).toBe(false); // ADR #27
    expect(cfg.fix_loop.escalate_after_consecutive_fails).toBe(2); // ADR #18
  });
  it('plan stage defaults hard_fail (ADR #2+9)', () => {
    const cfg = orchestratorConfigSchema.parse({ stages: { plan: { model: 'a' }, execute: { model: 'b' }, review: { model: 'c' } } });
    expect(cfg.stages!.plan.on_failure).toBe('hard_fail');
    expect(cfg.stages!.execute.on_failure).toBe('auto_degrade');
    expect(cfg.stages!.review.on_failure).toBe('auto_degrade');
  });
  it('mergeOverride applies stage models', () => {
    const cfg = orchestratorConfigSchema.parse({ stages: { plan: { model: 'a' }, execute: { model: 'b' }, review: { model: 'c' } } });
    const merged = mergeOverride(cfg, { plan: 'x9' });
    expect(merged.stages!.plan.model).toBe('x9');
    expect(merged.stages!.execute.model).toBe('b');
  });
  it('config schema: wall-clock breaker and review dispatch timeout have defaults', () => {
    const cfg = orchestratorConfigSchema.parse({});
    expect(cfg.circuit_breaker.wall_clock_max_min).toBe(30);
    expect(cfg.circuit_breaker.review_dispatch_timeout_ms).toBe(300_000);
  });
});

describe('plan protocol', () => {
  it('extracts the last fenced block', () => {
    const text = '前言\n```plan\n{"a":1}\n```\n中间\n```plan\n{"b":2}\n```\n后记';
    expect(extractFencedPlan(text)).toBe('{"b":2}');
  });
  it('returns null without fence', () => {
    expect(extractFencedPlan('no plan here')).toBeNull();
  });
  it('rejects schema-invalid plans with field paths', () => {
    const r = parsePlan(JSON.stringify({ steps: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('steps');
  });
  it('accepts a valid plan and drops client version', () => {
    const r = parsePlan(JSON.stringify({ version: 99, steps: [{ id: '1', title: 't' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 5 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.steps[0]!.title).toBe('t');
  });
});

describe('review routing (v5.0 §4.3 mechanical rules)', () => {
  const v = (over: Partial<Parameters<typeof routeVerdict>[0]>) => ({
    planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [], ...over,
  });
  it('confident execution → fail-exec', () => {
    expect(routeVerdict(v({}), true).route).toBe('review/fail-exec');
  });
  it('confident plan → fail-plan', () => {
    expect(routeVerdict(v({ defect_type: 'plan' }), true).route).toBe('review/fail-plan');
  });
  it('low confidence → ambiguous', () => {
    expect(routeVerdict(v({ confidence: 0.5 }), true).route).toBe('review/ambiguous');
  });
  it('pass + mechanical fail still routes review/pass (engine flips flag)', () => {
    expect(routeVerdict(v({ pass: true }), false).route).toBe('review/pass');
  });
});

describe('sharded verdict merge (M3)', () => {
  it('merges issues and dedupes ids with chunk suffixes', () => {
    const a = { planVersion: 1, pass: false, defect_type: 'execution' as const, confidence: 0.8, issues: [{ id: 'I1', dimension: 'security' as const, severity: 'blocker' as const, description: 'a' }] };
    const b = { planVersion: 1, pass: false, defect_type: 'plan' as const, confidence: 0.7, issues: [{ id: 'I1', dimension: 'boundary' as const, severity: 'major' as const, description: 'b' }] };
    const m = mergeShardedVerdicts([a, b]);
    expect(m.issues.map((i) => i.id)).toEqual(['I1', 'I1-chunk1']);
    expect(m.defect_type).toBe('plan'); // highest-ranked shard defect
    expect(m.pass).toBe(false);
    expect(m.confidence).toBe(0.7); // min
  });
});

describe('model health (A6)', () => {
  it('marks failed after 3 failures in window, half-opens after cool-down', () => {
    const h = new ModelHealthService();
    h.recordFailure(undefined, 'm', '5xx', 1000);
    h.recordFailure(undefined, 'm', '5xx', 2000);
    expect(h.isFailed(undefined, 'm', 3000)).toBe(false);
    h.recordFailure(undefined, 'm', '5xx', 3000);
    expect(h.isFailed(undefined, 'm', 4000)).toBe(true);
    expect(h.isFailed(undefined, 'm', 1000 * 60 * 10 + 4000)).toBe(false); // half-open
    h.recordSuccess(undefined, 'm');
    expect(h.isFailed(undefined, 'm', 99999999)).toBe(false);
  });
  it('re-closes after a failed half-open probe instead of staying open', () => {
    const h = new ModelHealthService();
    for (const t of [1000, 2000, 3000]) h.recordFailure(undefined, 'm', '5xx', t);
    const cooled = 1000 * 60 * 10 + 4000;
    expect(h.isFailed(undefined, 'm', cooled)).toBe(false); // half-open probe allowed
    h.recordFailure(undefined, 'm', '5xx', cooled); // probe failed → must re-close
    expect(h.isFailed(undefined, 'm', cooled + 1000)).toBe(true);
    expect(h.isFailed(undefined, 'm', cooled + 1000 * 60 * 10)).toBe(false); // next probe window
  });
});

describe('effort mapping', () => {
  it('deepseek medium→high, off supported', () => {
    expect(mapEffort('deepseek-v4-flash', 'medium')).toBe('high');
    expect(mapEffort('deepseek-v4-flash', 'off')).toBe('off');
    expect(mapEffort('deepseek-v4-flash', 'max')).toBe('max');
  });
  it('glm unsupported effort clears', () => {
    expect(mapEffort('glm-5.3', 'off')).toBeUndefined();
    expect(mapEffort('glm-5.3', 'medium')).toBe('medium');
  });
});

describe('mechanical test summary parsers', () => {
  it('parses vitest/jest and mocha styles, falls back to undefined', () => {
    expect(summarizeTests('Tests: 12 passed, 2 failed')).toBe('12 passed, 2 failed');
    expect(summarizeTests('3 passing, 1 failing')).toBe('3 passed, 1 failed');
    expect(summarizeTests('all good')).toBeUndefined();
  });
});

describe('plan-audit protocol (v5.2)', () => {
  const verdict = (over: Partial<PlanAuditVerdict>): PlanAuditVerdict => ({
    passed: true, confidence: 0.9, issues: [], rebuttal_verdicts: [], ...over,
  });
  const issue = (id: string, severity: 'blocker' | 'major' | 'minor', dim: string = 'feasibility') => ({
    id, dimension: dim as any, severity, description: `${id} 描述`, suggestion: `${id} 建议`,
  });

  it('verdict schema: valid passes, weird shapes rejected', () => {
    expect(planAuditVerdictSchema.safeParse(verdict({})).success).toBe(true);
    expect(planAuditVerdictSchema.safeParse({ passed: true, confidence: 2, issues: [] }).success).toBe(false);
    expect(planAuditVerdictSchema.safeParse({ passed: true, confidence: 0.5, issues: [{ id: 'IA1', dimension: 'wrong', severity: 'major', description: 'x', suggestion: 'y' }] }).success).toBe(false);
    expect(planAuditVerdictSchema.safeParse({ passed: true, confidence: 0.5, issues: [{ id: 'IA1', dimension: 'feasibility', severity: 'major', description: 'x' }] }).success).toBe(false); // suggestion required
  });

  it('merge: conservative union — any failing auditor blocks, severity kept at strictest', () => {
    const a = verdict({ passed: true, confidence: 0.9, issues: [issue('IA1', 'major')] });
    const b = verdict({ passed: false, confidence: 0.8, issues: [issue('IA1', 'blocker'), issue('IA2', 'minor', 'risk_coverage')] });
    const m = mergeAuditVerdicts([a, b]);
    expect(m.passed).toBe(false);
    expect(m.confidence).toBe(0.8); // min
    expect(m.issues).toHaveLength(2);
    expect(m.issues.find((i) => i.id === 'IA1')?.severity).toBe('blocker'); // stricter wins
  });

  it('merge: rebuttal accepted only when every auditor accepted (conservative)', () => {
    const a = verdict({ rebuttal_verdicts: [{ id: 'IA1', accepted: true, note: 'ok' }] });
    const b = verdict({ rebuttal_verdicts: [{ id: 'IA1', accepted: false, note: '理由不足' }] });
    const m = mergeAuditVerdicts([a, b]);
    expect(m.rebuttals.find((r) => r.id === 'IA1')?.accepted).toBe(false);
    expect(m.rebuttals.find((r) => r.id === 'IA1')?.note).toContain('理由不足');
  });

  it('merge: passed requires all pass AND min confidence >= 0.7', () => {
    expect(mergeAuditVerdicts([verdict({ confidence: 0.9 }), verdict({ confidence: 0.8 })]).passed).toBe(true);
    expect(mergeAuditVerdicts([verdict({ confidence: 0.9 }), verdict({ confidence: 0.5 })]).passed).toBe(false);
    expect(mergeAuditVerdicts([]).passed).toBe(false);
  });

  it('merge: D1 strict — blocker/major in union blocks even if every auditor passed', () => {
    const sloppy = verdict({ passed: true, confidence: 0.95, issues: [issue('IA9', 'major')] });
    const m = mergeAuditVerdicts([sloppy]);
    expect(m.passed).toBe(false); // conservative resolution of an inconsistent verdict
    const minorsOnly = verdict({ passed: true, confidence: 0.9, issues: [issue('IA2', 'minor', 'granularity')] });
    expect(mergeAuditVerdicts([minorsOnly]).passed).toBe(true); // minors alone do not block
  });

  it('parsePlan captures audit_response when present, absent otherwise', () => {
    const base = { steps: [{ id: '1', title: 't' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 5 };
    const withResp = parsePlan(JSON.stringify({ ...base, audit_response: { adopted: ['IA1'], rebutted: [{ id: 'IA2', justification: '已覆盖' }] } }));
    expect(withResp.ok).toBe(true);
    if (withResp.ok) {
      expect(withResp.auditResponse?.adopted).toEqual(['IA1']);
      expect(withResp.auditResponse?.rebutted[0]?.id).toBe('IA2');
      expect((withResp.plan as Record<string, unknown>).audit_response).toBeUndefined(); // not leaked into the plan doc
    }
    const without = parsePlan(JSON.stringify(base));
    expect(without.ok && !('auditResponse' in without)).toBe(true);
  });

  it('audit prompt: r1 lacks negotiation block, r2 carries previous round context', () => {
    const plan: any = { version: 1, steps: [{ id: '1', title: 't' }], complexity: 'low', review_hint: 'full', risk_level: 'standard' };
    const r1 = buildAuditPrompt({ goal: 'g', plan, auditorIndex: 1, previous: null, response: null });
    expect(r1).toContain('你是独立的计划审计员');
    expect(r1).not.toContain('上轮审计问题');
    const prev = { planVersion: 1, round: 1, issues: [issue('IA1', 'major') as any], adopted: [], rebutted: [], passed: false };
    const r2 = buildAuditPrompt({ goal: 'g', plan, auditorIndex: 2, previous: prev, response: { adopted: ['IA1'], rebutted: [] } });
    expect(r2).toContain('上轮审计问题');
    expect(r2).toContain('IA1');
    expect(r2).toContain('本轮职责');
  });

  it('latestAudit returns tail or null', () => {
    const r = { planVersion: 1, round: 1, issues: [], adopted: [], rebutted: [], passed: true };
    expect(latestAudit([])).toBeNull();
    expect(latestAudit(undefined)).toBeNull();
    expect(latestAudit([r, { ...r, round: 2 }])?.round).toBe(2);
  });

  it('renderAuditNote: silent without audit, factual with rounds/skips', () => {
    const base: any = { planAudit: [], auditSkipped: 0 };
    expect(renderAuditNote(base)).toBe('');
    expect(renderAuditNote({ planAudit: undefined, auditSkipped: undefined } as any)).toBe('');
    expect(renderAuditNote({ ...base, auditSkipped: 2 })).toBe('｜审计放行 2 次');
    const failed: any = { planAudit: [{ passed: false }, { passed: false }], auditSkipped: 0 };
    expect(renderAuditNote(failed)).toBe('｜审计 2 轮（终判不通过）');
    const passed: any = { planAudit: [{ passed: false }, { passed: true }], auditSkipped: 1 };
    expect(renderAuditNote(passed)).toBe('｜审计 2 轮（终判通过），审计放行 1 次');
  });
});

describe('settings namespace layering (v5.3)', () => {
  const mkCfg = (withStages: boolean): OrchestratorConfig =>
    (orchestratorConfigSchema.parse as any)({
      mode: 'auto',
      ...(withStages
        ? {
          stages: {
            plan: { model: 'patch/plan' },
            execute: { model: 'patch/exec' },
            review: { model: 'patch/review' },
          },
        }
        : {}),
      budget: { daily_limit_cny: 50, task_limit_cny: 5 },
    });

  it('buildConfigBase extracts the curated subset incl. plan_audit', () => {
    const cfg = mkCfg(true);
    cfg.stages!.plan_audit = [{ model: 'audit/a', reasoning_effort: 'high', on_failure: 'auto_degrade', fallback_chain: [] }];
    const base = buildConfigBase(cfg);
    expect(base.mode).toBe('auto');
    expect(base.stages?.plan?.model).toBe('patch/plan');
    expect(base.stages?.plan_audit?.[0]?.model).toBe('audit/a');
    expect(base.budget?.daily_limit_cny).toBe(50);
    expect(base.mechanical_verification?.enabled).toBeTypeOf('boolean');
  });

  it('overlay overrides only presented fields (model/effort/provider granular)', () => {
    const cfg = mkCfg(true);
    cfg.stages!.plan.provider = 'wps';
    const out = applySettingsOverlay(cfg, { stages: { plan: { model: 'user/plan-x', provider: 'other' } }, budget: { daily_limit_cny: 99 } });
    expect(out.stages!.plan.model).toBe('user/plan-x');
    expect(out.stages!.plan.provider).toBe('other');
    expect(out.stages!.plan.reasoning_effort).toBe('high'); // untouched
    expect(out.stages!.execute.model).toBe('patch/exec'); // untouched
    expect(out.budget.daily_limit_cny).toBe(99);
    expect(out.budget.task_limit_cny).toBe(5);
    expect(out.mode).toBe('auto');
  });

  it('mode/budget/mechanical overlay applies even without stages in section', () => {
    const out = applySettingsOverlay(mkCfg(false), { mode: 'passthrough', budget: { task_limit_cny: 1 }, mechanical_verification: { enabled: false } });
    expect(out.mode).toBe('passthrough');
    expect(out.budget.task_limit_cny).toBe(1);
    expect(out.mechanical_verification.enabled).toBe(false);
    expect(out.stages).toBeUndefined();
  });

  it('partial trio cannot resurrect stages from an inert base; complete trio can', () => {
    const partial = applySettingsOverlay(mkCfg(false), { stages: { plan: { model: 'a/x' } } });
    expect(partial.stages).toBeUndefined();
    const complete = applySettingsOverlay(mkCfg(false), {
      stages: { plan: { model: 'a/p' }, execute: { model: 'a/e' }, review: { model: 'a/r' } },
    });
    expect(complete.stages?.plan.model).toBe('a/p');
    expect(complete.stages?.plan.reasoning_effort).toBe('high'); // stage-default filled
    expect(complete.stages?.review.dimensions).toBe('full');
  });

  it('emptying all three stage models restores the inert state', () => {
    const out = applySettingsOverlay(mkCfg(true), { stages: { plan: { model: '' }, execute: { model: '' }, review: { model: '' } } });
    expect(out.stages).toBeUndefined();
  });

  it('plan_audit normalization: filters empty rows, caps at 2, empty list removes audit', () => {
    const cfg = mkCfg(true);
    cfg.stages!.plan_audit = [{ model: 'old/a', reasoning_effort: 'high', on_failure: 'auto_degrade', fallback_chain: [] }];
    const sliced = applySettingsOverlay(cfg, {
      stages: {
        plan_audit: [
          { model: 'a1' } as any,
          { model: '' } as any,
          { model: 'a2' } as any,
          { model: 'a3' } as any,
        ],
      },
    });
    expect(sliced.stages!.plan_audit!.map((a) => a.model)).toEqual(['a1', 'a2']);
    expect(sliced.stages!.plan_audit![0].on_failure).toBe('auto_degrade'); // defaults filled
    const removed = applySettingsOverlay(cfg, { stages: { plan_audit: [] } });
    expect(removed.stages!.plan_audit).toBeUndefined();
  });

  it('namespace id is the top-level settings.yaml key', () => {
    expect(SETTINGS_NAMESPACE).toBe('dsh-per');
  });

  it('S2: raw section absent leaf inherits; explicit empty string clears the leaf', () => {
    const cfg = mkCfg(true);
    cfg.stages!.plan.provider = 'wps';
    // absent reasoning_effort => inherit (raw user section semantics)
    const inherit = applySettingsOverlay(cfg, { stages: { plan: { model: 'user/plan' } } });
    expect(inherit.stages!.plan.reasoning_effort).toBe('high');
    // explicit '' clears the provider back to absent
    const cleared = applySettingsOverlay(cfg, { stages: { plan: { provider: '' } } });
    expect(cleared.stages!.plan.provider).toBeUndefined();
  });

  it('S2: resurrection applies stage-specific defaults when the raw trio omits effort/on_failure', () => {
    const out = applySettingsOverlay(mkCfg(false), {
      stages: { plan: { model: 'a/p' }, execute: { model: 'a/e' }, review: { model: 'a/r' } },
    });
    // plan keeps hard_fail + high (not the schema-generic medium/auto_degrade)
    expect(out.stages!.plan.reasoning_effort).toBe('high');
    expect(out.stages!.plan.on_failure).toBe('hard_fail');
    expect(out.stages!.execute.reasoning_effort).toBe('low');
    expect(out.stages!.review.reasoning_effort).toBe('max');
  });
});

describe('model router (v5.3 per-session override isolation)', () => {
  const mkCfg = (): OrchestratorConfig =>
    (orchestratorConfigSchema.parse as any)({
      mode: 'auto',
      stages: {
        plan: { model: 'patch/plan' },
        execute: { model: 'patch/exec' },
        review: { model: 'patch/review' },
      },
    });

  it('resolve applies a session override without mutating the global config', () => {
    const cfg = mkCfg();
    const router = new ModelRouter(() => cfg, new ModelHealthService());
    const { binding } = router.resolve('execute', { override: { execute: 'session/exec' } });
    expect(binding.model).toBe('session/exec');
    // global config untouched
    expect(cfg.stages!.execute.model).toBe('patch/exec');
  });

  it('bindingForState routes per-state with the override applied', () => {
    const cfg = mkCfg();
    const router = new ModelRouter(() => cfg, new ModelHealthService());
    const plan = router.bindingForState('PLANNING', false, 'standard', { plan: 'session/plan' });
    const exec = router.bindingForState('EXECUTING', false, 'standard', { execute: 'session/exec' });
    const review = router.bindingForState('REVIEWING', false, 'standard', { review: 'session/review' });
    expect(plan.binding.model).toBe('session/plan');
    expect(exec.binding.model).toBe('session/exec');
    expect(review.binding.model).toBe('session/review');
  });

  it('empty override falls back to the global config', () => {
    const cfg = mkCfg();
    const router = new ModelRouter(() => cfg, new ModelHealthService());
    const { binding } = router.bindingForState('EXECUTING', false, 'standard');
    expect(binding.model).toBe('patch/exec');
  });
});

describe('milestone templates', () => {
  it('doneFlagged carries the fix-round count and unresolved issues', () => {
    expect(MILESTONES.doneFlagged(3, 2, '2 步 / 1 文件 / 复杂度 low', '¥0.001')).toContain('3 轮修复');
    expect(MILESTONES.doneFlagged(0, 1, 'x', 'y')).toContain('0 轮修复');
    expect(MILESTONES.doneFlagged(3, 2, 'x', 'y')).toContain('仍有 2 个问题未解决');
    expect(MILESTONES.doneFlagged(3, 2, 'x', 'y')).not.toContain('undefined');
  });
  it('reviewResult counts blockers and majors', () => {
    expect(MILESTONES.reviewResult(false, 1, 2, 3)).toContain('1 blocker 2 major 3 minor');
    expect(MILESTONES.reviewResult(true, 0, 0, 0)).toBe('【编排】复核通过 ✓');
  });
  it('P1-12: launching announces a queue hand-off without a phantom step count', () => {
    const msg = MILESTONES.launching('重构认证模块');
    expect(msg).toContain('排队任务启动');
    expect(msg).toContain('重构认证模块');
    // the whole point of the fix: no「计划 0 步」before a plan exists
    expect(msg).not.toContain('计划 0 步');
    expect(msg).not.toContain('开始执行');
    expect(MILESTONES.launching('重构认证模块', '（后续还有 2 个任务排队）')).toContain('2 个任务排队');
    expect(MILESTONES.launching('重构认证模块')).not.toContain('undefined');
  });
  it('P1-12: long goals are clipped; short goals pass through untouched', () => {
    expect(MILESTONES.launching('g'.repeat(60))).toBe(`【编排】排队任务启动：${'g'.repeat(60)}`);
    const clipped = MILESTONES.launching('g'.repeat(80));
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).toContain('g'.repeat(60));
    expect(clipped.length).toBeLessThanOrEqual('【编排】排队任务启动：'.length + 61);
  });
  it('executing still reports the step count once a real plan exists', () => {
    expect(MILESTONES.executing('m', 5)).toContain('计划 5 步');
    expect(MILESTONES.executing('m', 5)).toContain('开始执行');
  });
});

describe('pricing table (P0-03)', () => {
  it('built-in deepseek rates resolve; a configured override wins per model', () => {
    expect(resolvePricingRate({}, 'deepseek-v4-flash')).toEqual({ input: 0.15, output: 0.6 });
    expect(resolvePricingRate({}, 'deepseek-reasoner')).toEqual({ input: 4.0, output: 16.0 });
    expect(resolvePricingRate({ pricing: { 'deepseek-v4-flash': { input: 1, output: 2 } } }, 'deepseek-v4-flash')).toEqual({ input: 1, output: 2 });
    // an unconfigured model is untouched by the override
    expect(resolvePricingRate({ pricing: { 'deepseek-v4-flash': { input: 1, output: 2 } } }, 'deepseek-chat')).toEqual({ input: 2.0, output: 8.0 });
  });

  it('an unpriced model bills null and is reported as unpriced', () => {
    expect(resolvePricingRate({}, 'kimi-k2.5')).toBeNull();
    expect(isUnpricedModel({}, 'kimi-k2.5')).toBe(true);
    expect(isUnpricedModel({}, 'deepseek-v4-flash')).toBe(false);
    expect(isUnpricedModel({ pricing: { 'kimi-k2.5': { input: 1, output: 2 } } }, 'kimi-k2.5')).toBe(false);
  });

  it('pricing_unknown is a fallback only; null keeps the historical ¥0 mode', () => {
    expect(resolvePricingRate({ pricing_unknown: { input: 1, output: 4 } }, 'kimi-k2.5')).toEqual({ input: 1, output: 4 });
    expect(resolvePricingRate({ pricing_unknown: null }, 'kimi-k2.5')).toBeNull();
    // the explicit per-model table beats the catch-all
    expect(resolvePricingRate({ pricing: { 'kimi-k2.5': { input: 3, output: 3 } }, pricing_unknown: { input: 1, output: 4 } }, 'kimi-k2.5')).toEqual({ input: 3, output: 3 });
    // the catch-all never shadows a verified built-in entry
    expect(resolvePricingRate({ pricing_unknown: { input: 1, output: 4 } }, 'deepseek-v4-flash')).toEqual({ input: 0.15, output: 0.6 });
  });

  it('schema defaults to an empty table plus null catch-all (no behaviour change)', () => {
    const b = orchestratorConfigSchema.parse({}).budget;
    expect(b.pricing).toEqual({});
    expect(b.pricing_unknown).toBeNull();
    // the guardrails still default to the shipped numbers
    expect(b.daily_limit_cny).toBe(50.0);
    expect(b.task_limit_cny).toBe(5.0);
  });

  it('rejects negative rates', () => {
    expect(() => orchestratorConfigSchema.parse({ budget: { pricing: { glm: { input: -1, output: 0 } } } })).toThrow();
    expect(() => orchestratorConfigSchema.parse({ budget: { pricing_unknown: { input: 0, output: -2 } } })).toThrow();
  });

  it('P0-03 acceptance: a non-deepseek model can now exhaust the task limit', () => {
    const cfg = orchestratorConfigSchema.parse({
      budget: { task_limit_cny: 0.01, daily_limit_cny: 50, pricing: { 'glm-5.3-flash': { input: 2, output: 10 } } },
    });
    const pricing = { rate: (_p: string | undefined, model: string) => resolvePricingRate(cfg.budget, model) };
    const ledger = new BudgetLedger(tmp(), pricing, () => ({
      dailyLimitCny: cfg.budget.daily_limit_cny,
      taskLimitCny: cfg.budget.task_limit_cny,
      countPassthrough: cfg.budget.count_passthrough,
    }));
    // 100k output tokens at ¥10/M = ¥1.00, against a ¥0.01 task budget
    const res = ledger.debit('t1', 'execute', 'zhipu', 'glm-5.3-flash', 10_000, 100_000);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('task_exhausted');
  });

  it('regression: without a configured price the same call stays at ¥0 and never exhausts', () => {
    const cfg = orchestratorConfigSchema.parse({ budget: { task_limit_cny: 0.01 } });
    const pricing = { rate: (_p: string | undefined, model: string) => resolvePricingRate(cfg.budget, model) };
    const ledger = new BudgetLedger(tmp(), pricing, () => ({
      dailyLimitCny: cfg.budget.daily_limit_cny,
      taskLimitCny: cfg.budget.task_limit_cny,
      countPassthrough: cfg.budget.count_passthrough,
    }));
    const res = ledger.debit('t1', 'execute', 'zhipu', 'glm-5.3-flash', 10_000, 100_000);
    expect(res.ok).toBe(true);
    expect(res.taskSpent).toBe(0);
    // this is exactly the situation the one-time notice is meant to surface
    expect(isUnpricedModel(cfg.budget, 'glm-5.3-flash')).toBe(true);
  });
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-per-pricing-'));
}
