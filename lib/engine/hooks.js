/**
 * Task transition hooks (docs/重构方案-v3.md §2-D).
 *
 * The data-driven transition table (src/task/transition-table.ts) names these
 * hooks; the FSM invokes them after applying counters/guards. They contain no
 * `transition()` call of their own — emission stays in engine.ts — so moving
 * them out of the core is a pure data extraction: `buildHooks(ctx)` returns
 * the same object the engine used to assemble inline.
 */
import { estimateTokens } from '../protocols/plan.js';
import { MILESTONES, renderAuditNote, renderPlanSummary } from '../visibility/milestones.js';
import { buildFixDirective, buildReplanDirective, replanOkMilestone } from './prompts.js';
export function buildHooks(ctx) {
    const hooks = {
        handoffBudgetCheck: (task) => {
            const plan = task.snapshot.plan;
            if (!plan)
                return;
            const tokens = estimateTokens(JSON.stringify(plan));
            if (tokens > plan.estimated_context_tokens * 0.8)
                task.snapshot.planDigested = true;
        },
        recordPlanFailure: (task) => {
            ctx.notice(task.snapshot.sessionId, `规划产出未通过校验（第 ${task.counter('plan_retry')}/${ctx.cfg().limits.plan_retry_max} 次），将带错误重试`);
        },
        recordPlanWandering: (task) => {
            ctx.notice(task.snapshot.sessionId, `规划步数超限（>${ctx.cfg().limits.planning_steps_max}），按质量失败处理`);
        },
        reinjectPlanningWithError: (task) => {
            const digest = task.snapshot.planDigested ? '\n（注意：计划已超出上下文预算，请输出精简版计划——每步仅保留标题与目标文件。）' : '';
            ctx.pendingSteer.set(task.id, `【规划重试】上一次计划未通过校验，请修正后重新输出完整 \`\`\`plan 围栏 JSON。${digest}`);
        },
        collectProduct: (task) => {
            task.snapshot.executionProduct = task.snapshot.executionProduct ?? { diffLines: 0, changedFiles: [], errorCount: task.snapshot.execErrorCount };
        },
        finalizeReport: (task) => {
            const snap = task.snapshot;
            ctx.notice(snap.sessionId, MILESTONES.done(renderPlanSummary(snap), ctx.costLine(task) + renderAuditNote(snap)));
            ctx.settle(task);
        },
        deliverFlagged: (task) => {
            const last = task.snapshot.reviewHistory.at(-1);
            const unresolved = last?.issues.filter((i) => i.severity !== 'minor').length ?? 1;
            const snap = task.snapshot;
            ctx.notice(task.snapshot.sessionId, MILESTONES.doneFlagged(task.snapshot.counters.fix_cycle, unresolved, renderPlanSummary(snap), ctx.costLine(task) + renderAuditNote(snap)));
            ctx.settle(task);
        },
        abortReplanExhausted: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('重规划预算耗尽（计划质量重试已用尽）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortBudgetExhausted: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('预算触顶', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortFixExhausted: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('修复轮次耗尽（exhausted_delivery=abort）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortUserCancelled: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('用户取消', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortCircuitBroken: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('熔断（调用/令牌/墙钟超限）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortModelUnavailable: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('模型不可用且不可降级', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortStaleSnapshot: (task) => {
            // boot-time recovery: the task never ran in this process, so no agent is
            // registered and `notice` is a no-op — the value is a correct persisted
            // reason instead of the previous generic「守卫链溢出」
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('宿主重启前的残留任务已放弃（v1 不恢复旧会话）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortGuardOverflow: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('迁移守卫链溢出（回退超过 2 层）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortGuardRejected: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('迁移被守卫拒绝（事件与当前状态不匹配）', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        abortGeneric: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.aborted('内部错误', ctx.costLine(task) + renderAuditNote(task.snapshot)));
            ctx.settle(task);
        },
        fixFromMechanicalMiss: (task) => {
            ctx.notice(task.snapshot.sessionId, '复核通过但机械验证失败（复核漏判），回执行阶段修复（不消耗修复轮次）');
        },
        injectSupersedeAndPlan: (task) => {
            ctx.notice(task.snapshot.sessionId, replanOkMilestone(task));
        },
        injectFixes: (task) => {
            const snap = task.snapshot;
            const cfg = ctx.cfg();
            // C3: `fsm.applyAction` always strips minor-severity issues from the fix
            // queue (the historic `report_only` policy). `minor_issues: 'fix'`
            // re-admits them here, immediately before the directive is built — the
            // trade is real fix-round budget for issues that would otherwise only be
            // reported.
            if (cfg.fix_loop.minor_issues === 'fix') {
                const seen = new Set(snap.pendingFixes.map((i) => i.id));
                for (const issue of snap.reviewHistory.at(-1)?.issues ?? []) {
                    if (issue.severity === 'minor' && !seen.has(issue.id)) {
                        snap.pendingFixes.push(issue);
                        seen.add(issue.id);
                    }
                }
            }
            // ADR #18: `recordStreaks` ran in `applyAction` before this hook, so the
            // per-issue fail streaks are current. Decide escalation HERE and write it
            // back — nothing else ever set `fixEscalated`, which left the whole
            // escalation branch (fixer routing per ADR #28) unreachable (P0-02).
            snap.fixEscalated = task.computeEscalation(cfg.fix_loop.escalate_after_consecutive_fails);
            const escalated = snap.fixEscalated;
            const count = snap.pendingFixes.length;
            ctx.notice(snap.sessionId, MILESTONES.fixRound(snap.counters.fix_cycle, cfg.fix_loop.max_cycles, count, escalated ? 1 : 0));
            ctx.pendingSteer.set(task.id, buildFixDirective(task, cfg));
        },
        replanWithNeedReplanFeedback: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.replanning('执行中遇到计划未覆盖的情况'));
            ctx.pendingSteer.set(task.id, buildReplanDirective(task, '执行者报告 [NEED_REPLAN]：计划未覆盖当前情况，请修订计划。'));
        },
        replanWithExecDefectFeedback: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.replanning('执行多次失败，疑似计划缺陷'));
            ctx.pendingSteer.set(task.id, buildReplanDirective(task, '执行阶段多次失败，请评估是否计划缺陷并修订计划。'));
        },
        replanWithGranularityFeedback: (task) => {
            ctx.notice(task.snapshot.sessionId, MILESTONES.replanning('执行步数超限，计划粒度过粗'));
            ctx.pendingSteer.set(task.id, buildReplanDirective(task, `执行步数超过 ${ctx.cfg().limits.executing_steps_max}，计划粒度过粗，请拆解步骤。`));
        },
        replanWithReviewFeedback: (task) => {
            const last = task.snapshot.reviewHistory.at(-1);
            const issues = last?.issues.map((i) => `- [${i.severity}] ${i.description}`).join('\n') ?? '';
            ctx.notice(task.snapshot.sessionId, MILESTONES.replanning('复核判定计划缺陷'));
            ctx.pendingSteer.set(task.id, buildReplanDirective(task, `复核判定为计划缺陷，问题清单：\n${issues}`));
        },
        retrySamePlan: (task) => {
            // exec/fail: execution-side retry — replay the SAME plan step work with a
            // fresh directive (counter ops already bumped exec_retry)
            const snap = task.snapshot;
            snap.execErrorCount = 0; // only consecutive-turn errors retrigger exec/fail
            ctx.notice(snap.sessionId, `【编排】执行出现错误，重试当前计划步骤（第 ${snap.counters.exec_retry}/${task.limits.exec_retry_max} 次）`);
            ctx.pendingSteer.set(task.id, `【编排·执行重试】上一次执行发生工具错误，请继续按计划 v${snap.planVersion} 完成未竟步骤，避免重复已完成的工作。`);
        },
    };
    return hooks;
}
//# sourceMappingURL=hooks.js.map