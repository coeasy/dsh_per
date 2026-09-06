import { z } from 'zod';
/** ReviewVerdict schema (v5.0 §4.3) — enforced via subagent outputSchema. */
export const reviewIssueSchema = z.object({
    id: z.string().min(1), // M5: stable ids across rounds (prompt contract)
    dimension: z.enum(['plan_conformance', 'code_quality', 'boundary', 'security', 'test_coverage']),
    severity: z.enum(['blocker', 'major', 'minor']),
    description: z.string().min(1),
    location: z.string().optional(),
    fix_granularity: z.enum(['incremental', 'full_reexec']).optional(),
});
export const reviewVerdictSchema = z.object({
    planVersion: z.number().int().nonnegative(),
    pass: z.boolean(),
    defect_type: z.enum(['execution', 'plan', 'ambiguous']),
    confidence: z.number().min(0).max(1),
    issues: z.array(reviewIssueSchema),
});
/**
 * JSON Schema projection for subagent outputSchema enforcement. Restricted to
 * the harness-enforced subset (type/oneOf/properties/required/
 * additionalProperties/items/enum/const + annotations); enum must ride a type,
 * no minimum/maximum keywords — zod re-validates the ranges afterwards.
 */
export function reviewVerdictJsonSchema() {
    const dim = ['plan_conformance', 'code_quality', 'boundary', 'security', 'test_coverage'];
    const sev = ['blocker', 'major', 'minor'];
    return {
        type: 'object',
        additionalProperties: false,
        required: ['planVersion', 'pass', 'defect_type', 'confidence', 'issues'],
        properties: {
            planVersion: { type: 'integer' },
            pass: { type: 'boolean' },
            defect_type: { type: 'string', enum: ['execution', 'plan', 'ambiguous'] },
            confidence: { type: 'number' },
            issues: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'dimension', 'severity', 'description'],
                    properties: {
                        id: { type: 'string' },
                        dimension: { type: 'string', enum: dim },
                        severity: { type: 'string', enum: sev },
                        description: { type: 'string' },
                        location: { type: 'string' },
                        fix_granularity: { type: 'string', enum: ['incremental', 'full_reexec'] },
                    },
                },
            },
        },
    };
}
/**
 * Mechanical routing rules (v5.0 §4.3) — the orchestrator makes no semantic
 * judgment; confidence thresholds route the verdict.
 */
export function routeVerdict(verdict, mechanicalPass) {
    if (verdict.pass) {
        if (mechanicalPass === false) {
            // reviewer miss: mechanical gate failed => back to EXECUTING, no fix_cycle
            return { route: 'review/pass', note: 'mechanical-miss' };
        }
        return { route: 'review/pass' };
    }
    const confident = verdict.confidence >= 0.7;
    if (!confident || verdict.defect_type === 'ambiguous')
        return { route: 'review/ambiguous' };
    if (verdict.defect_type === 'plan')
        return { route: 'review/fail-plan' };
    return { route: 'review/fail-exec' };
}
/** Merge sharded verdicts conservatively (change-set M3). */
export function mergeShardedVerdicts(shards) {
    const worst = (a, b) => {
        const rank = { ambiguous: 0, execution: 1, plan: 2 };
        return rank[a] >= rank[b] ? a : b;
    };
    const issues = [];
    const seen = new Set();
    for (const s of shards) {
        for (const issue of s.issues) {
            let id = issue.id;
            if (seen.has(id))
                id = `${id}-chunk${issues.length}`;
            seen.add(id);
            issues.push({ ...issue, id });
        }
    }
    const pass = shards.every((s) => s.pass);
    const defect = shards.reduce((acc, s) => worst(acc, s.pass ? 'ambiguous' : s.defect_type), 'ambiguous');
    const confidence = shards.length ? Math.min(...shards.map((s) => s.confidence)) : 0;
    const planVersion = shards[0]?.planVersion ?? 0;
    return { planVersion, pass, defect_type: defect, confidence, issues };
}
//# sourceMappingURL=review.js.map