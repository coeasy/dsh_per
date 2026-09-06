import type { OrchestratorConfig, StageConfig } from '../config/schema.js';
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
export declare const SETTINGS_NAMESPACE = "dsh-per";
export interface OrchestratorSettingsSection {
    mode?: 'auto' | 'passthrough' | 'gated';
    stages?: {
        plan?: Partial<StageConfig>;
        execute?: Partial<StageConfig>;
        review?: Partial<StageConfig>;
        plan_audit?: StageConfig[];
    };
    budget?: {
        daily_limit_cny?: number;
        task_limit_cny?: number;
        pricing?: Record<string, {
            input: number;
            output: number;
        }>;
    };
    mechanical_verification?: {
        enabled?: boolean;
    };
}
export declare const orchestratorSettingsSchema: any;
/** Extract the curated subset of a patch config to serve as the composition base. */
export declare function buildConfigBase(cfg: OrchestratorConfig): OrchestratorSettingsSection;
/**
 * Fold the RAW curated user section into a full configuration (S2: the engine
 * feeds the raw stored user layer, never the seam-resolved value, so leaf
 * presence here genuinely means "user overrode" and schema defaults only fill
 * the gaps). Session overrides stay layered above this result in the engine.
 */
export declare function applySettingsOverlay(base: OrchestratorConfig, section: OrchestratorSettingsSection): OrchestratorConfig;
//# sourceMappingURL=namespace.d.ts.map