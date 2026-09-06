import type { AbortReason, CounterName, Counters, PlanDocument, ReviewIssue, TaskEventName, TaskSnapshot, TaskState } from '../types.js';
import { COUNTER_DEFAULTS, isTerminal } from '../types.js';
import { GLOBAL_EVENTS, TRANSITION_TABLE, type TransitionContext, type TransitionRule } from './transition-table.js';

/** Async side-effects invoked by transition actions; implemented by the engine. */
export type TaskHook = (task: OrchestratorTask) => Promise<void> | void;
export type TaskHooks = Record<string, TaskHook>;

export interface TaskLimits {
  plan_retry_max: number;
  exec_retry_max: number;
  replan_cycle_max: number;
  fix_loop_max: number;
}

export interface EngineFlags {
  configValid: boolean;
  budgetOk: boolean;
  planSchemaOk: boolean;
  quickChannelOk: boolean;
  mechanicalFailedAfterPass: boolean;
  /** v3 (C2) — `fix_loop.exhausted_delivery: 'abort'` */
  fixExhaustionAborts: boolean;
  /** v3 (C5) — `budget.on_exhausted: 'abort'` */
  budgetExhaustionAborts: boolean;
}

export class OrchestratorTask {
  snapshot: TaskSnapshot;
  hooks: TaskHooks;
  limits: TaskLimits;
  flags: EngineFlags;
  illegalTransitions = 0;
  /** last plan parse error (fed back into retry prompts) */
  lastPlanError?: string;
  /**
   * v5.2: a schema-valid plan parked until the audit gate clears it at turn's
   * end (runtime-only; the snapshot only learns about the audit afterwards)
   */
  pendingPlanAudit?: { response: { adopted: string[]; rebutted: Array<{ id: string; justification: string }> } | null } | undefined;
  /** serialized hook execution to keep transitions ordered per task */
  private queue: Promise<unknown> = Promise.resolve();
  /** wall clock seam (v4): injectable so transition timestamps are testable */
  private readonly now: () => number;

  constructor(init: {
    id: string;
    sessionId: string;
    goal: string;
    parentTaskId?: string | null;
    hooks: TaskHooks;
    limits: TaskLimits;
    flags?: Partial<EngineFlags>;
    gateDecision?: TaskSnapshot['gateDecision'];
    /** defaults to Date.now; the engine injects its clock seam */
    now?: () => number;
  }) {
    const now = init.now ?? Date.now;
    this.now = now;
    this.snapshot = {
      id: init.id,
      sessionId: init.sessionId,
      parentTaskId: init.parentTaskId ?? null,
      goal: init.goal,
      state: 'IDLE',
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
      gateDecision: init.gateDecision ?? null,
      spentCny: 0,
      abandoned: false,
      needReplan: false,
      execErrorCount: 0,
      llmCalls: 0,
      planAudit: [],
      auditSkipped: 0,
      startedAt: this.now(),
      updatedAt: this.now(),
    };
    this.hooks = init.hooks;
    this.limits = init.limits;
    this.flags = {
      configValid: true,
      budgetOk: true,
      planSchemaOk: true,
      quickChannelOk: false,
      mechanicalFailedAfterPass: false,
      fixExhaustionAborts: false,
      budgetExhaustionAborts: true,
      ...init.flags,
    };
  }

  get state(): TaskState {
    return this.snapshot.state;
  }

  get id(): string {
    return this.snapshot.id;
  }

  counter(name: CounterName): number {
    return this.snapshot.counters[name];
  }

  /** Chain an async operation onto the per-task queue. */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * The single state-transition entry point (v5.0 §3.3, revised by A7).
   * Guard failure follows `fallback` (depth ≤ 2); overflow forces ABORTED.
   * Row resolution: exact row first, then guarded variants (`event:*`) in
   * definition order; the first passing guard wins.
   *
   * The whole body — guard scan, state mutation, action application and the
   * follow-up hook — runs inside ONE per-task queue slot (P0-04), so concurrent
   * `transition()` calls on the same task are strictly ordered. Without this,
   * two async entries racing on one task could read a stale snapshot, double
   * increment a counter or double-apply `recordStreaks`.
   */
  transition(event: TaskEventName, depth = 0): Promise<boolean> {
    return this.enqueue(() => this.transitionCore(event, depth));
  }

  /**
   * Transition body. Entered inside a queue slot by `transition()` and
   * recursively by the fallback chain. The recursion must stay on this
   * method and never return to `transition()`: re-entering would append to a
   * queue that is already awaiting this call, deadlocking the task.
   */
  private async transitionCore(event: TaskEventName, depth = 0): Promise<boolean> {
    if (isTerminal(this.state)) return false;

    const stateRules = TRANSITION_TABLE[this.state] ?? {};
    const candidates: TransitionRule[] = [];

    if (event === 'plan/retry') {
      // A2: retry returns to the remembered planning substate
      const base = TRANSITION_TABLE.PLAN_FAIL?.['plan/retry'];
      if (base) candidates.push({ ...base, to: this.snapshot.planningReturnState });
    } else {
      const g0 = GLOBAL_EVENTS[event];
      if (g0) candidates.push(g0);
    }

    // exact row first, then guarded variants in definition order; the scan
    // continues past guard failures so variants can catch exhausted counters
    const entries = Object.entries(stateRules).filter(([k]) => k === event || k.startsWith(`${event}:`));
    entries.sort(([a], [b]) => (a === event ? -1 : 0) - (b === event ? -1 : 0));
    for (const [, r] of entries) candidates.push(r);

    const g = this.context();
    let chosen: TransitionRule | undefined;
    let failFallback: TaskEventName | undefined;
    for (const r of candidates) {
      if (!r.guard || r.guard(g)) {
        chosen = r;
        break;
      }
      if (r.fallback) failFallback = r.fallback;
    }

    if (!chosen) {
      if (failFallback) {
        if (depth > 2) return this.forceAbortCore('guard_chain_overflow'); // A7
        return this.transitionCore(failFallback, depth + 1);
      }
      this.illegalTransitions++;
      return this.forceAbortCore('guard_rejected');
    }

    this.snapshot.state = chosen.to;
    this.applyAction(chosen);
    this.snapshot.updatedAt = this.now();
    const hook = chosen.action?.hook;
    // same queue slot: no re-`enqueue()` here, see `transitionCore`
    if (hook && this.hooks[hook]) await this.hooks[hook]!(this);
    return true;
  }

  /** Hard abort used by guard overflow / engine-level faults (bypasses table). */
  forceAbort(reason: AbortReason): Promise<boolean> {
    return this.enqueue(() => this.forceAbortCore(reason));
  }

  private async forceAbortCore(reason: AbortReason): Promise<boolean> {
    if (isTerminal(this.state)) return false;
    this.snapshot.state = 'ABORTED';
    this.snapshot.updatedAt = this.now();
    // Only guard/internal reasons reach here. Exhaustion and interrupt outcomes
    // (`budget/exhausted`, `model/hard-fail`, `circuit/broken`, `user/cancel`,
    // `replan/fail:EXHAUSTED`) are delivered by the transition table's own
    // hooks after the state is already ABORTED, so they never pass through
    // `forceAbort` — the v2 ternary kept dead branches for all of them.
    const hook =
      reason === 'stale_snapshot'
        ? 'abortStaleSnapshot'
        : reason === 'guard_chain_overflow'
          ? 'abortGuardOverflow'
          : reason === 'guard_rejected'
            ? 'abortGuardRejected'
            : 'abortGeneric';
    if (this.hooks[hook]) await this.hooks[hook]!(this);
    return true;
  }

  private context(): TransitionContext {
    return {
      counters: this.snapshot.counters,
      limits: {
        plan_retry_max: this.limits.plan_retry_max,
        exec_retry_max: this.limits.exec_retry_max,
        replan_cycle_max: this.limits.replan_cycle_max,
        fix_loop_max: this.limits.fix_loop_max,
      },
      quickChannelOk: this.flags.quickChannelOk,
      mechanicalFailedAfterPass: this.flags.mechanicalFailedAfterPass,
      configValid: this.flags.configValid,
      budgetOk: this.flags.budgetOk,
      planSchemaOk: this.flags.planSchemaOk,
      fixExhaustionAborts: this.flags.fixExhaustionAborts,
      budgetExhaustionAborts: this.flags.budgetExhaustionAborts,
    };
  }

  private applyAction(rule: TransitionRule): void {
    const a = rule.action;
    if (!a) return;
    const c = this.snapshot.counters as Counters;
    for (const op of Object.keys(a.counters ?? {}) as Array<keyof NonNullable<typeof a.counters>>) {
      switch (op) {
        case 'plan_retry++': c.plan_retry++; break;
        case 'exec_retry++': c.exec_retry++; break;
        case 'exec_retry=0': c.exec_retry = 0; break;
        case 'replan_cycle++': c.replan_cycle++; break;
        case 'fix_cycle++': c.fix_cycle++; break;
        case 'fix_cycle=0': c.fix_cycle = 0; break;
        case 'review_supplement++': c.review_supplement++; break;
        case 'review_supplement=0': c.review_supplement = 0; break;
        case 'review_dispatch_retry++': c.review_dispatch_retry++; break;
        case 'review_dispatch_retry=0': c.review_dispatch_retry = 0; break;
        // per-round step budgets: a new planning attempt / execution round
        // starts a fresh granularity budget (prevents cumulative step drift
        // from mis-triggering plan/steps-exceeded or exec/steps-exceeded)
        case 'plan_steps=0': this.snapshot.stageSteps.plan = 0; break;
        case 'execute_steps=0': this.snapshot.stageSteps.execute = 0; break;
      }
    }
    if (a.planningReturnState) this.snapshot.planningReturnState = a.planningReturnState;
    if (a.planVersionBump) this.snapshot.planVersion++;
    if (a.clearFixEscalated) this.snapshot.fixEscalated = false;
    if (a.replacePendingFixes) {
      const last = this.snapshot.reviewHistory.at(-1);
      this.snapshot.pendingFixes = (last?.issues ?? []).filter((i) => i.severity !== 'minor');
    }
    if (a.recordStreaks) {
      const last = this.snapshot.reviewHistory.at(-1);
      for (const issue of last?.issues ?? []) {
        if (issue.severity === 'minor') continue;
        this.snapshot.issueFailStreak[issue.id] = (this.snapshot.issueFailStreak[issue.id] ?? 0) + 1;
      }
      // cleared streaks for issues no longer present (M5: id stability contract)
      const present = new Set((last?.issues ?? []).map((i) => i.id));
      for (const id of Object.keys(this.snapshot.issueFailStreak)) {
        if (!present.has(id)) delete this.snapshot.issueFailStreak[id];
      }
    }
    if (a.synthesizePlanDefectIssue) {
      const synth: ReviewIssue = {
        id: 'SYN-PLAN-DEFECT',
        dimension: 'plan_conformance',
        severity: 'blocker',
        description: '执行缺陷经多轮重规划未收敛，产物未经完整复核',
      };
      const lastIssues = this.snapshot.reviewHistory.at(-1)?.issues ?? [];
      this.snapshot.pendingFixes = [];
      this.snapshot.reviewHistory.push({
        planVersion: this.snapshot.planVersion,
        pass: false,
        defect_type: 'plan',
        confidence: 1,
        issues: [...lastIssues, synth],
      });
    }
  }

  /** Escalation check (ADR #18): any tracked issue failed `>=` threshold consecutively. */
  computeEscalation(threshold: number): boolean {
    return Object.values(this.snapshot.issueFailStreak).some((s) => s >= threshold);
  }

  /** Attach a parsed plan (plan/ok path helper). */
  attachPlan(plan: Omit<PlanDocument, 'version'>): PlanDocument {
    const doc: PlanDocument = { ...plan, version: this.snapshot.planVersion + 1 };
    this.snapshot.plan = doc;
    return doc;
  }
}
