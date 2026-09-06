import { describe, expect, it } from 'vitest';
import { buildHarness, flush, makeAgent, notices, tasksOf } from './engine-harness.js';
import type { Harness } from './engine-harness.js';

const stages = { plan: { model: 'deepseek-v4-flash' }, execute: { model: 'deepseek-v4-flash' }, review: { model: 'deepseek-v4-flash' } };

/** A message the host would deliver for a user turn. */
const userMsg = (text: string) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] });

describe('engine — handleUserInput (gate & task admission)', () => {
  it('orchestration decision creates a PLANNING task and announces the gate rule', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, userMsg('重构认证模块'));

    const tasks = tasksOf(h);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.state).toBe('PLANNING');
    expect(tasks[0]?.goal).toBe('重构认证模块');
    expect(tasks[0]?.snapshot.goal).toBe('重构认证模块');
    const text = notices(h.agents).join('\n');
    expect(text).toContain('任务启动');
    // gate step 4: the orchestrate_patterns regex matched the modify intent verb
    expect(text).toContain('gate: 4: orchestrate_patterns');
  });

  it('question-shaped input passes through: no task is created', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, userMsg('什么是闭包？'));

    expect(tasksOf(h)).toHaveLength(0);
    expect(h.agents.injected).toHaveLength(0);
  });

  it('short input without a modify verb passes through (gate step 5)', async () => {
    const h = buildHarness();
    await h.handleUserInput(h.agents, userMsg('任务甲'));
    expect(tasksOf(h)).toHaveLength(0);
  });

  it('passthrough mode (ADR #13): orchestration is off and no task is created', async () => {
    const h = buildHarness({ config: { mode: 'passthrough', stages } as Harness['config'] });
    await h.handleUserInput(h.agents, userMsg('重构认证模块'));
    expect(tasksOf(h)).toHaveLength(0);
    expect(notices(h.agents).join('\n')).toBe('');
  });

  it('/per on overrides a disabled global mode for this session only', async () => {
    const h = buildHarness({ config: { mode: 'passthrough', stages } as Harness['config'] });
    await h.handleUserInput(h.agents, userMsg('重构认证模块'));
    expect(tasksOf(h)).toHaveLength(0);

    const per = h.commands['per'];
    expect(typeof per?.handler).toBe('function');
    const res = per!.handler!({ agent: h.agents, rawInput: 'on' });
    expect(res).toEqual({ kind: 'success', text: expect.stringContaining('全部进入编排') });
    await h.handleUserInput(h.agents, userMsg('重构认证模块'));

    const tasks = tasksOf(h);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.state).toBe('PLANNING');
    expect(notices(h.agents).join('\n')).toContain('gate: 1: forced flag');

    // the override is per session: another session stays passthrough
    const other = makeAgent('sess-other');
    await h.handleUserInput(other, userMsg('重构认证模块'));
    expect(tasksOf(h)).toHaveLength(1);
    expect(other.injected).toHaveLength(0);
  });

  it('launch is rejected once the daily budget is exhausted', async () => {
    const h = buildHarness({ config: { budget: { daily_limit_cny: 2 }, stages } as Harness['config'] });
    const ledger = h.ledger as { debit: (t: string | null, s: string, p: string | undefined, m: string, i: number, o: number) => { ok: boolean }; estimatedToday: () => number };
    // deepseek-chat = ¥2/¥8 per million tokens: 1M input tokens = ¥2, which
    // lands exactly on the (>=) launch pre-check threshold
    expect(ledger.debit(null, 'plan', undefined, 'deepseek-chat', 1_000_000, 0).ok).toBe(true);
    expect(ledger.estimatedToday()).toBeGreaterThanOrEqual(2);

    await h.handleUserInput(h.agents, userMsg('重构认证模块'));
    expect(tasksOf(h)).toHaveLength(0);
    expect(notices(h.agents).join('\n')).toContain('今日预算已触顶');
  });

  it('launch is rejected when no stage models are configured', async () => {
    const h = buildHarness();
    h.config.stages = undefined; // effectiveConfig is the live object the engine reads
    await h.handleUserInput(h.agents, userMsg('重构认证模块'));
    expect(tasksOf(h)).toHaveLength(0);
    expect(notices(h.agents).join('\n')).toContain('未配置阶段模型');
  });

  it('a queued second task may not see the running task, and vice versa', async () => {
    const h = buildHarness();
    const busy = makeAgent('sess-busy');
    await h.handleUserInput(busy, userMsg('重构认证模块'));
    await h.handleUserInput(h.agents, userMsg('修复登录问题'));

    const tasks = tasksOf(h);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.state).sort()).toEqual(['IDLE', 'PLANNING']);
    const queued = tasks.find((t) => t.goal === '修复登录问题');
    expect(queued?.state).toBe('IDLE'); // admitted=false → still in the serial queue
    expect(notices(h.agents).join('\n')).toContain('任务排队中，当前排在第 1 位');
    expect(notices(busy).join('\n')).toContain('任务启动');
  });

  it('settling the running task launches the queued one via the launch milestone', async () => {
    const h = buildHarness();
    const busy = makeAgent('sess-busy');
    await h.handleUserInput(busy, userMsg('重构认证模块'));
    await h.handleUserInput(h.agents, userMsg('修复登录问题'));

    // the /orch abort command fires user/cancel → the settle hook hands the
    // slot to the queued task (P1-12: no phantom step count in the milestone)
    const orch = h.commands['orch'];
    expect(typeof orch?.handler).toBe('function');
    const res = orch!.handler!({ agent: busy, rawInput: 'abort' });
    expect(res).toEqual({ kind: 'success', text: expect.stringContaining('已请求终止') });
    await flush();

    expect(tasksOf(h).find((t) => t.goal === '重构认证模块')?.state).toBe('ABORTED');
    expect(tasksOf(h).find((t) => t.goal === '修复登录问题')?.state).toBe('PLANNING');
    const text = notices(h.agents).join('\n');
    expect(text).toContain('【编排】排队任务启动：修复登录问题');
    expect(text).not.toContain('计划 0 步');
  });
});
