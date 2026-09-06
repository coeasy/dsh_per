/**
 * Reviewer dispatch (docs/重构方案-v3.md §2-D).
 *
 * Builds the prompt, spawns the child, applies the timeout+dispose template and
 * merges large-diff shards, then routes the verdict (`runReview`). Transitions
 * go through the core's fire callback, so the FSM call graph stays auditable
 * in engine.ts.
 */
import type { ReviewVerdict } from '../types.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { AnyAgent, EngineCtx, TransitionFn } from './ctx.js';
/** Outcome of a reviewer dispatch; `'hardfail'` means the core must fire `model/hard-fail`. */
export type ReviewerOutcome = 'ok' | 'deadlock' | 'hardfail';
/** Single verdict from a spawn — null means dispatch failed (deadlock signal). */
export declare function dispatchReviewPrompt(ctx: EngineCtx, task: OrchestratorTask, agent: AnyAgent, signal: AbortSignal, prompt: string, model: string, provider: string | undefined): Promise<ReviewVerdict | null>;
export declare function dispatchReviewer(ctx: EngineCtx, task: OrchestratorTask, agent: AnyAgent, signal: AbortSignal, supplementQuestion?: string): Promise<ReviewerOutcome>;
/**
 * Drive one review round: dispatch → deadlock budget → mechanical verification
 * → verdict route. Transitions go through the core's `fire` callback — this is
 * where `review/pass` / `review/pass:MISS` / `review/ambiguous` /
 * `review/fail-exec` / `review/fail-plan` / `review/deadlock*` are emitted.
 */
export declare function runReview(engine: EngineCtx, fire: TransitionFn, task: OrchestratorTask, agent: AnyAgent, signal: AbortSignal): Promise<'steered' | 'ended'>;
//# sourceMappingURL=review.d.ts.map