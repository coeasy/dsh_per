/**
 * Effort semantic mapping (v5.0 §6.3). Internal enum: off|low|medium|high|max.
 * DeepSeek wire vocabulary (verified in dsh-llm-deepseek): off|low|high|max —
 * no `medium`; `medium` maps to `high`. Other families fall back to the
 * nearest supported tier; unknown families return undefined (provider default).
 */
export type InternalEffort = 'off' | 'low' | 'medium' | 'high' | 'max';
/** Family inferred from a model id (e.g. `deepseek-v4-flash`, `glm-5.3`). */
export declare function familyOf(model: string): string;
/** Map an internal effort to a provider-specific id; null/undefined => clear effort. */
export declare function mapEffort(model: string, effort: InternalEffort | undefined): string | undefined;
//# sourceMappingURL=effort.d.ts.map