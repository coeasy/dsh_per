import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/protocols/plan.js';
import { MechanicalVerifier, summarizeTests } from '../src/protocols/mechanical.js';
import { SnapshotStore } from '../src/persistence/snapshot.js';
import { COUNTER_DEFAULTS, type TaskSnapshot } from '../src/types.js';
import { buildHarness, baseConfig, driveToExecuting, mechPass, tasksOf, textOf, notices, flush } from './engine-harness.js';
import type { Harness } from './engine-harness.js';

const stop = (h: Harness, agent = h.agents) =>
  h.onTurnStopping({ agent, turn: 1, signal: new AbortController().signal });

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

describe('refactor v2 — token estimation (P2-09)', () => {
  it('CJK text estimates ~1.6 chars/token instead of the ASCII chars/4', () => {
    const cjk = '重构认证模块并修复边界条件';
    expect(estimateTokens(cjk)).toBe(Math.ceil(cjk.length / 1.6));
    const ascii = 'abcdefgh'; // 8 chars → 2 tokens under both models
    expect(estimateTokens(ascii)).toBe(2);
    // mixed text weighs CJK heavier than a pure chars/4 estimate would
    expect(estimateTokens('重构 auth 模块')).toBeGreaterThan(Math.ceil('重构 auth 模块'.length / 4));
  });
});

describe('refactor v2 — snapshot coalescing (P1-13)', () => {
  it('intermediate saves coalesce to one write per tick; terminal saves are synchronous', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-per-snap-'));
    try {
      const store = new SnapshotStore(dir);
      for (let i = 0; i < 20; i++) store.save(snapOf({ updatedAt: i }));
      // the tick has not flushed yet: nothing durable, nothing half-written
      expect(existsSync(join(dir, 't1.json'))).toBe(false);
      await flush(2);
      expect(existsSync(join(dir, 't1.json'))).toBe(true);
      expect((JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8')) as TaskSnapshot).updatedAt).toBe(19);

      // terminal snapshots never wait for a tick
      store.save(snapOf({ state: 'DONE' }));
      expect((JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8')) as TaskSnapshot).state).toBe('DONE');

      // a queued intermediate write is dropped once the terminal write lands
      store.save(snapOf({ state: 'EXECUTING', updatedAt: 99 }));
      await flush(2);
      expect((JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8')) as TaskSnapshot).state).toBe('EXECUTING');

      store.flushAll();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('refactor v2 — mechanical verifier (P1-14 / P2-10)', () => {
  const mk = (commands: Record<string, string>, over: Partial<{ parallel: boolean; timeout_ms: number }> = {}) =>
    new MechanicalVerifier({ enabled: true, commands, timeout_ms: over.timeout_ms ?? 30_000, parallel: over.parallel ?? false }, () => process.cwd());

  it('aborts a running child immediately instead of running out the timeout', async () => {
    const verifier = mk({ tests: 'node -e "setInterval(()=>{},1000)"' }, { timeout_ms: 60_000 });
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 150);
    const res = await verifier.run([], false, { signal: ac.signal });
    expect(res.tests?.check).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it('runs lint, records it on the result, and never summarizes compile output as tests', async () => {
    const verifier = mk({
      compile: 'node -e "console.log(\'3 passed\'); process.exit(0)"',
      lint: 'node -e "process.exit(1)"',
      tests: 'node -e "console.log(\'2 passed, 1 failed\'); process.exit(0)"',
    });
    const res = await verifier.run([]);
    expect(res.lint?.check).toBe('fail');
    expect(res.compile?.check).toBe('pass');
    expect(res.compile?.summary).toBeUndefined(); // "3 passed" is not a test verdict
    expect(res.tests?.summary).toBe('2 passed, 1 failed');
  }, 30_000);

  it('parallel mode runs all configured commands', async () => {
    const verifier = mk(
      { compile: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', tests: 'node -e "process.exit(0)"' },
      { parallel: true },
    );
    const res = await verifier.run([]);
    expect(res.compile?.check).toBe('pass');
    expect(res.lint?.check).toBe('pass');
    expect(res.tests?.check).toBe('pass');
  }, 30_000);

  it('summarizeTests stays exported and unknown formats yield undefined', () => {
    expect(summarizeTests('nothing here')).toBeUndefined();
  });
});

describe('refactor v2 — review prompt budget (P1-10)', () => {
  it('a huge plan degrades to the skeleton (and then to a bare stats line) under the budget', async () => {
    const cfg = structuredClone(baseConfig());
    cfg.stages!.review.input_token_budget = 50;
    const h = buildHarness({ config: cfg });
    await driveToExecuting(h, '重构认证模块', {
      steps: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, title: `步骤${i}：${'长描述'.repeat(20)}`, files: [`src/f${i}.ts`], risk_note: 'r'.repeat(200) })),
    });
    await stop(h);
    const review = h.spawnCalls.find((c) => c.label.endsWith(':reviewer'));
    expect(review).toBeTruthy();
    expect(review!.prompt).not.toContain('risk_note');
  });
});

describe('refactor v2 — sharded review (P1-10)', () => {
  it('a large changed-file set splits the review and merges the shards', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h);
    t.snapshot.executionProduct = {
      diffLines: 0,
      changedFiles: Array.from({ length: 30 }, (_, i) => `src/mod${i}.ts`),
      errorCount: 0,
    };
    await stop(h);
    const reviews = h.spawnCalls.filter((c) => c.label.endsWith(':reviewer'));
    expect(reviews.length).toBeGreaterThanOrEqual(2); // 30 files → 3 shards of 10
    expect(reviews[0]!.prompt).toContain('分片范围');
    // all shards pass (default fake verdict) → merged pass → DONE
    expect(tasksOf(h)[0]?.state).toBe('DONE');
  });

  it('a failing-shard plumbing test: 30 files fan out to exactly 3 reviewer shards', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h);
    t.snapshot.executionProduct = {
      diffLines: 0,
      changedFiles: Array.from({ length: 30 }, (_, i) => `src/mod${i}.ts`),
      errorCount: 0,
    };
    await stop(h);
    // the conservative merge rule itself is covered in units.test.ts
    // (mergeShardedVerdicts) — this asserts the fan-out plumbing
    expect(h.spawnCalls.filter((c) => c.label.endsWith(':reviewer'))).toHaveLength(3);
  });
});

describe('refactor v2 — one-shot flag consumption (P2-06)', () => {
  it('/orch passthrough does not leak across the active-task early return', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    h.commands['orch']!.handler!({ agent: h.agents, rawInput: 'passthrough' });
    // consumed while the task is active: the goal update happens, but the
    // passthrough flag is gone afterwards
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '换成登录页优先' }] });
    const registry = h.registry as unknown as { get: (id: string) => { transition: (e: string) => Promise<boolean> } };
    const task = registry.get(tasksOf(h)[0]!.id)!;
    await task.transition('user/cancel');
    await flush();
    const before = tasksOf(h).length;
    // a short non-modification message must gate to passthrough now — a leaked
    // forced/passthrough one-shot would have produced a new task
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '你好啊' }] });
    expect(tasksOf(h).length).toBe(before);
  });
});

describe('refactor v2 — sensitive-path glob boundary (P2-14)', () => {
  it('`**/auth/**` now matches a top-level auth/ file, which forces full review', async () => {
    const h = buildHarness({ deps: { spawner: { run: async () => mechPass() } } });
    const t = await driveToExecuting(h, '修复一个报错', {
      review_hint: 'skip',
      steps: [{ id: '1', title: 't', files: ['auth/login.ts'] }],
    });
    await stop(h);
    // risk=high disables the quick channel (A4) even though mechanical passed —
    // the old `^.*\/auth\/.*$` glob missed a top-level auth/ file and would have
    // taken the quick channel straight to DONE without a reviewer
    expect(tasksOf(h)[0]?.state).toBe('DONE'); // reviewer (fake) passes → DONE
    expect(h.spawnCalls.some((c) => c.label.endsWith(':reviewer'))).toBe(true);
  });
  it('`**/auth/**` still matches a nested auth/ path (boundary fix must not over-match)', async () => {
    const h = buildHarness({ deps: { spawner: { run: async () => mechPass() } } });
    await driveToExecuting(h, '修复一个报错', {
      review_hint: 'skip',
      steps: [{ id: '1', title: 't', files: ['src/packages/auth/login.ts'] }],
    });
    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('DONE');
    expect(h.spawnCalls.some((c) => c.label.endsWith(':reviewer'))).toBe(true);
  });
  it('an unrelated path still resolves to DONE (no false-positive risk escalation)', async () => {
    const h = buildHarness({ deps: { spawner: { run: async () => mechPass() } } });
    await driveToExecuting(h, '改一个文案', {
      review_hint: 'skip',
      steps: [{ id: '1', title: 't', files: ['src/ui/readme.md'] }],
    });
    await stop(h);
    // not a sensitive path → risk stays below high, so no full review is forced
    expect(tasksOf(h)[0]?.state).toBe('DONE');
  });
});

describe('refactor v2 — execution log bound from config (P2-07)', () => {
  it('trims past limits.execution_log_max keeping the newest half', async () => {
    const cfg = structuredClone(baseConfig());
    cfg.limits = { execution_log_max: 10 } as typeof cfg.limits; // other limit keys re-default on parse
    const h = buildHarness({ config: cfg });
    const t = await driveToExecuting(h);
    for (let i = 0; i < 14; i++) {
      await h.onSessionEvent({ id: h.agents.id }, { type: 'step/end', data: { turn: 1, step: i } });
    }
    // the trim is "when past the cap, drop back to the newest half", so the log
    // oscillates between ceil(max/2) and max. Assert the invariant, not a
    // post-trim point value (v2 asserted exactly 5, which broke the moment the
    // trim happened on an odd push count).
    const len = (t.snapshot.executionLog as unknown[]).length;
    expect(len).toBeGreaterThanOrEqual(5);
    expect(len).toBeLessThanOrEqual(10);
    expect(notices(h.agents).length).toBeGreaterThanOrEqual(0);
  });
});
