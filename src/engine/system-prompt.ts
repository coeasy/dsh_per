/**
 * System-prompt section registration (docs/重构方案-v3.md §2-D).
 *
 * Renders the per-stage instructions the executor sees while a task is in
 * flight. Pure string building off the live snapshot — no transition, no
 * host writes beyond the one `systemPrompt.section` registration.
 */
import { isTerminal } from '../types.js';
import type { EngineCtx } from './ctx.js';
import { skeletonPlan } from './prompts.js';

export function registerSystemPrompt(ctx: EngineCtx): void {
  const sp = ctx.host.get('systemPrompt') as { section?: (def: { name: string; order: number; text: (context: unknown) => string }) => unknown } | undefined;
  if (!sp?.section) return;

  sp.section({
    name: 'orchestrator:stage',
    order: 40,
    text: (context: unknown) => {
      const agent = (context as { agent?: { id: string } } | undefined)?.agent;
      if (!agent) return '';
      const task = ctx.registry.activeForSession(agent.id);
      if (!task || isTerminal(task.state)) return '';
      const snap = task.snapshot;
      switch (task.state) {
        case 'PLANNING':
        case 'RE-PLANNING': {
          const auditOn = (ctx.cfg().stages?.plan_audit?.length ?? 0) > 0;
          const auditNote = auditOn
            ? [
              `【计划审计】本计划将交由独立审计员审查（维度：可行性/粒度/风险覆盖/文件一致性），不通过会被打回重写。`,
              snap.planAudit?.length ? `已审计 ${snap.planAudit.length} 轮：请逐条修复上轮问题，或用 "audit_response" 反驳。` : '',
              `重写时的计划 JSON 可携带可选字段 "audit_response":{"adopted":[已修复的问题id],"rebutted":[{"id":"IA1","justification":"反驳理由"}]} 声明协商响应；空采纳+空反驳视为未响应。`,
            ]
              .filter(Boolean)
              .join('\n')
            : '';
          return [
            snap.state === 'RE-PLANNING' ? '【编排·重规划】旧计划已作废，基于下方反馈修订计划。' : '【编排·规划】',
            `目标：${snap.goal}`,
            snap.planDigested ? '（计划已超出上下文预算：输出精简修订版，每步仅保留标题与目标文件。）' : '',
            `完成必要调研后，将最终计划输出为单个 \`\`\`plan 围栏代码块，内容为符合 schema 的 JSON：{steps:[{id,title,files?,risk_note?}], complexity:'trivial'|'low'|'mid'|'high', review_hint:'skip'|'lightweight'|'full', risk_level:'standard'|'elevated'|'high', estimated_context_tokens:number}。围栏块出现即视为规划完成；不要在计划定稿前输出围栏。`,
            auditNote,
          ]
            .filter(Boolean)
            .join('\n\n');
        }
        case 'EXECUTING': {
          // P2-08: a digested plan also trims the execution prompt — the full
          // JSON would re-inflate the very context we marked as over budget
          const plan = snap.plan ? (snap.planDigested ? skeletonPlan(snap.plan) : JSON.stringify(snap.plan)) : '';
          const digestNote = snap.planDigested ? '（计划已精简：每步仅含标题与目标文件，完整文件清单以实际产物为准）' : '';
          const fixes = snap.pendingFixes.length ? `\n【待修复问题】（只修这些点，保留其余成果）\n${snap.pendingFixes.map((f, i) => `${i + 1}. [${f.severity}] ${f.description}`).join('\n')}` : '';
          const user = snap.userDirectives.length ? `\n【用户补充指令】（最高优先级）\n${snap.userDirectives.join('\n')}` : '';
          return `【编排·执行】严格按计划 v${snap.planVersion} 执行，不做计划外重构。遇到计划未覆盖的情况，输出 [NEED_REPLAN] 标记并停止。${digestNote}\n【计划】${plan}${fixes}${user}`;
        }
        case 'REVIEWING':
          return '【编排·复核】复核由独立检测代理执行；本阶段请勿继续修改代码。';
        default:
          return '';
      }
    },
  });
}
