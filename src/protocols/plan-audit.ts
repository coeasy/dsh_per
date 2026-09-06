import { z } from 'zod';
import type { PlanAuditRound, PlanDocument, ReviewIssue } from '../types.js';

/**
 * Plan-audit protocol (v5.2): zero to two auditor models review each plan
 * version before it reaches execution. A failed audit feeds a negotiation
 * record back to the planner through the existing plan/fail → reinject path.
 * Conservative-union arbitration (D1); plan_retry budget reuse (D2).
 */

export const AUDIT_PROMPT_MARKER = '你是独立的计划审计员';

export const auditIssueSchema = z.object({
  id: z.string().min(1), // IA1, IA2, ... stable across rounds (M5-style contract)
  dimension: z.enum(['feasibility', 'granularity', 'risk_coverage', 'file_consistency']),
  severity: z.enum(['blocker', 'major', 'minor']),
  description: z.string().min(1),
  location: z.string().optional(),
  suggestion: z.string().min(1), // negotiation input: what exactly to change
});

export const rebuttalVerdictSchema = z.object({
  id: z.string().min(1),
  accepted: z.boolean(),
  note: z.string().min(1),
});

export const planAuditVerdictSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  issues: z.array(auditIssueSchema),
  rebuttal_verdicts: z.array(rebuttalVerdictSchema).default([]),
});

export type PlanAuditVerdict = z.infer<typeof planAuditVerdictSchema>;
export type AuditIssue = z.infer<typeof auditIssueSchema>;

/** JSON-Schema projection for subagent outputSchema (restricted subset, same craft as the reviewer verdict). */
export function planAuditVerdictJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['passed', 'confidence', 'issues'],
    properties: {
      passed: { type: 'boolean' },
      confidence: { type: 'number' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'dimension', 'severity', 'description', 'suggestion'],
          properties: {
            id: { type: 'string' },
            dimension: { type: 'string', enum: ['feasibility', 'granularity', 'risk_coverage', 'file_consistency'] },
            severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
            description: { type: 'string' },
            location: { type: 'string' },
            suggestion: { type: 'string' },
          },
        },
      },
      rebuttal_verdicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'accepted', 'note'],
          properties: {
            id: { type: 'string' },
            accepted: { type: 'boolean' },
            note: { type: 'string' },
          },
        },
      },
    },
  };
}

export interface MergedAudit {
  passed: boolean;
  confidence: number;
  issues: AuditIssue[];
  /** per rebutted id: conservative union — accepted only when every auditor accepted */
  rebuttals: Array<{ id: string; accepted: boolean; note: string }>;
}

const SEV_RANK: Record<string, number> = { minor: 0, major: 1, blocker: 2 };

/** Conservative-union arbitration across 1-2 auditor verdicts (D1). */
export function mergeAuditVerdicts(verdicts: PlanAuditVerdict[]): MergedAudit {
  const minConfidence = verdicts.length ? Math.min(...verdicts.map((v) => v.confidence)) : 0;
  const byId = new Map<string, AuditIssue>();
  for (const v of verdicts) {
    for (const issue of v.issues) {
      const prev = byId.get(issue.id);
      byId.set(issue.id, prev && SEV_RANK[prev.severity]! >= SEV_RANK[issue.severity]! ? prev : issue);
    }
  }
  // D1 strict reading: a blocker/major issue in the union blocks regardless of
  // the auditors' own passed flags (an auditor passing WITH a major issue is
  // treated as inconsistent and resolved conservatively)
  const hasBlocking = [...byId.values()].some((i) => i.severity !== 'minor');
  const passed = verdicts.length > 0 && verdicts.every((v) => v.passed) && minConfidence >= 0.7 && !hasBlocking;
  const rebuttalNotes = new Map<string, { accepted: boolean; notes: string[] }>();
  for (const v of verdicts) {
    for (const r of v.rebuttal_verdicts) {
      const cur = rebuttalNotes.get(r.id) ?? { accepted: true, notes: [] };
      cur.accepted = cur.accepted && r.accepted;
      if (!r.accepted) cur.notes.push(r.note);
      rebuttalNotes.set(r.id, cur);
    }
  }
  return {
    passed,
    confidence: minConfidence,
    issues: [...byId.values()],
    rebuttals: [...rebuttalNotes.entries()].map(([id, r]) => ({ id, accepted: r.accepted, note: r.notes.join('；') || '无异议' })),
  };
}

/** Most recent audit round, or null when the gate has not run yet. */
export function latestAudit(history: PlanAuditRound[] | undefined): PlanAuditRound | null {
  return history && history.length > 0 ? history[history.length - 1]! : null;
}

/** Build the auditor prompt (r=1 plain audit; r≥2 with negotiation context). */
export function buildAuditPrompt(args: {
  goal: string;
  plan: PlanDocument;
  auditorIndex: number;
  previous: PlanAuditRound | null;
  response: { adopted: string[]; rebutted: Array<{ id: string; justification: string }> } | null;
}): string {
  const parts = [
    `${AUDIT_PROMPT_MARKER} #${args.auditorIndex}。你是规划阶段的质量门：对以下计划做独立审计，不执行任何代码。`,
    `【审计维度】1) 可行性（每步可执行、依赖闭环）2) 粒度（单步不过粗、无超宽变更）3) 风险覆盖（敏感路径/回滚/测试遗漏）4) 文件一致性（与目标及约束冲突、漏文件）`,
    `【目标】${args.goal}`,
    `【计划 v${args.plan.version}】${JSON.stringify({ steps: args.plan.steps, complexity: args.plan.complexity, review_hint: args.plan.review_hint, risk_level: args.plan.risk_level })}`,
  ];
  if (args.previous) {
    parts.push(
      `【上轮审计问题】${JSON.stringify(args.previous.issues)}`,
      `【规划者响应】采纳：${JSON.stringify(args.response?.adopted ?? [])}；反驳：${JSON.stringify(args.response?.rebutted ?? [])}`,
      `【本轮职责】逐条验证：① 已采纳问题是否真正修复；② 反驳是否成立（在 rebuttal_verdicts 给出 accepted 与 note）；③ 按四维重新扫查新版计划。问题沿用稳定 id（IA1、IA2…），已结案的 id 不得再出现。`,
    );
  }
  parts.push(
    `【输出】严格通过 structured_output 提交 PlanAuditVerdict JSON：{passed, confidence, issues:[{id,dimension,severity,description,location?,suggestion}], rebuttal_verdicts:[{id,accepted,note}]}。`,
    `【规则】不确定或证据不足时 passed=false 并降低 confidence；blocker/major 必须给出 suggestion；没有问题则 issues 为空、passed=true。`,
  );
  return parts.join('\n\n');
}

/** Rewrite directive back to the planner carrying the negotiation record (round r→r+1). */
export function buildAuditFeedbackDirective(args: { goal: string; round: PlanAuditRound; maxRetries: number; digest?: boolean }): string {
  const { round, maxRetries, digest } = args;
  const issueLines = round.issues
    .map((i, n) => `${n + 1}. [${i.severity}/${i.dimension}] ${i.description}${i.location ? ` @ ${i.location}` : ''}\n   修改建议：${i.suggestion ?? '（审计员未给建议，自行判断）'}`)
    .join('\n');
  const rejected = round.rebutted.filter((r) => r.accepted === false);
  const rejectedBlock = rejected.length
    ? `\n【被驳回的反驳】（请按驳回理由重新接受或给出更强理由）\n${rejected.map((r) => `- ${r.id}：${r.note}`).join('\n')}`
    : '';
  const digestNote = digest ? '\n（计划已超出上下文预算：输出精简版，每步仅保留标题与目标文件。）' : '';
  return [
    `【规划重试·计划审计未通过】本轮协商进入第 ${round.round}/${maxRetries} 次预算。请修复后重新输出完整 \`\`\`plan 围栏 JSON 计划（含上轮改良点，不得丢失目标）。`,
    `【审计问题清单】\n${issueLines}${rejectedBlock}${digestNote}`,
    `【协商响应】若采纳多项，在计划 JSON 增加 "audit_response":{"adopted":[对应的 issue id 列表]}；若认为某条不适用，增加 "rebutted":[{"id":"<issue id>","justification":"充分理由"}]。空采纳+空反驳视为未响应，问题将原样复现。`,
  ].join('\n\n');
}
