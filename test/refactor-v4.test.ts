import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetLedger, type Pricing } from '../src/budget/ledger.js';
import { buildFixDirectiveFromMechanical, mechSummary } from '../src/engine/prompts.js';
import { applySettingsOverlay, buildConfigBase } from '../src/settings/namespace.js';
import { baseConfig, buildHarness, driveToExecuting, notices, tasksOf } from './engine-harness.js';
import { COUNTER_DEFAULTS, type MechanicalResult, type TaskSnapshot } from '../src/types.js';
import type { OrchestratorTask } from '../src/task/fsm.js';

afterEach(() => {
  // engine-harness registers its own cleanup; nothing extra here
});

const snapOf = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id: 't1',
  sessionId: 's1',
  parentTaskId: null,
  goal: 'g',
  state: 'EXECUTING',
  counters: { ...COUNTER_DEFAULTS },
  planningReturnState: 'PLANNING',
  stageSteps: { plan: 0, execute: 0, review: 0 },
  stageTokens: { plan: 0, execute: 0, review: 0 },
  subTokens: {},
  plan: null,
  planVersion: 0,
  planDigested: false,
  executionLog: [],
  executionProduct: null,
  reviewHistory: [],
  pendingFixes: [],
  userDirectives: [],
  issueFailStreak: {},
  fixEscalated: false,
  degradedStages: [],
  mechanicalResult: null,
  gateDecision: null,
  spentCny: 0,
  abandoned: false,
  needReplan: false,
  execErrorCount: 0,
  llmCalls: 0,
  planAudit: [],
  auditSkipped: 0,
  startedAt: 0,
  updatedAt: 0,
  ...over,
});

const rate: Pricing = { rate: () => ({ input: 1, output: 1 }) }; // 1 CNY per million tokens

describe('v4 — budget.count_passthrough (F1/V4-1)', () => {
  const mk = (countPassthrough: boolean, now?: () => number) =>
    new BudgetLedger(
      mkdtempSync(join(tmpdir(), 'dsh-per-led-')),
      rate,
      () => ({ dailyLimitCny: 5, taskLimitCny: 5, countPassthrough }),
      now,
    );

  it('default (false): passthrough usage is observed only and never bills the daily limit', () => {
    const led = mk(false);
    const res = led.debit(null, 'passthrough', undefined, 'm', 1_000_000, 1_000_000);
    expect(res.ok).toBe(true);
    expect(led.estimatedToday()).toBe(0);
    expect(led.passthroughToday()).toBe(2);
  });

  it('true: passthrough usage bills the daily limit and can exhaust it', () => {
    const led = mk(true);
    const first = led.debit(null, 'passthrough', undefined, 'm', 2_000_000, 2_000_000);
    expect(first.ok).toBe(true);
    expect(led.estimatedToday()).toBe(4);
    const over = led.debit(null, 'passthrough', undefined, 'm', 2_000_000, 2_000_000);
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('daily_exhausted');
  });

  it('engine wiring: a passthrough session under count_passthrough grows estimatedToday', async () => {
    const cfg = structuredClone(baseConfig());
    cfg.budget = { count_passthrough: true, daily_limit_cny: 5 }; // partial budget: engine re-defaults on parse
    const h = buildHarness({ config: cfg });
    // a session with no active task becomes a passthrough observer on gating
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '你好啊' }] });
    // register a priced binding so the debit is non-zero
    await h.onRequest({ agent: h.agents }, async () => ({ provider: 'prov', model: 'deepseek-v4-flash' }));
    await h.onSessionEvent({ id: h.agents.id }, { type: 'assistant/message', data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }, message: { content: [{ type: 'text', text: '答' }] } } });
    expect((h.ledger as { estimatedToday(): number }).estimatedToday()).toBeCloseTo(0.75, 6); // deepseek-v4-flash: 1M in ×0.15 + 1M out ×0.6
  });
});

describe('v4 — daily retention window (F4/V4-4)', () => {
  it('pruneTasks drops daily keys older than 30 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-per-led2-'));
    try {
      const now = Date.now();
      let t = now;
      const led = new BudgetLedger(dir, rate, () => ({ dailyLimitCny: 5, taskLimitCny: 5, countPassthrough: false }), () => t);
      for (let d = 0; d < 40; d++) {
        t = now - d * 86_400_000; // walk backwards: day d is d days ago
        led.observePassthrough('m', 10, 10);
      }
      t = now; // prune evaluates the retention window against "today"
      led.pruneTasks(new Set());
      const state = (led as unknown as { state: { daily: Record<string, unknown> } }).state;
      const keys = Object.keys(state.daily).sort();
      // the cutoff day itself (exactly 30 days ago) is retained: 40 daily keys → 31
      expect(keys.length).toBe(31);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('v4 — clock seam through fsm/ledger (F3/V4-3)', () => {
  it('OrchestratorTask stamps startedAt/updatedAt from the injected clock', async () => {
    const { OrchestratorTask } = await import('../src/task/fsm.js');
    let t = 1_000_000;
    const task = new OrchestratorTask({
      id: 't', sessionId: 's', goal: 'g',
      hooks: {}, limits: { plan_retry_max: 2, exec_retry_max: 2, replan_cycle_max: 3, fix_loop_max: 3 },
      now: () => (t += 1000),
    });
    expect(task.snapshot.startedAt).toBe(1_001_000);
    await task.transition('task/launch'); // IDLE guard: configValid && budgetOk default true
    // constructor already consumed one tick for `updatedAt`; the transition stamps the next
    expect(task.snapshot.updatedAt).toBe(1_003_000);
  });
});

describe('v4 — lint in mechanical summaries (F2/V4-2)', () => {
  const mech: MechanicalResult = {
    ranAt: 0,
    compile: { check: 'pass' },
    lint: { check: 'fail', tail: 'src/a.ts:1 no-unused-vars' },
    tests: { check: 'pass', summary: '3 passed, 0 failed' },
  };
  const task = { snapshot: snapOf({ mechanicalResult: mech }) } as OrchestratorTask;

  it('mechSummary includes the lint segment', () => {
    const line = mechSummary(task.snapshot);
    expect(line).toContain('lint:fail');
    expect(line).toContain('tests:pass(3 passed, 0 failed)');
  });

  it('the mechanical-miss fix directive carries the lint failure tail', () => {
    const text = buildFixDirectiveFromMechanical(task);
    expect(text).toContain('lint fail');
    expect(text).toContain('no-unused-vars');
  });
});

describe('v4 — pricing in the settings seam (F10/V4-10)', () => {
  it('buildConfigBase carries pricing and the overlay replaces it wholesale', () => {
    const cfg = structuredClone(baseConfig());
    cfg.budget = { pricing: { 'glm-5': { input: 2, output: 8 } } }; // partial budget: engine re-defaults on parse
    const base = buildConfigBase(cfg);
    expect(base.budget?.pricing).toEqual({ 'glm-5': { input: 2, output: 8 } });

    const out = applySettingsOverlay(cfg, { budget: { pricing: { 'kimi-k2.5': { input: 4, output: 16 } } } });
    expect(out.budget.pricing).toEqual({ 'kimi-k2.5': { input: 4, output: 16 } });
    // an absent pricing key inherits the base wholesale
    const inherited = applySettingsOverlay(cfg, { mode: 'gated' });
    expect(inherited.budget.pricing).toEqual({ 'glm-5': { input: 2, output: 8 } });
  });

  it('buildSaveOps writes the pricing record and unsets when back to base', async () => {
    // web/src/client.js is a CJS factory body in a type:module package — load
    // it through an explicit CJS module shim
    const { readFileSync } = await import('node:fs');
    // react is provided by the host shell at runtime, not installed here —
    // a createElement stub suffices because buildSaveOps never renders
    const react = { createElement: (...args: unknown[]) => ({ $$stub: args }) };
    const src = readFileSync(join(process.cwd(), 'web', 'src', 'client.js'), 'utf8');
    const mod = { exports: {} as Record<string, unknown> };
    new Function('require', 'module', 'exports', src)(
      (name: string) => (name === 'react' ? react : undefined),
      mod,
      mod.exports,
    );
    const client = mod.exports as Record<string, any>;
    const base = { budget: { daily_limit_cny: 5, task_limit_cny: 5, pricing: { 'glm-5': { input: 2, output: 8 } } } };
    const draft = client.makeDraft({ budget: { ...base.budget, pricingRows: undefined } });
    // simulate the user editing one row's output price
    draft.budget.pricingRows = [{ model: 'glm-5', input: '2', output: '9' }];
    const ops = client.buildSaveOps(draft, { base, user: {} });
    const setPricing = ops.find((o: { path: string[] }) => o.path.join('.') === 'budget.pricing');
    expect(setPricing).toBeTruthy();
    expect(setPricing.value).toEqual({ 'glm-5': { input: 2, output: 9 } });
    // back to base → unset (re-inherit)
    draft.budget.pricingRows = [{ model: 'glm-5', input: '2', output: '8' }];
    const ops2 = client.buildSaveOps(draft, { base, user: { budget: { pricing: { 'glm-5': { input: 2, output: 9 } } } } });
    expect(ops2.find((o: { path: string[] }) => o.path.join('.') === 'budget.pricing')?.op).toBe('unset');
  });
});
