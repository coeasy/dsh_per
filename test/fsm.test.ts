import { describe, it, expect, vi } from 'vitest';
import { OrchestratorTask } from '../src/task/fsm.js';
import type { TaskHooks } from '../src/task/fsm.js';

const LIMITS = { plan_retry_max: 2, exec_retry_max: 2, replan_cycle_max: 3, fix_loop_max: 3 };

function makeTask(flags = {}, hooks: TaskHooks = {}) {
  return new OrchestratorTask({
    id: 't1',
    sessionId: 's1',
    goal: 'g',
    hooks: { ...hooks },
    limits: LIMITS,
    flags,
  });
}

describe('FSM — happy path', () => {
  it('launch → plan/ok → executing', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn() });
    expect(t.state).toBe('IDLE');
    expect(await t.transition('task/launch')).toBe(true);
    expect(t.state).toBe('PLANNING');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    expect(await t.transition('plan/ok')).toBe(true);
    expect(t.state).toBe('EXECUTING');
    expect(t.snapshot.planVersion).toBe(1);
  });

  it('quick channel requires quickChannelOk flag (A4)', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), finalizeReport: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'trivial', review_hint: 'skip', risk_level: 'standard', estimated_context_tokens: 10 });
    await t.transition('plan/ok');
    // quickChannelOk false → exec/ok goes REVIEWING
    await t.transition('exec/ok');
    expect(t.state).toBe('REVIEWING');
  });

  it('quick channel OK → DONE', async () => {
    const t = makeTask({ quickChannelOk: true }, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), finalizeReport: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'trivial', review_hint: 'skip', risk_level: 'standard', estimated_context_tokens: 10 });
    await t.transition('plan/ok');
    await t.transition('exec/ok:DONE');
    expect(t.state).toBe('DONE');
  });
});

describe('FSM — A1 infinite-loop fix', () => {
  it('exec/fail exhaustion routes to RE-PLANNING consuming replan_cycle, ends DONE_FLAGGED with synthesized issue', async () => {
    const t = makeTask({}, {
      lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), retrySamePlan: vi.fn(),
      replanWithExecDefectFeedback: vi.fn(), injectSupersedeAndPlan: vi.fn(), deliverFlagged: vi.fn(),
    });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');

    for (let round = 0; round < 3; round++) {
      // two in-plan retries
      expect(await t.transition('exec/fail')).toBe(true); // exec_retry 1
      expect(t.state).toBe('EXECUTING');
      await t.transition('exec/fail'); // exec_retry 2
      expect(t.state).toBe('EXECUTING');
      // third failure: exec_retry >= max → replan track
      await t.transition('exec/fail');
      expect(t.state).toBe('RE-PLANNING');
      expect(t.counter('replan_cycle')).toBe(round + 1);
      expect(t.counter('exec_retry')).toBe(2); // not yet reset — only replan/ok resets
      // replan ok
      t.attachPlan({ supersedes: t.snapshot.planVersion, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
      await t.transition('replan/ok');
      expect(t.state).toBe('EXECUTING');
      expect(t.counter('exec_retry')).toBe(0);
      expect(t.counter('fix_cycle')).toBe(0);
    }
    // 4th replan attempt: replan_cycle guard fails → fallback exec/defect:EXHAUSTED → DONE_FLAGGED
    await t.transition('exec/fail');
    await t.transition('exec/fail');
    await t.transition('exec/fail');
    expect(t.state).toBe('DONE_FLAGGED');
    const last = t.snapshot.reviewHistory.at(-1);
    expect(last?.issues.some((i) => i.id === 'SYN-PLAN-DEFECT')).toBe(true);
  });
});

describe('FSM — A2 replan quality failure returns to RE-PLANNING', () => {
  it('replan/fail → PLAN_FAIL(plan_retry++) → plan/retry → RE-PLANNING', async () => {
    const t = makeTask({}, {
      lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), recordPlanFailure: vi.fn(),
      reinjectPlanningWithError: vi.fn(), retrySamePlan: vi.fn(), replanWithNeedReplanFeedback: vi.fn(),
    });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/need-replan'); // → RE-PLANNING (replan_cycle 1)
    expect(t.state).toBe('RE-PLANNING');
    await t.transition('replan/fail');
    expect(t.state).toBe('PLAN_FAIL');
    expect(t.snapshot.planningReturnState).toBe('RE-PLANNING');
    expect(t.counter('plan_retry')).toBe(1);
    await t.transition('plan/retry');
    expect(t.state).toBe('RE-PLANNING'); // A2: returned to remembered substate
  });
});

describe('FSM — review tracks', () => {
  async function toReviewing(hooks: TaskHooks) {
    const t = makeTask({}, { ...hooks, lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/ok');
    return t;
  }

  it('review/fail-exec consumes fix_cycle and injects fixes; exhaustion delivers flagged', async () => {
    const injectFixes = vi.fn();
    const deliverFlagged = vi.fn();
    let t = await toReviewing({ injectFixes, deliverFlagged });
    for (let i = 1; i <= 3; i++) {
      t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
      await t.transition('review/fail-exec');
      expect(t.state).toBe('EXECUTING'); // fix_cycle 1..3 < max
      if (i < 3) await t.transition('exec/ok'); // back to REVIEWING for the next verdict
    }
    // 4th verdict: fix_cycle >= max → fallback delivery flagged
    await t.transition('exec/ok');
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
    await t.transition('review/fail-exec');
    expect(t.state).toBe('DONE_FLAGGED');
    expect(t.counter('fix_cycle')).toBe(3);
    expect(injectFixes).toHaveBeenCalled();
    expect(deliverFlagged).toHaveBeenCalled();

    // streaks recorded and cleared (M5)
    t = await toReviewing({ injectFixes, deliverFlagged });
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
    await t.transition('review/fail-exec');
    expect(t.snapshot.issueFailStreak['I1']).toBe(1);
    // back to executing then review again without I1 → cleared
    await t.transition('exec/ok');
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: true, defect_type: 'execution', confidence: 0.95, issues: [] });
    await t.transition('review/pass');
    expect(t.state).toBe('DONE');
    expect(t.snapshot.issueFailStreak['I1']).toBeUndefined();
  });

  it('ADR #18: two consecutive fail-exec on the same issue id reach the escalation threshold', async () => {
    const t = await toReviewing({ injectFixes: vi.fn(), collectProduct: vi.fn() });
    expect(t.computeEscalation(2)).toBe(false); // no streaks yet

    for (let i = 0; i < 2; i++) {
      t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
      await t.transition('review/fail-exec');
      await t.transition('exec/ok');
    }
    expect(t.snapshot.issueFailStreak['I1']).toBe(2);
    expect(t.computeEscalation(2)).toBe(true); // threshold 2 → escalated
    expect(t.computeEscalation(3)).toBe(false); // threshold 3 → not yet

    // A different issue id never escalates while I1 is absent from the verdict
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I2', dimension: 'code_quality', severity: 'major', description: 'y' }] });
    await t.transition('review/fail-exec');
    expect(t.snapshot.issueFailStreak['I1']).toBeUndefined();
    expect(t.snapshot.issueFailStreak['I2']).toBe(1);
    expect(t.computeEscalation(2)).toBe(false);
  });

  it('ADR #18: replan/ok clears the escalation flag (replanned plan fixes unescalated)', async () => {
    const t = await toReviewing({ injectFixes: vi.fn(), collectProduct: vi.fn(), injectSupersedeAndPlan: vi.fn() });
    t.snapshot.fixEscalated = true;
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
    await t.transition('review/fail-plan'); // → RE-PLANNING (replan_cycle++)
    expect(t.state).toBe('RE-PLANNING');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('replan/ok');
    expect(t.state).toBe('EXECUTING');
    expect(t.snapshot.fixEscalated).toBe(false);
    expect(t.snapshot.planVersion).toBe(2); // superseded, not appended
  });

  it('review/pass with mechanical failure routes back to EXECUTING without fix_cycle (review/pass:MISS)', async () => {
    const t = await toReviewing({ fixFromMechanicalMiss: vi.fn(), finalizeReport: vi.fn() });
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: true, defect_type: 'execution', confidence: 0.95, issues: [] });
    t.flags.mechanicalFailedAfterPass = true;
    await t.transition('review/pass');
    expect(t.state).toBe('EXECUTING');
    expect(t.counter('fix_cycle')).toBe(0);
  });

  it('review/deadlock: redispatch once then conservative exec defect (A2)', async () => {
    const t = await toReviewing({ redispatchReviewer: vi.fn(), injectFixes: vi.fn(), deliverFlagged: vi.fn() });
    await t.transition('review/deadlock');
    expect(t.state).toBe('REVIEWING');
    expect(t.counter('review_dispatch_retry')).toBe(1);
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.7, issues: [] });
    await t.transition('review/deadlock:EXEC');
    expect(t.state).toBe('EXECUTING');
    expect(t.counter('fix_cycle')).toBe(1);
  });

  it('review/pass resets the per-round dispatch-retry budget', async () => {
    const t = await toReviewing({ finalizeReport: vi.fn() });
    t.snapshot.counters.review_dispatch_retry = 1; // stale from a prior deadlock
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: true, defect_type: 'execution', confidence: 0.95, issues: [] });
    await t.transition('review/pass');
    expect(t.state).toBe('DONE');
    expect(t.counter('review_dispatch_retry')).toBe(0);
  });
});

describe('FSM — per-round step budgets reset (v5.3 review)', () => {
  it('plan/retry resets the planning-steps budget', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), recordPlanFailure: vi.fn(), reinjectPlanningWithError: vi.fn() });
    await t.transition('task/launch');
    t.snapshot.stageSteps.plan = 99; // wandering accumulation
    t.flags.planSchemaOk = false;
    await t.transition('plan/fail');
    expect(t.state).toBe('PLAN_FAIL');
    await t.transition('plan/retry');
    expect(t.state).toBe('PLANNING');
    expect(t.snapshot.stageSteps.plan).toBe(0); // fresh granularity budget
  });

  it('replan/ok resets the execution-steps budget', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), injectSupersedeAndPlan: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    t.snapshot.stageSteps.execute = 70; // old plan accumulated past the cap
    await t.transition('exec/need-replan');
    expect(t.state).toBe('RE-PLANNING');
    t.flags.planSchemaOk = true;
    await t.transition('replan/ok');
    expect(t.state).toBe('EXECUTING');
    expect(t.snapshot.stageSteps.execute).toBe(0); // new plan version = fresh budget
  });

  it('review/fail-exec and review/pass:MISS reset the execution-steps budget per fix round', async () => {
    const injectFixes = vi.fn();
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), injectFixes, fixFromMechanicalMiss: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/ok');
    expect(t.state).toBe('REVIEWING');
    t.snapshot.stageSteps.execute = 40;
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: false, defect_type: 'execution', confidence: 0.9, issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: 'x' }] });
    await t.transition('review/fail-exec');
    expect(t.state).toBe('EXECUTING');
    expect(t.snapshot.stageSteps.execute).toBe(0);
    expect(t.counter('fix_cycle')).toBe(1);
    // mechanical-miss path also resets
    await t.transition('exec/ok');
    t.snapshot.stageSteps.execute = 25;
    t.snapshot.reviewHistory.push({ planVersion: 1, pass: true, defect_type: 'execution', confidence: 0.9, issues: [] });
    t.flags.mechanicalFailedAfterPass = true;
    await t.transition('review/pass');
    expect(t.state).toBe('EXECUTING'); // review/pass:MISS
    expect(t.snapshot.stageSteps.execute).toBe(0);
    expect(t.counter('fix_cycle')).toBe(1); // MISS does not consume a fix round
  });
});

describe('FSM — global interrupts and guards', () => {  it('budget/exhausted aborts from any non-terminal state', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), abortBudgetExhausted: vi.fn() });
    await t.transition('task/launch');
    await t.transition('budget/exhausted');
    expect(t.state).toBe('ABORTED');
    expect(await t.transition('plan/ok')).toBe(false); // terminal: no exits
  });

  it('IDLE launch with failed guard aborts as guard_rejected (A14 belt)', async () => {
    const t = makeTask({ configValid: false, budgetOk: false }, {});
    expect(await t.transition('task/launch')).toBe(true);
    expect(t.state).toBe('ABORTED');
  });

  it('plan_retry exhaustion aborts (ADR #2+9: planning hard fail)', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), recordPlanFailure: vi.fn(), abortGeneric: vi.fn() });
    await t.transition('task/launch');
    t.flags.planSchemaOk = false;
    await t.transition('plan/fail'); // retry 1 → PLAN_FAIL
    await t.transition('plan/retry');
    await t.transition('plan/fail'); // retry 2 → PLAN_FAIL
    await t.transition('plan/retry');
    await t.transition('plan/fail'); // retry 3: guard fails → fallback model/hard-fail → ABORTED
    expect(t.state).toBe('ABORTED');
  });

  it('P1-05: replan/fail with an exhausted plan_retry track reaches replan/fail:EXHAUSTED', async () => {
    const abortReplanExhausted = vi.fn();
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), recordPlanFailure: vi.fn(), abortReplanExhausted });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/need-replan'); // → RE-PLANNING (replan_cycle 1)
    expect(t.state).toBe('RE-PLANNING');

    t.snapshot.counters.plan_retry = LIMITS.plan_retry_max; // out of plan-quality retries
    expect(await t.transition('replan/fail')).toBe(true);
    expect(t.state).toBe('ABORTED');
    expect(abortReplanExhausted).toHaveBeenCalledTimes(1);
    // the old fallback reported「model unavailable」for a plan-quality exhaustion
    expect(t.snapshot.state).toBe('ABORTED');
  });

  it('P1-05: replan/fail still retries while plan_retry budget remains', async () => {
    const t = makeTask({}, { lockBudgetSnapshot: vi.fn(), handoffBudgetCheck: vi.fn(), recordPlanFailure: vi.fn(), reinjectPlanningWithError: vi.fn(), abortGeneric: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/need-replan');
    await t.transition('replan/fail');
    expect(t.state).toBe('PLAN_FAIL');
    expect(t.counter('plan_retry')).toBe(1);
    await t.transition('plan/retry');
    expect(t.state).toBe('RE-PLANNING'); // A2: remembered substate
  });

  it('P1-15: guard_rejected maps to its own abort hook, not the generic one', async () => {
    const t = makeTask({}, { abortGuardRejected: vi.fn(), abortGeneric: vi.fn() });
    expect(await t.transition('plan/ok')).toBe(true); // no such row from IDLE
    expect(t.state).toBe('ABORTED');
    expect(t.illegalTransitions).toBe(1);
  });

  it('P1-15 / v3-E3: forceAbort maps only its real reasons to distinct hooks', async () => {
    // v3 narrowed `AbortReason` to the reasons `forceAbort` actually accepts.
    // Exhaustion and interrupt outcomes are delivered by the transition table
    // instead (next test), so their names are no longer valid here — the v2
    // version of this test asserted a mapping that the code never had.
    const map: Array<[Parameters<OrchestratorTask['forceAbort']>[0], string]> = [
      ['stale_snapshot', 'abortStaleSnapshot'],
      ['guard_chain_overflow', 'abortGuardOverflow'],
      ['guard_rejected', 'abortGuardRejected'],
    ];
    const ALL = ['abortStaleSnapshot', 'abortGuardOverflow', 'abortGuardRejected', 'abortGeneric'];
    for (const [reason, expected] of map) {
      // fresh spies per iteration: hooks must not accumulate across reasons
      const spies = Object.fromEntries(ALL.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
      const t = makeTask({}, { ...spies });
      await t.transition('task/launch');
      expect(await t.forceAbort(reason), reason).toBe(true);
      expect(t.state, reason).toBe('ABORTED');
      expect(spies[expected], `${reason} → ${expected}`).toHaveBeenCalledTimes(1);
      for (const n of ALL.filter((x) => x !== expected)) {
        expect(spies[n], `${reason} must not fire ${n}`).not.toHaveBeenCalled();
      }
    }
  });

  it('v3-E3: table-delivered abort outcomes keep their own distinct hooks', async () => {
    const cases: Array<[string, string]> = [
      ['budget/exhausted', 'abortBudgetExhausted'],
      ['user/cancel', 'abortUserCancelled'],
      ['circuit/broken', 'abortCircuitBroken'],
      ['model/hard-fail', 'abortModelUnavailable'],
    ];
    for (const [event, expected] of cases) {
      const hook = vi.fn();
      const t = makeTask({}, { [expected]: hook });
      await t.transition('task/launch');
      expect(await t.transition(event)).toBe(true);
      expect(t.state).toBe('ABORTED');
      expect(hook, `${event} → ${expected}`).toHaveBeenCalledTimes(1);
    }
  });

  it('v3-C2: fix-loop exhaustion aborts instead of delivering flagged when configured', async () => {
    const abort = vi.fn();
    const t = makeTask({ fixExhaustionAborts: true }, { abortFixExhausted: abort, deliverFlagged: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/ok');
    expect(t.state).toBe('REVIEWING');
    t.snapshot.counters.fix_cycle = LIMITS.fix_loop_max; // out of fix rounds
    expect(await t.transition('review/fail-exec')).toBe(true);
    expect(t.state).toBe('ABORTED');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('v3-C2: the default policy still delivers flagged when the fix loop runs out', async () => {
    const flagged = vi.fn();
    const t = makeTask({}, { deliverFlagged: flagged, abortFixExhausted: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/ok');
    t.snapshot.counters.fix_cycle = LIMITS.fix_loop_max;
    expect(await t.transition('review/fail-exec')).toBe(true);
    expect(t.state).toBe('DONE_FLAGGED');
    expect(flagged).toHaveBeenCalledTimes(1);
  });

  it('v3-C5: budget exhaustion delivers flagged when on_exhausted is not abort', async () => {
    const flagged = vi.fn();
    const t = makeTask({ budgetExhaustionAborts: false }, { deliverFlagged: flagged, abortBudgetExhausted: vi.fn() });
    await t.transition('task/launch');
    expect(await t.transition('budget/exhausted')).toBe(true);
    expect(t.state).toBe('DONE_FLAGGED');
    expect(flagged).toHaveBeenCalledTimes(1);
  });

  it('v3-E5: review/deadlock falls back to flagged delivery instead of guard_rejected', async () => {
    // dispatch retries exhausted AND fix_cycle at its ceiling: v2 fell through
    // to `guard_rejected` (bare abort, no delivery); v3 routes it to the same
    // conservative flagged hand-off as its neighbours.
    const flagged = vi.fn();
    const generic = vi.fn();
    const t = makeTask({}, { deliverFlagged: flagged, abortGuardRejected: generic, redispatchReviewer: vi.fn(), injectFixes: vi.fn() });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok');
    await t.transition('exec/ok');
    expect(t.state).toBe('REVIEWING');
    t.snapshot.counters.review_dispatch_retry = 1; // redispatch budget spent
    t.snapshot.counters.fix_cycle = LIMITS.fix_loop_max;
    expect(await t.transition('review/deadlock')).toBe(true);
    expect(t.state).toBe('DONE_FLAGGED');
    expect(flagged).toHaveBeenCalledTimes(1);
    expect(generic).not.toHaveBeenCalled();
  });
});

describe('FSM — P0-04 serialized transitions', () => {
  /**
   * The whole transition body must run in one per-task queue slot. Before the
   * fix, state mutation was synchronous while the action hook was deferred to
   * the queue, so a later event's mutation landed before the earlier event's
   * hook ran. This test makes that interleaving observable.
   */
  it("a transition's hook observes the state it set, not a later event's", async () => {
    const seen: string[] = [];
    const slow = new Promise<void>((r) => setImmediate(() => r()));
    const t = makeTask({}, {
      lockBudgetSnapshot: vi.fn(),
      handoffBudgetCheck: async (task) => {
        await slow;
        seen.push(task.state);
      },
      collectProduct: vi.fn(),
    });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    const p1 = t.transition('plan/ok'); // → EXECUTING, then the slow hook
    const p2 = t.transition('exec/ok'); // → REVIEWING, queued behind the hook
    await Promise.all([p1, p2]);
    expect(seen).toEqual(['EXECUTING']);
    expect(t.state).toBe('REVIEWING');
    expect(t.snapshot.planVersion).toBe(1);
  });

  it('racing events on one task apply exactly once, in arrival order', async () => {
    const t = makeTask({}, {
      lockBudgetSnapshot: vi.fn(),
      handoffBudgetCheck: vi.fn(),
      collectProduct: vi.fn(),
      retrySamePlan: vi.fn(),
      abortBudgetExhausted: vi.fn(),
    });
    await t.transition('task/launch');
    t.attachPlan({ supersedes: null, steps: [{ id: '1', title: 'x' }], complexity: 'low', review_hint: 'full', risk_level: 'standard', estimated_context_tokens: 100 });
    await t.transition('plan/ok'); // → EXECUTING

    const [r1, r2] = await Promise.all([
      t.transition('exec/fail'), // exec_retry++ , stays EXECUTING
      t.transition('budget/exhausted'), // global interrupt → ABORTED
    ]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(t.state).toBe('ABORTED');
    expect(t.counter('exec_retry')).toBe(1); // no double increment
    expect(t.illegalTransitions).toBe(0); // no stale-state guard rejection
    expect(await t.transition('exec/fail')).toBe(false); // terminal: stays ABORTED
    expect(t.counter('exec_retry')).toBe(1);
  });
});
