import Schema from '@deepseek-ai/schemastery';
/**
 * v5.3: user-facing settings namespace `dsh-per` (schemastery schema
 * for the shared user-settings seam; the zod patch schema stays the boot-time
 * authority for the FULL config). Covers the curated-only subset a user edits
 * through the settings UI — everything else keeps living in patch layers.
 *
 * Layered resolution on the seam: schema defaults → composition base (the
 * bundle/patch values we register) → user document section. The engine folds
 * the RESOLVED curated section into effectiveConfig above the patch config and
 * below session overrides (/orch set).
 */
export const SETTINGS_NAMESPACE = 'dsh-per';
const effortEnum = Schema.union(['off', 'low', 'medium', 'high', 'max']);
const stageSchema = Schema.object({
    model: Schema.string().required().description('模型 id（settings 中已注册的模型）'),
    provider: Schema.string().description('provider id（可选，缺省取部署默认）'),
    reasoning_effort: effortEnum.default('medium').description('推理档位；settings 未声明 effort 的模型必须 off'),
    on_failure: Schema.union(['hard_fail', 'auto_degrade']).default('auto_degrade'),
    fallback_chain: Schema.array(String).default([]),
});
// schemastery's dynamic section shape is not expressible structurally; the
// engine treats this seam as `unknown` everywhere it is consumed
export const orchestratorSettingsSchema = Schema.object({
    mode: Schema.union(['auto', 'passthrough', 'gated']).default('auto')
        .description('auto=门禁自动判定；passthrough=全部透传；gated=仅 /orch task 或 /per 触发'),
    stages: Schema.object({
        plan: stageSchema,
        execute: stageSchema,
        review: stageSchema,
        plan_audit: Schema.array(stageSchema).max(2).default([]),
    }),
    budget: Schema.object({
        daily_limit_cny: Schema.natural().default(50),
        task_limit_cny: Schema.natural().default(5),
        // v4: per-model CNY/million-token rates (P0-03 closure — the unpriced-model
        // warning tells users to set these; now editable in the card)
        pricing: Schema.dict(Schema.object({ input: Schema.number().required(), output: Schema.number().required() })).default({}),
    }),
    mechanical_verification: Schema.object({
        enabled: Schema.boolean().default(true),
    }),
});
/** Extract the curated subset of a patch config to serve as the composition base. */
export function buildConfigBase(cfg) {
    const pick = (s) => s ? { model: s.model, provider: s.provider, reasoning_effort: s.reasoning_effort, on_failure: s.on_failure, fallback_chain: s.fallback_chain } : undefined;
    const base = {
        mode: cfg.mode,
        budget: {
            daily_limit_cny: cfg.budget.daily_limit_cny,
            task_limit_cny: cfg.budget.task_limit_cny,
            pricing: { ...cfg.budget.pricing },
        },
        // optional chaining: the function is typed for a parsed config, but tests
        // exercise it with sparse overlays
        mechanical_verification: { enabled: cfg.mechanical_verification?.enabled ?? true },
    };
    if (cfg.stages) {
        base.stages = {
            plan: pick(cfg.stages.plan),
            execute: pick(cfg.stages.execute),
            review: pick(cfg.stages.review),
            ...(cfg.stages.plan_audit ? { plan_audit: cfg.stages.plan_audit.map((a) => ({ ...a })) } : {}),
        };
    }
    return base;
}
const STAGE_ENTRIES = [
    { key: 'plan', effort: 'high', onFailure: 'hard_fail' },
    { key: 'execute', effort: 'low', onFailure: 'auto_degrade' },
    { key: 'review', effort: 'max', onFailure: 'auto_degrade' },
];
function normalizeAuditList(list) {
    return (list ?? [])
        .filter((a) => a && typeof a.model === 'string' && a.model.length > 0)
        .slice(0, 2)
        .map((a) => ({
        model: a.model,
        ...(a.provider ? { provider: a.provider } : {}),
        reasoning_effort: a.reasoning_effort ?? 'medium',
        on_failure: a.on_failure ?? 'auto_degrade',
        // L10: copy — the section may be a frozen host value; aliasing its array
        // would leak a frozen reference into effectiveConfig
        fallback_chain: a.fallback_chain ? [...a.fallback_chain] : [],
    }));
}
/**
 * Fold the RAW curated user section into a full configuration (S2: the engine
 * feeds the raw stored user layer, never the seam-resolved value, so leaf
 * presence here genuinely means "user overrode" and schema defaults only fill
 * the gaps). Session overrides stay layered above this result in the engine.
 */
export function applySettingsOverlay(base, section) {
    const next = structuredClone(base);
    if (section.mode)
        next.mode = section.mode;
    if (section.budget) {
        if (typeof section.budget.daily_limit_cny === 'number')
            next.budget.daily_limit_cny = section.budget.daily_limit_cny;
        if (typeof section.budget.task_limit_cny === 'number')
            next.budget.task_limit_cny = section.budget.task_limit_cny;
        // pricing replaces wholesale (a record has no partial-leaf semantics);
        // L10 copy — the section may be a frozen host value
        if (section.budget.pricing && typeof section.budget.pricing === 'object') {
            next.budget.pricing = { ...section.budget.pricing };
        }
    }
    if (section.mechanical_verification && typeof section.mechanical_verification.enabled === 'boolean') {
        next.mechanical_verification.enabled = section.mechanical_verification.enabled;
    }
    const ss = section.stages;
    if (!ss)
        return next;
    // unified leaf semantics (L9): in the RAW user section an ABSENT key means
    // "inherit" (do not touch); only an explicit '' / null means "clear this
    // leaf" back to the composition layer
    const leafSet = (dst, field, value) => {
        if (value === undefined)
            return;
        const cleared = value === '' || value === null;
        if (cleared)
            delete dst[field];
        else
            dst[field] = value;
    };
    if (next.stages) {
        for (const { key } of STAGE_ENTRIES) {
            const ov = ss[key];
            if (!ov)
                continue;
            for (const f of ['model', 'provider', 'reasoning_effort', 'on_failure']) {
                leafSet(next.stages[key], f, ov[f]);
            }
            if (Array.isArray(ov.fallback_chain))
                next.stages[key].fallback_chain = [...ov.fallback_chain];
            else if (ov.fallback_chain === null)
                next.stages[key].fallback_chain = [];
        }
        if (Object.prototype.hasOwnProperty.call(ss, 'plan_audit')) {
            const clean = normalizeAuditList(ss.plan_audit);
            if (clean.length > 0)
                next.stages.plan_audit = clean;
            else
                delete next.stages.plan_audit;
        }
        // a section that removes every stage's model restores the inert state
        if (!next.stages.plan.model || !next.stages.execute.model || !next.stages.review.model)
            next.stages = undefined;
    }
    else if (ss.plan?.model && ss.execute?.model && ss.review?.model) {
        // only a COMPLETE trio materializes stages out of an inert base; a partial
        // section cannot resurrect orchestration on its own
        const mk = (ov, effort, onFailure) => ({
            model: ov.model,
            ...(ov.provider ? { provider: ov.provider } : {}),
            reasoning_effort: ov.reasoning_effort ?? effort,
            on_failure: ov.on_failure ?? onFailure,
            fallback_chain: ov.fallback_chain ? [...ov.fallback_chain] : [],
        });
        const audits = normalizeAuditList(ss.plan_audit);
        next.stages = {
            plan: mk(ss.plan, 'high', 'hard_fail'),
            execute: mk(ss.execute, 'low', 'auto_degrade'),
            review: { ...mk(ss.review, 'max', 'auto_degrade'), dimensions: 'full', input_token_budget: 50_000 },
            ...(audits.length ? { plan_audit: audits } : {}),
        };
    }
    return next;
}
//# sourceMappingURL=namespace.js.map