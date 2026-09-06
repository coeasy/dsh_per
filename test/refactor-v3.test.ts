import { describe, expect, it } from 'vitest';
import type { OrchestratorConfig } from '../src/config/schema.js';
import { baseConfig, buildHarness, driveToExecuting, flush, mechPass, notices, tasksOf, textOf, verdict } from './engine-harness.js';
import type { Harness, HarnessTask } from './engine-harness.js';

const stop = (h: Harness, agent = h.agents) =>
  h.onTurnStopping({ agent, turn: 1, signal: new AbortController().signal });

/**
 * `baseConfig()` returns the raw section, not a schema-parsed configuration,
 * and `applySettingsOverlay` deliberately folds only the curated UI section
 * (mode, budget limits, mechanical_verification.enabled, stage leaves). The
 * keys under test here therefore have to be assigned onto the config object
 * directly, the way the P2-07 test assigns `limits`. Stage overrides are
 * merged onto the default trio so the required `model` fields survive.
 */
const cfg = (over: Record<string, unknown> = {}): OrchestratorConfig => {
  const base = baseConfig();
  const out: Record<string, unknown> = { ...base, ...over };
  const overStages = over.stages as Record<string, unknown> | undefined;
  if (base.stages && overStages) {
    const overReview = overStages.review as Record<string, unknown> | undefined;
    out.stages = {
      ...base.stages,
      ...overStages,
      ...(base.stages.review && overReview
        ? { review: { ...base.stages.review, ...overReview } }
        : {}),
    };
  }
  return out as OrchestratorConfig;
};

/** A subagent spec that returns a fixed execution-defect verdict. */
const failVerdictRun = (issues: unknown[]) => () => ({
  id: 'r1',
  result: Promise.resolve({ stopReason: 'completed', structured: verdict({ pass: false, defect_type: 'execution', issues }) }),
  disposed: 0,
  dispose: () => undefined,
});

const ISSUE_MAJOR = { id: 'I1', dimension: 'code_quality', severity: 'major', description: '主缺陷' };
const ISSUE_MINOR = { id: 'I2', dimension: 'test_coverage', severity: 'minor', description: '次要缺陷' };

/** Drive to EXECUTING, then to a review round; returns the resulting task. */
async function fixRound(h: Harness, planOver: Record<string, unknown> = {}): Promise<HarnessTask> {
  await driveToExecuting(h, '重构认证模块', { review_hint: 'full', ...planOver });
  await stop(h); // exec/ok → REVIEWING → verdict (fail-exec) → injectFixes
  await flush();
  return tasksOf(h)[0]!;
}

describe('refactor v3 — stages.review.dimensions (C4)', () => {
  const CASES: Array<[OrchestratorConfig['stages'] extends infer S ? NonNullable<S>['review']['dimensions'] : never, string]> = [
    ['full', '计划符合度 + 代码质量 + 边界条件 + 安全隐患 + 测试覆盖'],
    ['defects_only', '代码质量 + 边界条件 + 安全隐患 + 测试覆盖（本次不评计划符合度）'],
    ['consistency_only', '计划符合度 + 文件改动一致性（本次不评代码质量/边界/安全/测试）'],
  ];

  it.each(CASES)('the reviewer prompt states the %s scope it is working with', async (dimensions, scope) => {
    const h = buildHarness({
      config: cfg({ stages: { review: { dimensions } } }),
      deps: { spawner: { run: async () => mechPass() } },
    });
    await driveToExecuting(h, '重构认证模块');
    await stop(h);
    const prompt = h.spawnCalls.at(-1)?.prompt ?? '';
    expect(prompt).toContain(scope);
    // the scope is declared in-prompt, so a reviewer on a reduced set cannot be
    // judged on issues it was never asked to find
    expect(prompt).toContain('对以下执行产物做复核');
  });
});

describe('refactor v3 — fix_loop.minor_issues (C3)', () => {
  const h = (mode: 'report_only' | 'fix') =>
    buildHarness({
      config: cfg({ fix_loop: { minor_issues: mode } }),
      deps: { spawner: { run: async () => mechPass() } },
      subagents: [failVerdictRun([ISSUE_MAJOR, ISSUE_MINOR])],
    });

  it('report_only keeps minor issues out of the fix queue (historic behaviour)', async () => {
    const t = await fixRound(h('report_only'));
    const ids = t.snapshot.pendingFixes.map((i) => (i as { id: string }).id);
    expect(ids).toContain('I1');
    expect(ids).not.toContain('I2');
  });

  it('fix re-admits minor issues so they consume a real fix round', async () => {
    const t = await fixRound(h('fix'));
    const ids = t.snapshot.pendingFixes.map((i) => (i as { id: string }).id);
    expect(ids).toContain('I1');
    expect(ids).toContain('I2');
  });
});

describe('refactor v3 — fix_loop.strategy (C1)', () => {
  const h = (batch: boolean) =>
    buildHarness({
      config: cfg({ fix_loop: { strategy: batch ? 'batch' : 'incremental' } }),
      deps: { spawner: { run: async () => mechPass() } },
      subagents: [failVerdictRun([ISSUE_MAJOR])],
    });

  it('batch strategy is visible in the fix directive the executor receives', async () => {
    const hh = h(true);
    await fixRound(hh);
    await stop(hh); // the pending fix directive is applied on the next turn
    const steered = hh.agents.steered.map(textOf).join('\n');
    expect(steered).toContain('【修复指令】');
    expect(steered).toContain('批量修复模式');
  });

  it('incremental strategy omits the batch note (default)', async () => {
    const hh = h(false);
    await fixRound(hh);
    await stop(hh);
    const steered = hh.agents.steered.map(textOf).join('\n');
    expect(steered).toContain('【修复指令】');
    expect(steered).not.toContain('批量修复模式');
  });
});

describe('refactor v3 — visibility.progress (C6)', () => {
  it('quiet suppresses in-flight milestones', async () => {
    const h = buildHarness({
      config: cfg({ visibility: { progress: 'quiet' } }),
      deps: { spawner: { run: async () => mechPass() } },
    });
    const before = notices(h.agents).length;
    await driveToExecuting(h, '重构认证模块');
    await stop(h);
    const msgs = notices(h.agents).slice(before).join('\n');
    expect(msgs).not.toContain('开始执行');
    expect(msgs).not.toContain('开始复核');
    expect(msgs).not.toContain('规划完成');
  });

  it('quiet still lets the terminal report through', async () => {
    const h = buildHarness({
      config: cfg({ visibility: { progress: 'quiet' } }),
      deps: { spawner: { run: async () => mechPass() } },
    });
    const before = notices(h.agents).length;
    await driveToExecuting(h, '重构认证模块', { review_hint: 'skip' });
    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('DONE');
    expect(notices(h.agents).slice(before).some((m) => m.includes('任务完成 ✓'))).toBe(true);
  });

  it('quiet keeps warning-prefixed milestones visible', async () => {
    // the quiet filter keys off the ⚠️ prefix that MILESTONES.doneFlagged and
    // MILESTONES.aborted both start with — covered here through a flagged
    // delivery so no fixture needs to fabricate a warning.
    const h = buildHarness({
      config: cfg({ visibility: { progress: 'quiet' }, fix_loop: { max_cycles: 1 } }),
      deps: { spawner: { run: async () => mechPass() } },
      subagents: [failVerdictRun([ISSUE_MAJOR])],
    });
    const before = notices(h.agents).length;
    await fixRound(h);
    await stop(h);
    await flush();
    expect(tasksOf(h)[0]?.state).toBe('DONE_FLAGGED');
    expect(notices(h.agents).slice(before).some((m) => m.startsWith('⚠️【编排】'))).toBe(true);
  });

  it('milestone_push keeps the in-flight chatter (default)', async () => {
    const h = buildHarness({ deps: { spawner: { run: async () => mechPass() } } });
    const before = notices(h.agents).length;
    await driveToExecuting(h, '重构认证模块');
    expect(notices(h.agents).slice(before).join('\n')).toContain('规划完成');
  });
});

describe('refactor v3 — exhaustion delivery policies (C2 engine wiring)', () => {
  it('fix_loop.exhausted_delivery=abort reaches ABORTED instead of DONE_FLAGGED', async () => {
    const h = buildHarness({
      config: cfg({ fix_loop: { max_cycles: 1, exhausted_delivery: 'abort' } }),
      deps: { spawner: { run: async () => mechPass() } },
      subagents: [failVerdictRun([ISSUE_MAJOR])],
    });
    await fixRound(h); // fix_cycle 0 → 1 (budget spent)
    await stop(h); // exec/ok → REVIEWING → next fail verdict hits the ceiling
    await flush();
    const t = tasksOf(h)[0]!;
    expect(t.state).toBe('ABORTED');
    expect(notices(h.agents).join('\n')).toContain('任务终止');
  });

  it('the default flagged policy still delivers when the fix loop runs out', async () => {
    const h = buildHarness({
      config: cfg({ fix_loop: { max_cycles: 1 } }),
      deps: { spawner: { run: async () => mechPass() } },
      subagents: [failVerdictRun([ISSUE_MAJOR])],
    });
    await fixRound(h);
    await stop(h);
    await flush();
    expect(tasksOf(h)[0]?.state).toBe('DONE_FLAGGED');
  });
});
