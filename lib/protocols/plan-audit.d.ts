import { z } from 'zod';
import type { PlanAuditRound, PlanDocument } from '../types.js';
/**
 * Plan-audit protocol (v5.2): zero to two auditor models review each plan
 * version before it reaches execution. A failed audit feeds a negotiation
 * record back to the planner through the existing plan/fail → reinject path.
 * Conservative-union arbitration (D1); plan_retry budget reuse (D2).
 */
export declare const AUDIT_PROMPT_MARKER = "\u4F60\u662F\u72EC\u7ACB\u7684\u8BA1\u5212\u5BA1\u8BA1\u5458";
export declare const auditIssueSchema: z.ZodObject<{
    id: z.ZodString;
    dimension: z.ZodEnum<["feasibility", "granularity", "risk_coverage", "file_consistency"]>;
    severity: z.ZodEnum<["blocker", "major", "minor"]>;
    description: z.ZodString;
    location: z.ZodOptional<z.ZodString>;
    suggestion: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
    severity: "blocker" | "major" | "minor";
    description: string;
    suggestion: string;
    location?: string | undefined;
}, {
    id: string;
    dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
    severity: "blocker" | "major" | "minor";
    description: string;
    suggestion: string;
    location?: string | undefined;
}>;
export declare const rebuttalVerdictSchema: z.ZodObject<{
    id: z.ZodString;
    accepted: z.ZodBoolean;
    note: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    accepted: boolean;
    note: string;
}, {
    id: string;
    accepted: boolean;
    note: string;
}>;
export declare const planAuditVerdictSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    confidence: z.ZodNumber;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        dimension: z.ZodEnum<["feasibility", "granularity", "risk_coverage", "file_consistency"]>;
        severity: z.ZodEnum<["blocker", "major", "minor"]>;
        description: z.ZodString;
        location: z.ZodOptional<z.ZodString>;
        suggestion: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
        severity: "blocker" | "major" | "minor";
        description: string;
        suggestion: string;
        location?: string | undefined;
    }, {
        id: string;
        dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
        severity: "blocker" | "major" | "minor";
        description: string;
        suggestion: string;
        location?: string | undefined;
    }>, "many">;
    rebuttal_verdicts: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        accepted: z.ZodBoolean;
        note: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        accepted: boolean;
        note: string;
    }, {
        id: string;
        accepted: boolean;
        note: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
        severity: "blocker" | "major" | "minor";
        description: string;
        suggestion: string;
        location?: string | undefined;
    }[];
    passed: boolean;
    confidence: number;
    rebuttal_verdicts: {
        id: string;
        accepted: boolean;
        note: string;
    }[];
}, {
    issues: {
        id: string;
        dimension: "feasibility" | "granularity" | "risk_coverage" | "file_consistency";
        severity: "blocker" | "major" | "minor";
        description: string;
        suggestion: string;
        location?: string | undefined;
    }[];
    passed: boolean;
    confidence: number;
    rebuttal_verdicts?: {
        id: string;
        accepted: boolean;
        note: string;
    }[] | undefined;
}>;
export type PlanAuditVerdict = z.infer<typeof planAuditVerdictSchema>;
export type AuditIssue = z.infer<typeof auditIssueSchema>;
/** JSON-Schema projection for subagent outputSchema (restricted subset, same craft as the reviewer verdict). */
export declare function planAuditVerdictJsonSchema(): Record<string, unknown>;
export interface MergedAudit {
    passed: boolean;
    confidence: number;
    issues: AuditIssue[];
    /** per rebutted id: conservative union — accepted only when every auditor accepted */
    rebuttals: Array<{
        id: string;
        accepted: boolean;
        note: string;
    }>;
}
/** Conservative-union arbitration across 1-2 auditor verdicts (D1). */
export declare function mergeAuditVerdicts(verdicts: PlanAuditVerdict[]): MergedAudit;
/** Most recent audit round, or null when the gate has not run yet. */
export declare function latestAudit(history: PlanAuditRound[] | undefined): PlanAuditRound | null;
/** Build the auditor prompt (r=1 plain audit; r≥2 with negotiation context). */
export declare function buildAuditPrompt(args: {
    goal: string;
    plan: PlanDocument;
    auditorIndex: number;
    previous: PlanAuditRound | null;
    response: {
        adopted: string[];
        rebutted: Array<{
            id: string;
            justification: string;
        }>;
    } | null;
}): string;
/** Rewrite directive back to the planner carrying the negotiation record (round r→r+1). */
export declare function buildAuditFeedbackDirective(args: {
    goal: string;
    round: PlanAuditRound;
    maxRetries: number;
    digest?: boolean;
}): string;
//# sourceMappingURL=plan-audit.d.ts.map