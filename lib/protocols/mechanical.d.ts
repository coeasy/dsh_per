import type { MechanicalResult } from '../types.js';
export interface MechanicalConfig {
    enabled: boolean;
    commands: {
        compile?: string;
        tests?: string;
        lint?: string;
    };
    timeout_ms: number;
    /** run compile/lint/tests concurrently (opt-in: tests usually need compile output) */
    parallel: boolean;
}
export interface CheckOutcome {
    check: 'pass' | 'fail' | 'unavailable';
    exitCode?: number;
    tail?: string;
    /** test-count summary — only ever produced for the `tests` command (P1-14):
     * a compile line like "1 passed" would otherwise read as a test verdict. */
    summary?: string;
}
export interface RunOptions {
    /** aborting kills the running children immediately instead of letting them
     * run out `timeout_ms` after a `user/cancel` (P1-14). */
    signal?: AbortSignal;
}
/**
 * MechanicalVerifier (change-set A11): deterministic in-process execution of
 * configured verification commands. `unavailable` never condemns the product
 * but forbids the DONE quick channel and forces full review on elevated risk.
 */
export declare class MechanicalVerifier {
    private cfg;
    private cwd;
    /** live switch consulted per run (settings-curated `mechanical_verification.enabled`) */
    private isEnabled;
    constructor(cfg: MechanicalConfig, cwd: () => string, 
    /** live switch consulted per run (settings-curated `mechanical_verification.enabled`) */
    isEnabled?: () => boolean);
    run(changedFiles: string[], force?: boolean, opts?: RunOptions): Promise<MechanicalResult>;
    private runOne;
}
/** Best-effort test summary extraction; unknown formats => exit-code verdict only. */
export declare function summarizeTests(output: string): string | undefined;
//# sourceMappingURL=mechanical.d.ts.map