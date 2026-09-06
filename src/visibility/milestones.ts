import type { TaskSnapshot } from '../types.js';

/** Clip long free text for push messages; Chinese-safe (no word boundaries). */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Milestone push messages (v5.0 §10 + ADR #14). Templates are constants for snapshot tests. */
export const MILESTONES = {
  planComplete: (steps: number, complexity: string, model: string) =>
    `【编排】规划完成（${model}）：${steps} 步，复杂度 ${complexity}`,
  executing: (model: string, steps: number, queueNote?: string) =>
    `【编排】开始执行（${model}），计划 ${steps} 步${queueNote ?? ''}`,
  reviewing: (model: string) => `【编排】开始复核（${model}）`,
  reviewResult: (pass: boolean, blockers: number, majors: number, minors: number) =>
    pass
      ? '【编排】复核通过 ✓'
      : `【编排】复核发现 ${blockers + majors} 个问题（${blockers} blocker ${majors} major${minors ? ` ${minors} minor` : ''}），开始修复`,
  fixRound: (round: number, max: number, count: number, escalated: number) =>
    `【编排】第 ${round}/${max} 轮修复：${count} 个问题${escalated ? `（含 ${escalated} 个升级修复）` : ''}`,
  done: (summary: string, cost: string) => `【编排】任务完成 ✓ ${summary}｜成本 ${cost}`,
  doneFlagged: (fixRounds: number, unresolved: number, summary: string, cost: string) =>
    `⚠️【编排】${fixRounds} 轮修复后仍有 ${unresolved} 个问题未解决，产物已交付，请自行评估：${summary}｜成本 ${cost}`,
  aborted: (reason: string, spent: string) => `⚠️【编排】任务终止（${reason}），已消耗 ${spent}`,
  queued: (position: number) => `【编排】任务排队中，当前排在第 ${position} 位`,
  /** Queue head picked up after the previous task settled — no plan exists yet,
   *  so no step count may appear here (that belongs to `executing`). */
  launching: (goal: string, queueNote?: string) =>
    `【编排】排队任务启动：${truncate(goal, 60)}${queueNote ?? ''}`,
  launchRejected: (reason: string) => `【编排】任务未启动：${reason}`,
  replanning: (feedback: string) => `【编排】计划缺陷，带反馈重规划：${feedback.slice(0, 120)}`,
  // v5.2 plan-audit milestones
  planAuditing: (models: string) => `【编排】开始计划审计（${models}）`,
  planAuditPassed: (models: string) => `【编排】计划审计通过 ✓（${models}）`,
  planAuditFailed: (blocked: number, rejected: number, round: number, max: number) =>
    `【编排】计划审计不通过：${blocked} 个 blocker/major 问题${rejected ? `（驳回 ${rejected} 条无正当理由反驳）` : ''}，带反馈重写（第 ${round}/${max} 次）`,
  planAuditSkipped: () => `【编排】计划审计不可用，放行本版计划`,
} as const;

export function renderPlanSummary(snapshot: TaskSnapshot): string {
  const plan = snapshot.plan;
  if (!plan) return '（无计划）';
  const files = new Set(plan.steps.flatMap((s) => s.files ?? []));
  return `${plan.steps.length} 步 / ${files.size} 文件 / 复杂度 ${plan.complexity}`;
}

export function renderCost(snapshot: TaskSnapshot, dailySpent: number, dailyLimit: number): string {
  return `¥${snapshot.spentCny.toFixed(3)}（今日 ¥${dailySpent.toFixed(2)}/¥${dailyLimit.toFixed(2)}）`;
}

/** v5.2: factual audit trailing note for final reports ('' when audit never ran). */
export function renderAuditNote(snapshot: TaskSnapshot): string {
  const parts: string[] = [];
  const history = snapshot.planAudit ?? [];
  if (history.length > 0) {
    const passed = history[history.length - 1]!.passed;
    parts.push(`审计 ${history.length} 轮（终判${passed ? '通过' : '不通过'}）`);
  }
  if (snapshot.auditSkipped) parts.push(`审计放行 ${snapshot.auditSkipped} 次`);
  return parts.length ? `｜${parts.join('，')}` : '';
}
