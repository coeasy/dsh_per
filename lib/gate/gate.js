/**
 * Entrance gate — change-set A9: five-step fixed-order decision engine over
 * structured config (regex lists + numeric thresholds + verb list), plus A10
 * intent unification (explicit command channel → no-task gate → continue).
 */
export class Gate {
    cfg;
    onInvalid;
    passthroughRes;
    orchestrateRes;
    constructor(cfg, onInvalid = () => { }) {
        this.cfg = cfg;
        this.onInvalid = onInvalid;
        // A malformed pattern in a user patch must degrade the gate, never crash the
        // plugin boot: `new RegExp('[')` throws synchronously and createEngine has
        // no recovery point (P1-09). Bad entries are skipped; if a whole list ends
        // up empty, that step simply never matches and the decision falls through
        // to the length/verb heuristics (steps 5-7) below.
        this.passthroughRes = this.compileAll('passthrough_patterns', cfg.passthrough_patterns);
        this.orchestrateRes = this.compileAll('orchestrate_patterns', cfg.orchestrate_patterns);
    }
    compileAll(kind, patterns) {
        const compiled = [];
        for (const pattern of patterns) {
            try {
                compiled.push(new RegExp(pattern, 'u'));
            }
            catch (e) {
                this.onInvalid(`orchestrator: dropping invalid ${kind} entry ${JSON.stringify(pattern)}: ${e.message}`);
            }
        }
        return compiled;
    }
    decide(input) {
        const text = input.text ?? '';
        if (input.forced)
            return { decision: 'orchestrate', forced: true, rule: '1: forced flag (/orch task)' };
        if (input.passthroughFlag)
            return { decision: 'passthrough', forced: false, rule: '2: passthrough flag (/orch passthrough)' };
        for (let i = 0; i < this.passthroughRes.length; i++) {
            if (this.passthroughRes[i].test(text)) {
                return { decision: 'passthrough', forced: false, rule: `3: passthrough_patterns[${i}]` };
            }
        }
        for (let i = 0; i < this.orchestrateRes.length; i++) {
            if (this.orchestrateRes[i].test(text)) {
                return { decision: 'orchestrate', forced: false, rule: `4: orchestrate_patterns[${i}]` };
            }
        }
        const hasVerb = this.cfg.modify_intent_verbs.some((v) => text.includes(v));
        if (text.length <= this.cfg.short_len && !hasVerb) {
            return { decision: 'passthrough', forced: false, rule: `5: len<=${this.cfg.short_len} && no modify verb` };
        }
        if (text.length >= this.cfg.long_len) {
            return { decision: 'orchestrate', forced: false, rule: `6: len>=${this.cfg.long_len}` };
        }
        return { decision: this.cfg.default, forced: false, rule: '7: default' };
    }
}
//# sourceMappingURL=gate.js.map