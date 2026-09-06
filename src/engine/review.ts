/**
 * Reviewer dispatch (docs/重构方案-v3.md §2-D).
 *
 * Builds the prompt, spawns the child, applies the timeout+dispose template and
 * merges large-diff shards, then routes the verdict (`runReview`). Transitions
 * go through the core's fire callback, so the FSM call graph stays auditable
 * in engine.ts.
 */
import type { ReviewVerdict } from '../types.js';
import { isTerminal } from '../types.js';
import type { OrchestratorTask } from '../task/fsm.js';
import {
  mergeShardedVerdicts,
  reviewVerdictJsonSchema,
  reviewVerdictSchema,
  routeVerdict,
} from '../protocols/review.js';
import { MILESTONES } from '../visibility/milestones.js';
import type { AnyAgent, EngineCtx, TransitionFn } from './ctx.js';
import { resolveChildProvider, withTimeoutDispose } from './child-run.js';
import { buildFixDirectiveFromMechanical, buildReviewPrompt } from './prompts.js';

/** Large-diff sharding thresholds (P1-10): above either, split the review. */
const SHARD_FILE_THRESHOLD = 12;
const SHARD_DIFF_THRESHOLD = 800;
const MAX_SHARDS = 4;

/** Outcome of a reviewer dispatch; `'hardfail'` means the core must fire `model/hard-fail`. */
export type ReviewerOutcome = 'ok' | 'deadlock' | 'hardfail';

/** Single verdict from a spawn — null means dispatch failed (deadlock signal). */
export async function dispatchReviewPrompt(
  ctx: EngineCtx,
  task: OrchestratorTask,
  agent: AnyAgent,
  signal: AbortSignal,
  prompt: string,
  model: string,
  provider: string | undefined,
): Promise<ReviewVerdict | null> {
  const runtime = ctx.subagentRuntime();
  if (!runtime?.start) {
    task.snapshot.lastReviewError = 'subagents service missing';
    return null;
  }
  let run: any;
  try {
    // SubagentRuntime.start(providerName, request) — 'spawn' = fresh in-process child
    run = await runtime.start('spawn', {
      parent: agent,
      prompt: [{ type: 'text', text: prompt }],
      signal,
      label: `sub:${task.id}:reviewer`,
      agentOptions: { provider, model },
      outputSchema: reviewVerdictJsonSchema(),
    });
  } catch (e) {
    ctx.logger.warn('orchestrator: reviewer spawn failed: %o', e);
    task.snapshot.lastReviewError = `spawn: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    return null;
  }
  if (run?.id) {
    ctx.childSessions.set(run.id, { taskId: task.id, role: 'reviewer' });
    ctx.registry.trackChild(run.id);
  }
  const timeoutMs = ctx.cfg().circuit_breaker.review_dispatch_timeout_ms;
  const result = await withTimeoutDispose(run?.result, () => run?.dispose?.(), timeoutMs, ctx.logger);
  if (result === null) {
    task.snapshot.lastReviewError = task.snapshot.lastReviewError ?? `reviewer dispatch timed out after ${timeoutMs}ms`;
    return null;
  }
  if (result?.stopReason !== 'completed' || !result?.structured) {
    task.snapshot.lastReviewError = `result: ${JSON.stringify(result ?? null).slice(0, 400)}`;
    return null;
  }
  const parsed = reviewVerdictSchema.safeParse(result.structured);
  if (!parsed.success) {
    task.snapshot.lastReviewError = `schema: ${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ').slice(0, 300)}`;
    return null;
  }
  return parsed.data;
}

export async function dispatchReviewer(
  ctx: EngineCtx,
  task: OrchestratorTask,
  agent: AnyAgent,
  signal: AbortSignal,
  supplementQuestion?: string,
): Promise<ReviewerOutcome> {
  if (isTerminal(task.state)) return 'deadlock'; // aborted mid-run: no ghost reviews
  const runtime = ctx.subagentRuntime();
  if (!runtime?.start) {
    task.snapshot.lastReviewError = 'subagents service missing';
    return 'deadlock';
  }
  const { binding, hardFail } = ctx.router.resolve('review', {
    risk: ctx.riskOf(task.snapshot),
    override: ctx.sessionOverrides.get(task.snapshot.sessionId),
  });
  if (hardFail) return 'hardfail'; // core fires model/hard-fail

  const previous = task.snapshot.reviewHistory.at(-1) ?? null;

  // sharded path (P1-10): big products are reviewed per file-group and merged
  // conservatively; fewer than two usable shards falls back to the single
  // full-scope dispatch, so the legacy path stays byte-identical for small tasks
  const product = task.snapshot.executionProduct;
  const needsSharding =
    (product?.changedFiles.length ?? 0) > SHARD_FILE_THRESHOLD || (product?.diffLines ?? 0) > SHARD_DIFF_THRESHOLD;
  let mergedVerdict: ReviewVerdict | null = null;
  if (needsSharding && !supplementQuestion) {
    const files = product!.changedFiles;
    const shards: string[][] = Array.from({ length: Math.min(MAX_SHARDS, Math.ceil(files.length / SHARD_FILE_THRESHOLD) || 1) }, () => []);
    files.forEach((f, i) => shards[i % shards.length]!.push(f));
    const provider = resolveChildProvider(ctx.host, agent, ctx.lastBinding, binding);
    const shardRuns = shards
      .filter((s) => s.length > 0)
      .map((scopeFiles) =>
        dispatchReviewPrompt(ctx, task, agent, signal, buildReviewPrompt(task, ctx.cfg(), previous, undefined, scopeFiles), binding.model, provider),
      );
    const verdicts = (await Promise.all(shardRuns)).filter((v): v is ReviewVerdict => v !== null);
    if (verdicts.length >= 2) mergedVerdict = mergeShardedVerdicts(verdicts);
    else if (verdicts.length === 1) mergedVerdict = verdicts[0]!; // E6: single shard is better than a wasted full-scope re-dispatch
  }

  let verdict = mergedVerdict;
  if (!verdict) {
    const prompt = buildReviewPrompt(task, ctx.cfg(), previous, supplementQuestion);
    ctx.notice(task.snapshot.sessionId, MILESTONES.reviewing(binding.model));
    const provider = resolveChildProvider(ctx.host, agent, ctx.lastBinding, binding);
    verdict = await dispatchReviewPrompt(ctx, task, agent, signal, prompt, binding.model, provider);
  }
  if (!verdict) return 'deadlock';
  task.snapshot.reviewHistory.push(verdict);
  delete task.snapshot.lastReviewError; // success clears the diagnostic
  // one re-dispatch budget per review round: a success here arms the next
  // round's deadlock retry (the review/pass rows also reset, defensively)
  task.snapshot.counters.review_dispatch_retry = 0;
  return 'ok';
}

// ── verdict routing (the REVIEWING branch of the turn driver) ───────────────

function snapSupplementUsed(task: OrchestratorTask): boolean {
  return task.snapshot.counters.review_supplement >= 1;
}

/**
 * Drive one review round: dispatch → deadlock budget → mechanical verification
 * → verdict route. Transitions go through the core's `fire` callback — this is
 * where `review/pass` / `review/pass:MISS` / `review/ambiguous` /
 * `review/fail-exec` / `review/fail-plan` / `review/deadlock*` are emitted.
 */
export async function runReview(
  engine: EngineCtx,
  fire: TransitionFn,
  task: OrchestratorTask,
  agent: AnyAgent,
  signal: AbortSignal,
): Promise<'steered' | 'ended'> {
  const { notice, pendingSteer, spawner } = engine;
  if (isTerminal(task.state)) return 'ended';
  // P2-20: deadlock re-dispatch used to recurse; a bounded loop instead.
  for (let hops = 0; hops < 8; hops++) {
    const outcome: ReviewerOutcome = await dispatchReviewer(engine, task, agent, signal);
    if (isTerminal(task.state)) return 'ended'; // a hook aborted the task during dispatch
    if (outcome === 'hardfail') {
      await fire(task, 'model/hard-fail');
      return 'ended';
    }
    if (outcome === 'deadlock') {
      const snap = task.snapshot;
      if (snap.counters.review_dispatch_retry < 1) {
        await fire(task, 'review/deadlock'); // increments retry, redispatches
        continue;
      }
      // conservative: treat as execution defect (A2)
      snap.reviewHistory.push({
        planVersion: snap.planVersion,
        pass: false,
        defect_type: 'execution',
        confidence: 0.7,
        issues: [{ id: 'SYN-REVIEW-DEADLOCK', dimension: 'code_quality', severity: 'major', description: '复核器两次未能产出有效结论，保守按执行缺陷处理' }],
      });
      notice(snap.sessionId, MILESTONES.reviewResult(false, 0, 1, 0));
      await fire(task, 'review/deadlock:EXEC');
      return 'steered';
    }
    break;
  }
  const verdict = task.snapshot.reviewHistory.at(-1)!;
  const mech = await spawner.run(task.snapshot.executionProduct?.changedFiles ?? [], false, { signal });
  task.snapshot.mechanicalResult = mech;
  // lint counts like compile/tests when configured (P1-14)
  const checks = [mech.compile, mech.lint, mech.tests].filter(Boolean);
  const mechanicalPass =
    checks.some((c) => c!.check === 'unavailable')
      ? 'unavailable'
      : checks.every((c) => c!.check === 'pass');

  if (!verdict.pass && verdict.defect_type === 'ambiguous' && snapSupplementUsed(task)) {
    // supplement already used once → conservative execution defect
    task.snapshot.counters.review_supplement = 0;
    notice(task.snapshot.sessionId, MILESTONES.reviewResult(false, verdict.issues.filter((i) => i.severity !== 'minor').length, 0, 0));
    await fire(task, 'review/fail-exec');
    return 'steered';
  }

  if (verdict.pass && mechanicalPass === false) {
    task.flags.mechanicalFailedAfterPass = true;
    await fire(task, 'review/pass'); // :MISS variant routes to EXECUTING
    task.flags.mechanicalFailedAfterPass = false;
    pendingSteer.set(task.id, buildFixDirectiveFromMechanical(task));
    notice(task.snapshot.sessionId, '复核通过 ✓ 但机械验证失败，回执行修复（不耗修复轮次）');
    return 'steered';
  }
  if (verdict.pass) {
    await fire(task, 'review/pass');
    return 'ended';
  }
  if (verdict.defect_type === 'ambiguous') {
    // first ambiguous verdict: the review/ambiguous row bumps review_supplement
    // (guard < 1), then the supplement question goes straight back to a reviewer
    await fire(task, 'review/ambiguous');
    const outcome2 = await dispatchReviewer(engine, task, agent, signal, '上一轮结论不明确，请补充证据后给出明确结论。');
    if (outcome2 === 'ok') {
      const v2 = task.snapshot.reviewHistory.at(-1)!;
      if (v2.pass) {
        await fire(task, 'review/pass');
        return 'ended';
      }
      notice(task.snapshot.sessionId, MILESTONES.reviewResult(false, v2.issues.filter((i) => i.severity !== 'minor').length, 0, 0));
    } else {
      // deadlock on the supplement dispatch: same per-round budget handling
      // as the ok-but-fail path — the NEXT review round starts fresh
      notice(task.snapshot.sessionId, MILESTONES.reviewResult(false, 0, 1, 0));
    }
    task.snapshot.counters.review_supplement = 0; // per-round budget (unified)
    await fire(task, 'review/fail-exec'); // conservative default (§4.3)
    return 'steered';
  }
  const route = routeVerdict(verdict, mechanicalPass).route;
  notice(
    task.snapshot.sessionId,
    MILESTONES.reviewResult(
      false,
      verdict.issues.filter((i) => i.severity === 'blocker').length,
      verdict.issues.filter((i) => i.severity === 'major').length,
      verdict.issues.filter((i) => i.severity === 'minor').length,
    ),
  );
  await fire(task, route as 'review/fail-exec' | 'review/fail-plan');
  return 'steered';
}
