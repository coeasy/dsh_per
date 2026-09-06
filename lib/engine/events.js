/**
 * Session event firehose (accounting, plan detection, NEED_REPLAN capture).
 *
 * Transition stays in the core: every `plan/ok` / `plan/fail` / `circuit/broken`
 * here goes through the core's `fire` (transitionOrLog) callback
 * (docs/重构方案-v3.md §2-D).
 */
import { isTerminal } from '../types.js';
import { extractFencedPlan, parsePlan } from '../protocols/plan.js';
import { MILESTONES } from '../visibility/milestones.js';
import { accountUsage } from './accounting.js';
import { diffLinesFromMeta, textOfContent } from './util.js';
export async function onSessionEvent(engine, fire, session, event) {
    const { childSessions, registry, lastBinding, clock } = engine;
    const sessionId = session?.id;
    if (!sessionId)
        return;
    const child = childSessions.get(sessionId);
    const task = child ? registry.get(child.taskId) : registry.activeForSession(sessionId);
    if (event.type === 'assistant/message') {
        const usage = event.data?.usage;
        const text = textOfContent(event.data?.message?.content);
        if (usage) {
            // the module debits + evaluates the breakers and reports the event it
            // wants; emission stays in the core via `fire`
            const wanted = accountUsage(engine, task, child, sessionId, usage);
            if (wanted) {
                const t = child ? registry.get(child.taskId) : task;
                if (t)
                    await fire(t, wanted);
            }
        }
        if (!task || isTerminal(task.state))
            return;
        // ALL child messages (reviewer/auditor) are accounted but never drive the
        // parent FSM: an auditor quoting the plan in its reply must not re-trigger
        // fence detection on the parked parent state
        if (child)
            return;
        const st = task.state;
        if (st === 'PLANNING' || st === 'RE-PLANNING') {
            const fenced = extractFencedPlan(text);
            if (fenced === null)
                return;
            const parsed = parsePlan(fenced);
            if (parsed.ok) {
                task.flags.planSchemaOk = true;
                task.attachPlan(parsed.plan);
                const auditCfgs = engine.cfg().stages?.plan_audit ?? [];
                if (auditCfgs.length === 0) {
                    await fire(task, st === 'RE-PLANNING' ? 'replan/ok' : 'plan/ok');
                    engine.notice(task.snapshot.sessionId, MILESTONES.planComplete(parsed.plan.steps.length, parsed.plan.complexity, lastBinding.get(sessionId)?.model ?? '?'));
                }
                else {
                    // v5.2: park the plan; the audit gate clears it at turn's end
                    task.pendingPlanAudit = { response: parsed.auditResponse ?? null };
                }
            }
            else {
                task.lastPlanError = parsed.error;
                task.flags.planSchemaOk = false;
                await fire(task, st === 'RE-PLANNING' ? 'replan/fail' : 'plan/fail');
            }
            return;
        }
        if (st === 'EXECUTING') {
            if (text.includes('[NEED_REPLAN]'))
                task.snapshot.needReplan = true;
        }
        return;
    }
    if (event.type === 'turn/start' && task && !isTerminal(task.state)) {
        // execErrorCount is a per-turn signal (drives exec/fail at the stop
        // boundary) — reset it when each root-session execution turn begins
        if (task.state === 'EXECUTING' && !child)
            task.snapshot.execErrorCount = 0;
        // E9: wall-clock breaker is independent of usage — a task stuck far
        // past its budget must not linger even if the model stops reporting usage
        if (clock() - task.snapshot.startedAt > engine.cfg().circuit_breaker.wall_clock_max_min * 60_000) {
            await fire(task, 'circuit/broken');
        }
        return;
    }
    if (event.type === 'tool/result' && task && !isTerminal(task.state)) {
        const isError = Boolean(event.data?.error);
        // child-side (reviewer/auditor) tool failures are the child's own problem
        // — they must not count as EXECUTION errors or they would wrongly
        // trigger exec/fail on the parent task
        if (isError && !child)
            task.snapshot.execErrorCount++;
        const dl = diffLinesFromMeta(event.data?.meta);
        if (dl > 0 && !child) {
            task.snapshot.executionProduct = task.snapshot.executionProduct ?? { diffLines: 0, changedFiles: [], errorCount: 0 };
            task.snapshot.executionProduct.diffLines += dl;
        }
        return;
    }
    if (event.type === 'step/end' && task && !isTerminal(task.state)) {
        const stage = child?.role === 'reviewer' ? 'review' : engine.stageOfState(task.state);
        // auditor children work inside the plan gate: their steps never count
        // toward the planning-steps budget
        if (child?.role !== 'auditor')
            task.snapshot.stageSteps[stage]++;
        // audit trail (§11.2): one line per executed step, kept bounded
        task.snapshot.executionLog.push({
            turn: Number(event.data?.turn ?? 0),
            step: Number(event.data?.step ?? 0),
            at: clock(),
            summary: `${child ? `sub:${child.role}` : stage} step`,
        });
        // P2-07: trim bound is config, not magic — past the cap keep the newest half
        const logMax = engine.cfg().limits.execution_log_max;
        if (task.snapshot.executionLog.length > logMax)
            task.snapshot.executionLog = task.snapshot.executionLog.slice(-Math.ceil(logMax / 2));
    }
}
//# sourceMappingURL=events.js.map