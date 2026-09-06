import { z } from 'zod';
import type { PlanDocument } from '../types.js';

/** PlanDocument schema (v5.0 §11.1) — version assigned by the FSM, not the model. */
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  files: z.array(z.string()).optional(),
  risk_note: z.string().optional(),
});

export const planDocumentSchema = z.object({
  version: z.number().int().optional(), // ignored on ingest; FSM assigns
  supersedes: z.number().int().nullable().optional(),
  steps: z.array(planStepSchema).min(1),
  complexity: z.enum(['trivial', 'low', 'mid', 'high']),
  review_hint: z.enum(['skip', 'lightweight', 'full']),
  risk_level: z.enum(['standard', 'elevated', 'high']),
  estimated_context_tokens: z.number().int().nonnegative(),
  // v5.2 bidirectional negotiation response (round r≥2 of the plan-audit gate);
  // peer field, missing = the planner did not address any prior-round issue
  audit_response: z
    .object({
      adopted: z.array(z.string()).default([]),
      rebutted: z.array(z.object({ id: z.string().min(1), justification: z.string().min(1) })).default([]),
    })
    .optional(),
});

/**
 * Extract the LAST ```plan fenced block from assistant text (v5.0 §4.1 fenced
 * protocol). Returns null when none; returns { json, error } shape via
 * safeParse results at the call site.
 */
export function extractFencedPlan(text: string): string | null {
  const re = /```plan\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1] ?? null;
  return last?.trim() ?? null;
}

export type PlanParseResult =
  | { ok: true; plan: Omit<PlanDocument, 'version'>; auditResponse?: PlanAuditResponse }
  | { ok: false; error: string };

export interface PlanAuditResponse {
  adopted: string[];
  rebutted: Array<{ id: string; justification: string }>;
}

export function parsePlan(fencedJson: string | null): PlanParseResult {
  if (fencedJson === null) return { ok: false, error: 'no ```plan fenced block found' };
  let raw: unknown;
  try {
    raw = JSON.parse(fencedJson);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${(e as Error).message}` };
  }
  const parsed = planDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `schema validation failed: ${issues}` };
  }
  const d = parsed.data;
  return {
    ok: true,
    plan: {
      supersedes: d.supersedes ?? null,
      steps: d.steps,
      complexity: d.complexity,
      review_hint: d.review_hint,
      risk_level: d.risk_level,
      estimated_context_tokens: d.estimated_context_tokens,
    },
    ...(d.audit_response ? { auditResponse: d.audit_response as PlanAuditResponse } : {}),
  };
}

/**
 * Rough token estimate. `chars/4` undercounts CJK text by 2-3× (CJK averages
 * ~1.6 chars per token, ASCII ~4) — plans, prompts and review payloads are
 * Chinese-heavy, so a mixed estimator keeps the `planDigested` and review
 * budget thresholds meaningful (P2-09).
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0x2e7f) cjk++; // CJK ranges + fullwidth punctuation
  }
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.6 + other / 4);
}
