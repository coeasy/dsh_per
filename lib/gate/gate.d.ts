import type { GateOutcome } from '../types.js';
export interface GateConfig {
    passthrough_patterns: string[];
    orchestrate_patterns: string[];
    modify_intent_verbs: string[];
    short_len: number;
    long_len: number;
    default: 'orchestrate' | 'passthrough';
}
/**
 * Entrance gate — change-set A9: five-step fixed-order decision engine over
 * structured config (regex lists + numeric thresholds + verb list), plus A10
 * intent unification (explicit command channel → no-task gate → continue).
 */
export declare class Gate {
    private cfg;
    private onInvalid;
    private passthroughRes;
    private orchestrateRes;
    constructor(cfg: GateConfig, onInvalid?: (message: string) => void);
    private compileAll;
    decide(input: {
        text: string;
        forced?: boolean;
        passthroughFlag?: boolean;
    }): GateOutcome;
}
//# sourceMappingURL=gate.d.ts.map