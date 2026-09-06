import { MILESTONES } from '../visibility/milestones.js';
import { buildAuditPrompt, buildAuditFeedbackDirective, latestAudit, mergeAuditVerdicts, planAuditVerdictJsonSchema, planAuditVerdictSchema, } from '../protocols/plan-audit.js';
import { isTerminal } from '../types.js';
import { resolveChildProvider, withTimeoutDispose } from './child-run.js';
/** Resolve an auditor's own model, walking its fallback chain on health failure. */
export function bindAuditor(ctx, cfg) {
    if (!ctx.health.isFailed(cfg.provider, cfg.model))
        return { model: cfg.model, provider: cfg.provider };
    for (const fb of cfg.fallback_chain) {
        if (!ctx.health.isFailed(undefined, fb))
            return { model: fb };
    }
    return null;
}
/**
 * Spawn up to two auditor subagents in parallel (spike-verified: the
 * in-process driver locks per child, concurrent runs do not interact).
 * Each child uses the same outputSchema structured contract as the reviewer.
 * Returns null when NO usable verdict could be produced (fail-open signal).
 */
export async function dispatchPlanAuditors(ctx, task, agent, signal, cfgs, previous, response) {
    const runtime = ctx.subagentRuntime();
    if (!runtime?.start) {
        task.snapshot.lastReviewError = 'subagents service missing (plan-audit)';
        return null;
    }
    const realCfgs = (cfgs ?? []);
    const spawned = [];
    for (const [idx, cfg] of realCfgs.entries()) {
        const binding = bindAuditor(ctx, cfg);
        if (!binding) {
            ctx.logger.warn(`orchestrator: plan auditor #${idx + 1} (${cfg.model}) circuit-open, skipping`);
            continue;
        }
        const prompt = buildAuditPrompt({
            goal: task.snapshot.goal,
            plan: task.snapshot.plan,
            auditorIndex: idx + 1,
            previous,
            response,
        });
        const provider = resolveChildProvider(ctx.host, agent, ctx.lastBinding, binding);
        try {
            const run = await runtime.start('spawn', {
                parent: agent,
                prompt: [{ type: 'text', text: prompt }],
                signal,
                label: `sub:${task.id}:auditor-${idx + 1}`,
                agentOptions: { provider, model: binding.model },
                outputSchema: planAuditVerdictJsonSchema(),
            });
            if (!run)
                throw new Error('subagents.start returned no run handle');
            if (run.id) {
                ctx.childSessions.set(run.id, { taskId: task.id, role: 'auditor' });
                ctx.registry.trackChild(run.id);
            }
            spawned.push({ idx, model: binding.model, run });
        }
        catch (e) {
            ctx.logger.warn('orchestrator: plan auditor #%d spawn failed: %o', idx + 1, e);
        }
    }
    if (spawned.length === 0)
        return null;
    const timeoutMs = ctx.cfg().circuit_breaker.audit_dispatch_timeout_ms; // P2-04
    const settled = await Promise.all(spawned.map(async ({ idx, run }) => {
        const result = await withTimeoutDispose(run?.result, () => run?.dispose?.(), timeoutMs, ctx.logger);
        if (result === null || result?.stopReason !== 'completed' || !result?.structured)
            return null;
        const parsed = planAuditVerdictSchema.safeParse(result.structured);
        if (!parsed.success) {
            ctx.logger.warn('orchestrator: plan auditor #%d verdict schema invalid', idx + 1);
            return null;
        }
        return { idx, verdict: parsed.data };
    }));
    const verdicts = settled.filter((s) => Boolean(s)).map((s) => s.verdict);
    if (verdicts.length === 0)
        return null;
    const skipped = spawned.length - verdicts.length;
    if (skipped > 0)
        ctx.logger.warn('orchestrator: %d/%d plan auditor(s) produced no verdict (partial degradation)', skipped, spawned.length);
    return { merged: mergeAuditVerdicts(verdicts), skipped };
}
export { latestAudit };
// ── v5.2 plan-audit gate ────────────────────────────────────────────────────
/**
 * The audit gate at turn's end: runs when the fence parser parked a plan
 * (pendingPlanAudit) and auditors are configured. Returns true when the turn
 * is fully handled (gate cleared or failed the plan); false → fall through
 * to the legacy planning/replanning paths. Transitions go through the core's
 * `fire` callback.
 */
export async function runAuditGateIfPending(engine, fire, task, agent, signal) {
    const auditCfgs = engine.cfg().stages?.plan_audit ?? [];
    if (!task.pendingPlanAudit || auditCfgs.length === 0)
        return false;
    if (isTerminal(task.state))
        return true;
    const snap = task.snapshot;
    const sessionId = snap.sessionId;
    const response = task.pendingPlanAudit.response;
    task.pendingPlanAudit = undefined;
    const previous = latestAudit(snap.planAudit);
    const st = task.state;
    const okEvent = st === 'RE-PLANNING' ? 'replan/ok' : 'plan/ok';
    const failEvent = st === 'RE-PLANNING' ? 'replan/fail' : 'plan/fail';
    const modelsText = auditCfgs.map((c) => c.model).join(' / ');
    engine.notice(sessionId, MILESTONES.planAuditing(modelsText));
    const outcome = await dispatchPlanAuditors(engine, task, agent, signal, auditCfgs, previous, response);
    const recordRound = (merged, passed) => {
        snap.planAudit.push({
            planVersion: snap.plan?.version ?? snap.planVersion,
            round: snap.planAudit.length + 1,
            issues: merged.issues,
            adopted: response?.adopted ?? [],
            rebutted: (response?.rebutted ?? []).map((r) => {
                const v = merged.rebuttals.find((x) => x.id === r.id);
                return { id: r.id, justification: r.justification, accepted: v?.accepted, note: v?.note };
            }),
            passed,
        });
    };
    const planComplete = () => {
        engine.notice(sessionId, MILESTONES.planComplete(snap.plan?.steps.length ?? 0, snap.plan?.complexity ?? '?', engine.sessionEffective(sessionId).stages?.plan?.model ?? '?'));
    };
    if (!outcome) {
        // fail-open (design §6): audit infrastructure unavailable — never let a
        // broken auditor chain hold every task hostage
        snap.auditSkipped += 1;
        engine.notice(sessionId, MILESTONES.planAuditSkipped());
        const ok = await fire(task, okEvent);
        if (ok) {
            planComplete();
            engine.directive(sessionId, `【编排·执行】计划 v${snap.planVersion} 已开始执行。目标与步骤见系统提示，严格按计划推进。`);
        }
        return true;
    }
    const { merged } = outcome;
    recordRound(merged, merged.passed);
    if (merged.passed) {
        engine.notice(sessionId, MILESTONES.planAuditPassed(modelsText));
        const ok = await fire(task, okEvent);
        if (ok) {
            planComplete();
            engine.directive(sessionId, `【编排·执行】计划 v${snap.planVersion} 已获审计通过，开始按系统提示严格执行。`);
        }
        return true;
    }
    // audit failed → plan/fail consumes plan_retry (D2), then reinject with
    // the full negotiation record
    await fire(task, failEvent);
    const blocked = merged.issues.filter((i) => i.severity !== 'minor').length;
    const rejected = merged.rebuttals.filter((r) => !r.accepted).length;
    engine.notice(sessionId, MILESTONES.planAuditFailed(blocked, rejected, snap.counters.plan_retry, engine.cfg().limits.plan_retry_max));
    engine.pendingSteer.set(task.id, null); // the reinject hook's generic text must not linger
    const retryOk = await fire(task, 'plan/retry');
    if (retryOk && !isTerminal(task.state)) {
        engine.pendingSteer.set(task.id, null); // clear the hook-installed generic text again
        const latest = snap.planAudit[snap.planAudit.length - 1];
        engine.directive(sessionId, buildAuditFeedbackDirective({
            goal: snap.goal,
            round: latest,
            maxRetries: engine.cfg().limits.plan_retry_max,
            digest: snap.planDigested,
        }));
    }
    return true;
}
//# sourceMappingURL=audit.js.map