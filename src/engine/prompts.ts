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
import { estimateTokens } from '../protocols/plan.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { ReviewVerdict, TaskSnapshot } from '../types.js';

/**
 * Every reviewer prompt starts with this marker. `handleUserInput` filters on
 * it because a reviewer/auditor child delivers its own prompt as a user
 * message in its own session, and `run.id` differs from the child session id
 * — the `childSessions` map cannot catch it (E2E defect #7).
 */
export const REVIEW_PROMPT_MARKER = '你是独立的复核员';

/** P2-08/P1-10: plan skeleton — ids/titles/files only, no prose fields. */
export function skeletonPlan(plan: TaskSnapshot['plan']): string {
  if (!plan) return '';
  return JSON.stringify({
    version: plan.version,
    steps: plan.steps.map((s) => ({ id: s.id, title: s.title, ...(s.files?.length ? { files: s.files } : {}) })),
    complexity: plan.complexity,
  });
}

/** Compact mechanical-verification line for the review prompt. */
export function mechSummary(snap: TaskSnapshot): string {
  const m = snap.mechanicalResult;
  if (!m || (!m.compile && !m.tests)) return '未运行';
  const fmt = (c: { check: string; summary?: string } | undefined) => (c ? `${c.check}${c.summary ? `(${c.summary})` : ''}` : null);
  return [fmt(m.compile), fmt(m.tests)].filter(Boolean).join(' / ') || '未运行';
}

/** New-plan milestone (was the misspelled `MILESTONS_REPLAN_OK`, v3 E7). */
export function replanOkMilestone(task: OrchestratorTask): string {
  return `【编排】新计划 v${task.snapshot.planVersion} 生效，重新开始执行`;
}

export function buildFixDirective(task: OrchestratorTask, cfg: OrchestratorConfig): string {
  const items = task.snapshot.pendingFixes
    .map((f, i) => `${i + 1}. [${f.severity}/${f.dimension}] ${f.description}${f.location ? ` @ ${f.location}` : ''}`)
    .join('\n');
  const user = task.snapshot.userDirectives.length ? `\n【用户补充指令】（优先级最高）\n${task.snapshot.userDirectives.join('\n')}` : '';
  const escal = task.snapshot.fixEscalated ? '\n（本轮由规划模型升级修复）' : '';
  // C1: `strategy: 'batch'` trades per-issue fidelity for convergence — one
  // pass over all issues, ordered by dependency, instead of one per round.
  const batchNote =
    cfg.fix_loop.strategy === 'batch'
      ? '（批量修复模式：按依赖关系一次性收敛全部问题，不要逐点反复返工）\n'
      : '';
  return `【修复指令】${batchNote}只修复以下问题点，保留其余成果，不做计划外改动：\n${items}${user}${escal}`;
}

export function buildReplanDirective(task: OrchestratorTask, feedback: string): string {
  return `【重规划】${feedback}\n请基于执行反馈修订计划，并重新输出完整 \`\`\`plan 围栏 JSON（作废旧计划 v${task.snapshot.planVersion}）。`;
}

export function buildFixDirectiveFromMechanical(task: OrchestratorTask): string {
  const mech = task.snapshot.mechanicalResult;
  const detail = [mech?.compile?.summary ?? mech?.compile?.tail?.slice(0, 200), mech?.tests?.summary ?? mech?.tests?.tail?.slice(0, 200)]
    .filter(Boolean)
    .join('\n');
  return `【修复指令】复核通过但机械验证失败，请修复以下验证问题：\n${detail}`;
}

/**
 * Build the reviewer prompt (P1-10): when it exceeds `review.input_token_budget`
 * the plan degrades to its skeleton (and finally to a bare stats line) so a big
 * plan cannot blow the reviewer's context and deadlock the pipeline.
 */
export function buildReviewPrompt(
  task: OrchestratorTask,
  cfg: OrchestratorConfig,
  previous: ReviewVerdict | null,
  supplementQuestion?: string,
  scopeFiles?: string[],
): string {
  const snap = task.snapshot;
  const budget = cfg.stages?.review?.input_token_budget ?? 50_000;
  // C4: `stages.review.dimensions` scopes what the reviewer is asked to
  // check. The scope is stated in the prompt itself so a reviewer working a
  // reduced set cannot be judged on issues it was never asked to find — the
  // v2 prompt hard-coded the full set regardless of the config value.
  const dimensions = cfg.stages?.review?.dimensions ?? 'full';
  const dimensionScope =
    dimensions === 'defects_only'
      ? '代码质量 + 边界条件 + 安全隐患 + 测试覆盖（本次不评计划符合度）'
      : dimensions === 'consistency_only'
        ? '计划符合度 + 文件改动一致性（本次不评代码质量/边界/安全/测试）'
        : '计划符合度 + 代码质量 + 边界条件 + 安全隐患 + 测试覆盖';
  const assemble = (planText: string, planNote?: string) => {
    const parts = [
      `${REVIEW_PROMPT_MARKER}（检测模型）。对以下执行产物做复核（ADR #17）：${dimensionScope}。`,
      `【目标】${snap.goal}`,
      planNote ? `【计划 v${snap.plan?.version ?? 0}】${planText}\n（${planNote}）` : `【计划 v${snap.plan?.version ?? 0}】${planText}`,
      `【产物】diff 行数 ${snap.executionProduct?.diffLines ?? 0}；错误数 ${snap.execErrorCount}；机械验证 ${mechSummary(snap)}`,
    ];
    if (scopeFiles) parts.push(`【分片范围】本轮只复核以下文件的改动：${scopeFiles.join(', ')}`);
    if (previous) {
      parts.push(`【上一轮问题清单】（沿用未修复问题的 id，修复成功的问题不要再出现）\n${JSON.stringify(previous.issues.slice(-10))}`);
    }
    if (supplementQuestion) parts.push(`【补证请求】${supplementQuestion}`);
    parts.push(
      `【输出】严格输出 ReviewVerdict JSON：{planVersion, pass, defect_type: 'execution'|'plan'|'ambiguous', confidence: 0~1, issues: [{id, dimension, severity, description, location?}]}`,
      `【规则】confidence<0.7 或不确定时 defect_type 用 ambiguous；按 issue 粒度给出稳定 id（I1、I2…沿用上一轮编号）；minor 问题不阻塞交付。`,
    );
    return parts.join('\n\n');
  };
  const full = assemble(JSON.stringify(snap.plan));
  if (estimateTokens(full) <= budget) return full;
  const trimmed = assemble(skeletonPlan(snap.plan), '计划已裁剪为骨架以符合复核输入预算');
  if (estimateTokens(trimmed) <= budget) return trimmed;
  // Dropping the plan entirely is fine for `full`/`defects_only` (both can
  // still judge the product), but it empties out `consistency_only` — say so
  // instead of letting the reviewer report a pass on nothing.
  const planlessNote =
    dimensions === 'consistency_only'
      ? '计划已省略以符合复核输入预算，本次无法完成计划符合度复核'
      : '计划已省略以符合复核输入预算，仅按产物与问题清单复核';
  return assemble('', planlessNote);
}
