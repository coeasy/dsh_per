const FAMILY_MAP = {
    deepseek: { off: 'off', low: 'low', medium: 'high', high: 'high', max: 'max' },
    glm: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'high' },
    qwen: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'high' },
    zhipu: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'high' },
    kimi: { off: null, low: 'low', medium: 'medium', high: 'high', max: 'high' },
};
/** Family inferred from a model id (e.g. `deepseek-v4-flash`, `glm-5.3`). */
export function familyOf(model) {
    const m = /^(deepseek|glm|qwen|zhipu|kimi)/i.exec(model);
    return (m?.[1] ?? model.split(/[-_.]/)[0] ?? '').toLowerCase();
}
/** Map an internal effort to a provider-specific id; null/undefined => clear effort. */
export function mapEffort(model, effort) {
    if (!effort)
        return undefined;
    const family = familyOf(model);
    const table = FAMILY_MAP[family];
    if (!table)
        return effort === 'medium' ? 'high' : effort; // unknown family: pass through common ids
    const mapped = table[effort];
    if (mapped === null)
        return undefined; // unsupported => clear to provider default
    return mapped ?? undefined;
}
//# sourceMappingURL=effort.js.map