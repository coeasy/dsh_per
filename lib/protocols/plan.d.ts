import { z } from 'zod';
import type { PlanDocument } from '../types.js';
/** PlanDocument schema (v5.0 §11.1) — version assigned by the FSM, not the model. */
export declare const planStepSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    risk_note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    files?: string[] | undefined;
    risk_note?: string | undefined;
}, {
    id: string;
    title: string;
    files?: string[] | undefined;
    risk_note?: string | undefined;
}>;
export declare const planDocumentSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodNumber>;
    supersedes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        files: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        risk_note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        title: string;
        files?: string[] | undefined;
        risk_note?: string | undefined;
    }, {
        id: string;
        title: string;
        files?: string[] | undefined;
        risk_note?: string | undefined;
    }>, "many">;
    complexity: z.ZodEnum<["trivial", "low", "mid", "high"]>;
    review_hint: z.ZodEnum<["skip", "lightweight", "full"]>;
    risk_level: z.ZodEnum<["standard", "elevated", "high"]>;
    estimated_context_tokens: z.ZodNumber;
    audit_response: z.ZodOptional<z.ZodObject<{
        adopted: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        rebutted: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            justification: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            justification: string;
        }, {
            id: string;
            justification: string;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        adopted: string[];
        rebutted: {
            id: string;
            justification: string;
        }[];
    }, {
        adopted?: string[] | undefined;
        rebutted?: {
            id: string;
            justification: string;
        }[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    steps: {
        id: string;
        title: string;
        files?: string[] | undefined;
        risk_note?: string | undefined;
    }[];
    complexity: "low" | "high" | "trivial" | "mid";
    review_hint: "full" | "skip" | "lightweight";
    risk_level: "high" | "standard" | "elevated";
    estimated_context_tokens: number;
    version?: number | undefined;
    supersedes?: number | null | undefined;
    audit_response?: {
        adopted: string[];
        rebutted: {
            id: string;
            justification: string;
        }[];
    } | undefined;
}, {
    steps: {
        id: string;
        title: string;
        files?: string[] | undefined;
        risk_note?: string | undefined;
    }[];
    complexity: "low" | "high" | "trivial" | "mid";
    review_hint: "full" | "skip" | "lightweight";
    risk_level: "high" | "standard" | "elevated";
    estimated_context_tokens: number;
    version?: number | undefined;
    supersedes?: number | null | undefined;
    audit_response?: {
        adopted?: string[] | undefined;
        rebutted?: {
            id: string;
            justification: string;
        }[] | undefined;
    } | undefined;
}>;
/**
 * Extract the LAST ```plan fenced block from assistant text (v5.0 §4.1 fenced
 * protocol). Returns null when none; returns { json, error } shape via
 * safeParse results at the call site.
 */
export declare function extractFencedPlan(text: string): string | null;
export type PlanParseResult = {
    ok: true;
    plan: Omit<PlanDocument, 'version'>;
    auditResponse?: PlanAuditResponse;
} | {
    ok: false;
    error: string;
};
export interface PlanAuditResponse {
    adopted: string[];
    rebutted: Array<{
        id: string;
        justification: string;
    }>;
}
export declare function parsePlan(fencedJson: string | null): PlanParseResult;
/**
 * Rough token estimate. `chars/4` undercounts CJK text by 2-3× (CJK averages
 * ~1.6 chars per token, ASCII ~4) — plans, prompts and review payloads are
 * Chinese-heavy, so a mixed estimator keeps the `planDigested` and review
 * budget thresholds meaningful (P2-09).
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=plan.d.ts.map