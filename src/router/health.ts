/**
 * Plugin-global model health service (change-set A6): sliding failure window
 * per provider/model, half-open probe after a cool-down. Not persisted — a
 * restart re-probes conservatively.
 */
export interface HealthState {
  failures: number[];
  markedFailedAt: number | null;
  halfOpenAt: number | null;
}

const WINDOW_MS = 5 * 60_000; // 5 min sliding window
const FAIL_THRESHOLD = 3;
const HALF_OPEN_MS = 10 * 60_000; // probe primary again after 10 min

export class ModelHealthService {
  private states = new Map<string, HealthState>();

  private key(provider: string | undefined, model: string): string {
    return `${provider ?? '*'}::${model}`;
  }

  private stateOf(k: string): HealthState {
    let s = this.states.get(k);
    if (!s) {
      s = { failures: [], markedFailedAt: null, halfOpenAt: null };
      this.states.set(k, s);
    }
    return s;
  }

  recordFailure(provider: string | undefined, model: string, kind: string, at = Date.now()): void {
    const s = this.stateOf(this.key(provider, model));
    s.failures = [...s.failures.filter((t) => at - t < WINDOW_MS), at];
    if (s.failures.length >= FAIL_THRESHOLD && s.markedFailedAt === null) {
      s.markedFailedAt = at;
      s.halfOpenAt = at + HALF_OPEN_MS;
    } else if (s.markedFailedAt !== null && s.halfOpenAt !== null && at >= s.halfOpenAt) {
      // a probe through the half-open gate failed: re-close and re-arm the
      // cool-down, otherwise the past halfOpenAt lets every request through
      s.halfOpenAt = at + HALF_OPEN_MS;
    }
    void kind;
  }

  recordSuccess(provider: string | undefined, model: string): void {
    const s = this.states.get(this.key(provider, model));
    if (!s) return;
    s.failures = [];
    s.markedFailedAt = null;
    s.halfOpenAt = null;
  }

  /** Whether a model is considered failed; half-open allows one probe attempt. */
  isFailed(provider: string | undefined, model: string, at = Date.now()): boolean {
    const s = this.states.get(this.key(provider, model));
    if (!s || s.markedFailedAt === null) return false;
    if (s.halfOpenAt !== null && at >= s.halfOpenAt) return false; // half-open: allow probe
    return true;
  }

  reset(): void {
    this.states.clear();
  }
}
