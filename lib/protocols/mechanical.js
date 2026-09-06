import { spawn } from 'node:child_process';
/**
 * MechanicalVerifier (change-set A11): deterministic in-process execution of
 * configured verification commands. `unavailable` never condemns the product
 * but forbids the DONE quick channel and forces full review on elevated risk.
 */
export class MechanicalVerifier {
    cfg;
    cwd;
    isEnabled;
    constructor(cfg, cwd, 
    /** live switch consulted per run (settings-curated `mechanical_verification.enabled`) */
    isEnabled = () => this.cfg.enabled) {
        this.cfg = cfg;
        this.cwd = cwd;
        this.isEnabled = isEnabled;
    }
    async run(changedFiles, force = false, opts) {
        // v1 runs verification on every review: results must reflect the CURRENT
        // product, and the fix loop changes files between rounds — a result cache
        // keyed on the file list alone would replay a stale verdict.
        void changedFiles;
        void force;
        if (!this.isEnabled()) {
            return { ranAt: Date.now() };
        }
        const result = { ranAt: Date.now() };
        const runKeyed = async (key) => {
            const command = this.cfg.commands[key];
            if (!command)
                return;
            result[key] = await this.runOne(command, key === 'tests', opts?.signal);
        };
        if (this.cfg.parallel) {
            await Promise.all([runKeyed('compile'), runKeyed('lint'), runKeyed('tests')]);
        }
        else {
            await runKeyed('compile');
            await runKeyed('lint');
            await runKeyed('tests');
        }
        return result;
    }
    runOne(command, isTestSuite, signal) {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(command, {
                    shell: true,
                    cwd: this.cwd(),
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            }
            catch {
                resolve({ check: 'unavailable' });
                return;
            }
            let out = '';
            let settled = false;
            const finish = (outcome) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                offAbort?.();
                resolve(outcome);
            };
            const kill = () => {
                child?.kill('SIGKILL');
                finish({ check: 'unavailable', tail: out.slice(-2000), ...(isTestSuite ? { summary: 'aborted' } : {}) });
            };
            const onAbort = () => kill();
            let offAbort;
            if (signal) {
                if (signal.aborted) {
                    resolve({ check: 'unavailable' });
                    try {
                        child.kill('SIGKILL');
                    }
                    catch {
                        /* already gone */
                    }
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
                offAbort = () => signal.removeEventListener('abort', onAbort);
            }
            const timer = setTimeout(() => {
                child?.kill('SIGKILL');
                finish({ check: 'unavailable', tail: out.slice(-2000), ...(isTestSuite ? { summary: 'timeout' } : {}) });
            }, this.cfg.timeout_ms);
            const collect = (chunk) => {
                out += chunk.toString('utf8');
                if (out.length > 100_000)
                    out = out.slice(-50_000);
            };
            child.stdout?.on('data', collect);
            child.stderr?.on('data', collect);
            child.on('error', () => finish({ check: 'unavailable', tail: out.slice(-2000) }));
            child.on('close', (code) => {
                finish({
                    check: code === 0 ? 'pass' : 'fail',
                    exitCode: code ?? undefined,
                    tail: out.slice(-2000),
                    ...(isTestSuite ? { summary: summarizeTests(out) } : {}),
                });
            });
        });
    }
}
/** Best-effort test summary extraction; unknown formats => exit-code verdict only. */
export function summarizeTests(output) {
    const patterns = [
        /Tests?:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?/i, // jest/vitest
        /(\d+)\s*passed(?:,\s*(\d+)\s*failed)?/i,
        /(\d+) passing(?:,\s*(\d+) failing)?/, // mocha
        /(\d+) passed(?:,\s*(\d+) failed)?/i, // pytest style
    ];
    for (const re of patterns) {
        const m = re.exec(output);
        if (m) {
            const passed = Number(m[1] ?? 0);
            const failed = Number(m[2] ?? 0);
            return `${passed} passed, ${failed} failed`;
        }
    }
    return undefined;
}
//# sourceMappingURL=mechanical.js.map