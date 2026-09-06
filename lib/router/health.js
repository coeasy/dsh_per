const WINDOW_MS = 5 * 60_000; // 5 min sliding window
const FAIL_THRESHOLD = 3;
const HALF_OPEN_MS = 10 * 60_000; // probe primary again after 10 min
export class ModelHealthService {
    states = new Map();
    key(provider, model) {
        return `${provider ?? '*'}::${model}`;
    }
    stateOf(k) {
        let s = this.states.get(k);
        if (!s) {
            s = { failures: [], markedFailedAt: null, halfOpenAt: null };
            this.states.set(k, s);
        }
        return s;
    }
    recordFailure(provider, model, kind, at = Date.now()) {
        const s = this.stateOf(this.key(provider, model));
        s.failures = [...s.failures.filter((t) => at - t < WINDOW_MS), at];
        if (s.failures.length >= FAIL_THRESHOLD && s.markedFailedAt === null) {
            s.markedFailedAt = at;
            s.halfOpenAt = at + HALF_OPEN_MS;
        }
        else if (s.markedFailedAt !== null && s.halfOpenAt !== null && at >= s.halfOpenAt) {
            // a probe through the half-open gate failed: re-close and re-arm the
            // cool-down, otherwise the past halfOpenAt lets every request through
            s.halfOpenAt = at + HALF_OPEN_MS;
        }
        void kind;
    }
    recordSuccess(provider, model) {
        const s = this.states.get(this.key(provider, model));
        if (!s)
            return;
        s.failures = [];
        s.markedFailedAt = null;
        s.halfOpenAt = null;
    }
    /** Whether a model is considered failed; half-open allows probe attempts.
     *  Semantics note (v4): EVERY request after `halfOpenAt` is a probe — the
     *  window is not limited to a single in-flight attempt (success clears the
     *  state, failure re-arms the cool-down). */
    isFailed(provider, model, at = Date.now()) {
        const s = this.states.get(this.key(provider, model));
        if (!s || s.markedFailedAt === null)
            return false;
        if (s.halfOpenAt !== null && at >= s.halfOpenAt)
            return false; // half-open: allow probe
        return true;
    }
    reset() {
        this.states.clear();
    }
}
//# sourceMappingURL=health.js.map