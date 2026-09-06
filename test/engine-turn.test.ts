import { describe, expect, it } from 'vitest';
import { buildHarness, driveToExecuting, makeAgent, mechPass, notices, tasksOf, textOf } from './engine-harness.js';
import type { Harness } from './engine-harness.js';

const stop = (h: Harness, agent = h.agents) =>
  h.onTurnStopping({ agent, turn: 1, signal: new AbortController().signal });

/** Assistant turn carrying an invalid plan fence (empty steps). */
const invalidPlanEvent = (h: Harness) =>
  h.onSessionEvent({ id: h.agents.id }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '```plan\n{"steps":[]}\n```' }] } } });

describe('engine — onTurnStopping (turn driver)', () => {
  it('PLANNING: steers the plan-instruction and keeps the task in PLANNING', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    expect(tasksOf(h)[0]?.state).toBe('PLANNING');

    await stop(h);
    expect(h.agents.steered).toHaveLength(1);
    const text = textOf(h.agents.steered[0]);
    expect(text).toContain('规划指令');
    expect(text).toContain('```plan');
    // steering must not advance the state machine
    expect(tasksOf(h)[0]?.state).toBe('PLANNING');
  });

  it('PLAN_FAIL: plan/retry returns to PLANNING and re-injects the planning prompt', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    // a schema-invalid plan parks the task in PLAN_FAIL (plan_retry 0 → 1)
    await invalidPlanEvent(h);
    expect(tasksOf(h)[0]?.state).toBe('PLAN_FAIL');
    expect(tasksOf(h)[0]?.snapshot.counters.plan_retry).toBe(1);

    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('PLANNING');
    // the plan/retry hook re-issues a fresh planning prompt
    expect(textOf(h.agents.steered.at(-1)!)).toContain('规划重试');
    expect(textOf(h.agents.steered.at(-1)!)).toContain('```plan');
  });

  it('EXECUTING with [NEED_REPLAN]: consumes a replan cycle and steers the revision', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h);
    expect(t.state).toBe('EXECUTING');
    t.snapshot.needReplan = true;

    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('RE-PLANNING');
    expect(tasksOf(h)[0]?.snapshot.needReplan).toBe(false); // consumed, not sticky
    expect(tasksOf(h)[0]?.snapshot.counters.replan_cycle).toBe(1);
    expect(textOf(h.agents.steered.at(-1)!)).toContain('[NEED_REPLAN]');
    expect(notices(h.agents).join('\n')).toContain('计划缺陷，带反馈重规划');
  });

  it('EXECUTING with tool errors: exec/fail consumes an exec retry', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h);
    t.snapshot.execErrorCount = 1;

    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('EXECUTING'); // still EXECUTING: in-place retry
    expect(tasksOf(h)[0]?.snapshot.counters.exec_retry).toBe(1);
    expect(tasksOf(h)[0]?.snapshot.execErrorCount).toBe(0); // per-turn signal, reset on retry
    expect(notices(h.agents).join('\n')).toContain('执行出现错误，重试当前计划步骤');
  });

  it('EXECUTING step cap: routes to RE-PLANNING as a granularity defect', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h);
    t.snapshot.stageSteps.execute = 999;

    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('RE-PLANNING');
    expect(tasksOf(h)[0]?.snapshot.counters.replan_cycle).toBe(1);
    expect(textOf(h.agents.steered.at(-1)!)).toContain('粒度过粗');
    expect(notices(h.agents).join('\n')).toContain('执行步数超限');
  });

  it('EXECUTING quick channel: mechanical pass lands the task in DONE', async () => {
    const h = buildHarness({ deps: { spawner: { run: async () => mechPass() } } });
    // review_hint=skip + standard risk + mechanical verification ON + pass = quick channel
    const t = await driveToExecuting(h, '修复一个报错', { review_hint: 'skip' });
    expect(t.state).toBe('EXECUTING');
    expect(h.config.mechanical_verification.enabled).toBe(true);

    await stop(h);
    expect(tasksOf(h)[0]?.state).toBe('DONE');
    expect(tasksOf(h)[0]?.snapshot.mechanicalResult).toMatchObject({ compile: { check: 'pass' }, tests: { check: 'pass' } });
  });

  it('no verification commands configured: the quick channel cannot fire, so review is mandatory', async () => {
    const h = buildHarness();
    const t = await driveToExecuting(h, '修复一个报错', { review_hint: 'skip' });
    expect(t.state).toBe('EXECUTING');
    expect(h.config.mechanical_verification.enabled).toBe(true);
    expect(h.config.mechanical_verification.commands).toEqual({});

    await stop(h);
    // an empty check list can never satisfy the quick channel (A4: it requires
    // at least one passing check), so the task must go through the reviewer
    expect(h.spawnCalls.some((c) => c.label.endsWith(':reviewer'))).toBe(true);
    expect(h.spawnCalls.some((c) => c.label.endsWith(':auditor-1'))).toBe(false);
    // the fake reviewer passes, and with no checks to contradict it the task lands DONE
    expect(tasksOf(h)[0]?.state).toBe('DONE');
  });

  it('idle (queued) task: turn stopping is a no-op and nothing is steered', async () => {
    const h = buildHarness();
    const busy = makeAgent('sess-busy');
    await h.handleUserInput(busy, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '修复登录问题' }] });
    const queued = tasksOf(h).find((t) => t.goal === '修复登录问题')!;
    expect(queued.state).toBe('IDLE');

    await stop(h);
    expect(h.agents.steered).toHaveLength(0);
    // only the queue notice, never a new turn-driven push
    expect(notices(h.agents)).toHaveLength(1);
    expect(notices(h.agents).join('\n')).toContain('任务排队中');
    expect(tasksOf(h).find((t) => t.goal === '修复登录问题')?.state).toBe('IDLE');
  });

  it('request failure: own recovery retries up to 3 times then surfaces the error', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    const payload = { agent: h.agents, provider: 'prov', failure: { code: '5xx', message: 'boom' } };
    const fallthrough = () => ({ kind: 'error' });

    const first = (await h.onRequestError(payload, fallthrough)) as { kind?: string };
    expect(first.kind).toBe('retry');
    expect(notices(h.agents).join('\n')).toContain('自动重试（1/3）');
    // retries 2 and 3 also recover, but the notice is deduped (noticeOnce)
    expect(((await h.onRequestError(payload, fallthrough)) as { kind?: string }).kind).toBe('retry');
    expect(((await h.onRequestError(payload, fallthrough)) as { kind?: string }).kind).toBe('retry');
    // the 4th failure escapes to the host instead of looping forever
    expect(((await h.onRequestError(payload, fallthrough)) as { kind?: string }).kind).toBe('error');
    expect(h.agents.steered).toHaveLength(0);
  });

  it('request failure on a circuit-open plan model aborts via model/hard-fail', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text: '重构认证模块' }] });
    // ADR #2+9: the plan stage is hard_fail, so an open circuit cannot degrade
    const health = h.health as { recordFailure: (p: string | undefined, m: string, k: string) => void };
    for (let i = 0; i < 3; i++) health.recordFailure(undefined, 'deepseek-v4-flash', '5xx');

    await h.onRequestError({ agent: h.agents, provider: 'prov', failure: { code: '429', message: 'limited' } }, () => ({ kind: 'error' }));
    expect(tasksOf(h)[0]?.state).toBe('ABORTED');
    expect(notices(h.agents).join('\n')).toContain('模型不可用');
  });
});
