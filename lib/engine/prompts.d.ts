/**
 * Prompt builders (docs/重构方案-v3.md §2-D).
 *
 * Pure string factories: each takes the task snapshot and the config slice it
 * needs and returns text. No host access, no side effects, no state — the
 * riskiest things in the old engine (review budget trimming, fix/replan
 * directives) are now unit-testable without booting a host.
 *
 * Config is passed as an explicit argument rather than read from a shared
 * closure, so a module cannot observe a stale `effectiveConfig` binding.
 */
import type { OrchestratorConfig } from '../config/schema.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { ReviewVerdict, TaskSnapshot } from '../types.js';
/**
 * Every reviewer prompt starts with this marker. `handleUserInput` filters on
 * it because a reviewer/auditor child delivers its own prompt as a user
 * message in its own session, and `run.id` differs from the child session id
 * — the `childSessions` map cannot catch it (E2E defect #7).
 */
export declare const REVIEW_PROMPT_MARKER = "\u4F60\u662F\u72EC\u7ACB\u7684\u590D\u6838\u5458";
/** P2-08/P1-10: plan skeleton — ids/titles/files only, no prose fields. */
export declare function skeletonPlan(plan: TaskSnapshot['plan']): string;
/** Compact mechanical-verification line for the review prompt. */
export declare function mechSummary(snap: TaskSnapshot): string;
/** New-plan milestone (was the misspelled `MILESTONS_REPLAN_OK`, v3 E7). */
export declare function replanOkMilestone(task: OrchestratorTask): string;
export declare function buildFixDirective(task: OrchestratorTask, cfg: OrchestratorConfig): string;
export declare function buildReplanDirective(task: OrchestratorTask, feedback: string): string;
export declare function buildFixDirectiveFromMechanical(task: OrchestratorTask): string;
/**
 * Build the reviewer prompt (P1-10): when it exceeds `review.input_token_budget`
 * the plan degrades to its skeleton (and finally to a bare stats line) so a big
 * plan cannot blow the reviewer's context and deadlock the pipeline.
 */
export declare function buildReviewPrompt(task: OrchestratorTask, cfg: OrchestratorConfig, previous: ReviewVerdict | null, supplementQuestion?: string, scopeFiles?: string[]): string;
//# sourceMappingURL=prompts.d.ts.map