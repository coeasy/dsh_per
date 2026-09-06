/**
 * Core contracts of the orchestrator plugin.
 * Mirrors 设计修订-v5.1-变更单 (change-set v5.1) — the revised transition table,
 * counters and data models.
 */

// ── task states (v5.0 §3.1) ────────────────────────────────────────────────

export type TaskState =
  | 'IDLE'
  | 'PLANNING'
  | 'PLAN_FAIL'
  | 'EXECUTING'
  | 'RE-PLANNING'
  | 'REVIEWING'
  | 'DONE'
  | 'DONE_FLAGGED'
  | 'ABORTED';

export const TERMINAL_STATES: readonly TaskState[] = ['DONE', 'DONE_FLAGGED', 'ABORTED'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

// ── task events (transition table, change-set §2) ──────────────────────────

export type TaskEventName =
  | 'task/launch'
  | 'plan/ok'
  | 'plan/fail'
  | 'plan/steps-exceeded'
  | 'plan/retry'
  | 'exec/ok'
  | 'exec/ok:DONE'
  | 'exec/need-replan'
  | 'exec/fail'
  | 'exec/fail:REPLAN'
  | 'exec/steps-exceeded'
  | 'exec/defect:EXHAUSTED'
  | 'replan/ok'
  | 'replan/fail'
  | 'replan/fail:EXHAUSTED'
  | 'review/pass'
  | 'review/pass:MISS'
  | 'review/fail-exec'
  | 'review/fail-exec:DONE'
  | 'review/fail-exec:ABORT'
  | 'review/fail-plan'
  | 'review/fail-plan:DONE'
  | 'review/ambiguous'
  | 'review/deadlock'
  | 'review/deadlock:EXEC'
  | 'budget/exhausted'
  | 'budget/exhausted:FLAGGED'
  | 'user/cancel'
  | 'circuit/broken'
  | 'model/hard-fail';

// ── counters (change-set §2) ───────────────────────────────────────────────

export type CounterName =
  | 'plan_retry'
  | 'exec_retry'
  | 'replan_cycle'
  | 'fix_cycle'
  | 'review_supplement'
  | 'review_dispatch_retry';

export type Counters = Record<CounterName, number>;

// ── plan document (v5.0 §11.1) ─────────────────────────────────────────────

export type Complexity = 'trivial' | 'low' | 'mid' | 'high';
export type ReviewHint = 'skip' | 'lightweight' | 'full';
export type RiskLevel = 'standard' | 'elevated' | 'high';

export interface PlanStep {
  id: string;
  title: string;
  files?: string[];
  risk_note?: string;
}

export interface PlanDocument {
  version: number;
  supersedes: number | null;
  steps: PlanStep[];
  complexity: Complexity;
  review_hint: ReviewHint;
  risk_level: RiskLevel;
  estimated_context_tokens: number;
}

// ── review verdict (v5.0 §4.3) ─────────────────────────────────────────────

export type IssueDimension =
  | 'plan_conformance'
  | 'code_quality'
  | 'boundary'
  | 'security'
  | 'test_coverage';

export type IssueSeverity = 'blocker' | 'major' | 'minor';

export interface ReviewIssue {
  id: string;
  dimension: IssueDimension;
  severity: IssueSeverity;
  description: string;
  location?: string;
  fix_granularity?: 'incremental' | 'full_reexec';
  /** v5.2 plan-audit: concrete revision suggestion fed back to the planner */
  suggestion?: string;
}

export type DefectType = 'execution' | 'plan' | 'ambiguous';

export interface ReviewVerdict {
  planVersion: number;
  pass: boolean;
  defect_type: DefectType;
  confidence: number;
  issues: ReviewIssue[];
}

// ── mechanical verification (change-set A11) ───────────────────────────────

export type MechanicalCheck = 'pass' | 'fail' | 'unavailable';

export interface MechanicalResult {
  compile?: { check: MechanicalCheck; exitCode?: number; tail?: string; summary?: string };
  tests?: { check: MechanicalCheck; exitCode?: number; tail?: string; summary?: string };
  lint?: { check: MechanicalCheck; exitCode?: number; tail?: string };
  ranAt: number;
}

// ── execution product (v5.0 §4.2) ──────────────────────────────────────────

export interface ExecProduct {
  diffLines: number;
  changedFiles: string[];
  testResults?: string;
  errorCount: number;
}

// ── gate (change-set A9/A10) ───────────────────────────────────────────────

export type GateDecision = 'orchestrate' | 'passthrough';

export interface GateOutcome {
  decision: GateDecision;
  forced: boolean;
  rule: string;
}

// ── model binding (v5.0 §6) ────────────────────────────────────────────────

export interface ModelBinding {
  provider?: string;
  model: string;
  reasoningEffort?: string;
  degraded?: boolean;
}

// ── persisted task snapshot (v5.0 §11.2, revised) ──────────────────────────

export type Stage = 'plan' | 'execute' | 'review';

/** v5.2 audit dimensions — separate vocabulary from review IssueDimension. */
export type PlanAuditDimension = 'feasibility' | 'granularity' | 'risk_coverage' | 'file_consistency';

export interface PlanAuditIssue {
  id: string;
  dimension: PlanAuditDimension;
  severity: IssueSeverity;
  description: string;
  location?: string;
  suggestion?: string;
}

/** v5.2: one plan-audit negotiation round (recorded for postmortem visibility). */
export interface PlanAuditRound {
  planVersion: number;
  round: number;
  issues: PlanAuditIssue[]; // merged union (may carry suggestion)
  adopted: string[];
  rebutted: Array<{ id: string; justification: string; accepted?: boolean; note?: string }>;
  passed: boolean;
}

export interface TaskSnapshot {
  id: string;
  sessionId: string;
  parentTaskId: string | null;
  goal: string;
  state: TaskState;
  counters: Counters;
  planningReturnState: 'PLANNING' | 'RE-PLANNING';
  stageSteps: Record<Stage, number>;
  stageTokens: Record<Stage, number>;
  subTokens: Partial<Record<'planner' | 'executor' | 'reviewer' | 'auditor', number>>;
  plan: PlanDocument | null;
  planVersion: number;
  planDigested: boolean;
  executionLog: Array<{ turn: number; step: number; at: number; summary: string }>;
  executionProduct: ExecProduct | null;
  reviewHistory: ReviewVerdict[];
  pendingFixes: ReviewIssue[];
  userDirectives: string[];
  issueFailStreak: Record<string, number>;
  fixEscalated: boolean;
  degradedStages: Stage[];
  mechanicalResult: MechanicalResult | null;
  gateDecision: GateOutcome | null;
  spentCny: number;
  abandoned: boolean;
  needReplan: boolean;
  execErrorCount: number;
  llmCalls: number;
  /** v5.2: negotiation history of the plan-audit gate (empty when the feature is off) */
  planAudit: PlanAuditRound[];
  /** v5.2: count of audit-gate fail-open skips (auditor infrastructure unavailable) */
  auditSkipped: number;
  /** last reviewer-dispatch failure detail; cleared on a successful verdict */
  lastReviewError?: string;
  startedAt: number;
  updatedAt: number;
}

// ── abort reasons ──────────────────────────────────────────────────────────

/**
 * Reasons actually accepted by `forceAbort` / `forceAbortCore` — v3 narrowed
 * this union to what is really passed anywhere in the codebase.
 *
 * Exhaustion and interrupt outcomes are NOT here on purpose: the transition
 * table delivers them through its own hooks (`abortBudgetExhausted`,
 * `abortReplanExhausted`, `abortModelUnavailable`, `abortCircuitBroken`,
 * `abortUserCancelled`) *after* the state is already set to ABORTED, so pushing
 * them through `forceAbort` would be a no-op double-set. v2 listed those names
 * here anyway — including `plan_retry_exhausted` and `replan_exhausted`, which
 * were never passed to `forceAbort` at all and had no branch in
 * `forceAbortCore`, so the type promised a specific delivery path that did not
 * exist.
 */
export type AbortReason =
  | 'guard_chain_overflow'
  | 'guard_rejected'
  | 'stale_snapshot';

export const COUNTER_DEFAULTS: Counters = {
  plan_retry: 0,
  exec_retry: 0,
  replan_cycle: 0,
  fix_cycle: 0,
  review_supplement: 0,
  review_dispatch_retry: 0,
};
