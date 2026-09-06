import { z } from 'zod';
import type { ReviewVerdict } from '../types.js';
/** ReviewVerdict schema (v5.0 §4.3) — enforced via subagent outputSchema. */
export declare const reviewIssueSchema: z.ZodObject<{
    id: z.ZodString;
    dimension: z.ZodEnum<["plan_conformance", "code_quality", "boundary", "security", "test_coverage"]>;
    severity: z.ZodEnum<["blocker", "major", "minor"]>;
    description: z.ZodString;
    location: z.ZodOptional<z.ZodString>;
    fix_granularity: z.ZodOptional<z.ZodEnum<["incremental", "full_reexec"]>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
    severity: "blocker" | "major" | "minor";
    description: string;
    location?: string | undefined;
    fix_granularity?: "incremental" | "full_reexec" | undefined;
}, {
    id: string;
    dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
    severity: "blocker" | "major" | "minor";
    description: string;
    location?: string | undefined;
    fix_granularity?: "incremental" | "full_reexec" | undefined;
}>;
export declare const reviewVerdictSchema: z.ZodObject<{
    planVersion: z.ZodNumber;
    pass: z.ZodBoolean;
    defect_type: z.ZodEnum<["execution", "plan", "ambiguous"]>;
    confidence: z.ZodNumber;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        dimension: z.ZodEnum<["plan_conformance", "code_quality", "boundary", "security", "test_coverage"]>;
        severity: z.ZodEnum<["blocker", "major", "minor"]>;
        description: z.ZodString;
        location: z.ZodOptional<z.ZodString>;
        fix_granularity: z.ZodOptional<z.ZodEnum<["incremental", "full_reexec"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
        severity: "blocker" | "major" | "minor";
        description: string;
        location?: string | undefined;
        fix_granularity?: "incremental" | "full_reexec" | undefined;
    }, {
        id: string;
        dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
        severity: "blocker" | "major" | "minor";
        description: string;
        location?: string | undefined;
        fix_granularity?: "incremental" | "full_reexec" | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
        severity: "blocker" | "major" | "minor";
        description: string;
        location?: string | undefined;
        fix_granularity?: "incremental" | "full_reexec" | undefined;
    }[];
    pass: boolean;
    confidence: number;
    planVersion: number;
    defect_type: "plan" | "execution" | "ambiguous";
}, {
    issues: {
        id: string;
        dimension: "plan_conformance" | "code_quality" | "boundary" | "security" | "test_coverage";
        severity: "blocker" | "major" | "minor";
        description: string;
        location?: string | undefined;
        fix_granularity?: "incremental" | "full_reexec" | undefined;
    }[];
    pass: boolean;
    confidence: number;
    planVersion: number;
    defect_type: "plan" | "execution" | "ambiguous";
}>;
/**
 * JSON Schema projection for subagent outputSchema enforcement. Restricted to
 * the harness-enforced subset (type/oneOf/properties/required/
 * additionalProperties/items/enum/const + annotations); enum must ride a type,
 * no minimum/maximum keywords — zod re-validates the ranges afterwards.
 */
export declare function reviewVerdictJsonSchema(): Record<string, unknown>;
export type VerdictRoute = 'review/pass' | 'review/fail-exec' | 'review/fail-plan' | 'review/ambiguous';
/**
 * Mechanical routing rules (v5.0 §4.3) — the orchestrator makes no semantic
 * judgment; confidence thresholds route the verdict.
 *
 * NOTE (v4): the pass-but-mechanical-failed case is NOT routed here — the
 * engine sets `flags.mechanicalFailedAfterPass` and the transition table's
 * `review/pass:MISS` guard picks the variant, so this function only ever sees
 * verdicts that need a defect route.
 */
export declare function routeVerdict(verdict: ReviewVerdict): {
    route: VerdictRoute;
};
/** Merge sharded verdicts conservatively (change-set M3). */
export declare function mergeShardedVerdicts(shards: ReviewVerdict[]): ReviewVerdict;
//# sourceMappingURL=review.d.ts.map