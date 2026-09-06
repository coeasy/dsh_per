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
export declare class ModelHealthService {
    private states;
    private key;
    private stateOf;
    recordFailure(provider: string | undefined, model: string, kind: string, at?: number): void;
    recordSuccess(provider: string | undefined, model: string): void;
    /** Whether a model is considered failed; half-open allows probe attempts.
     *  Semantics note (v4): EVERY request after `halfOpenAt` is a probe — the
     *  window is not limited to a single in-flight attempt (success clears the
     *  state, failure re-arms the cool-down). */
    isFailed(provider: string | undefined, model: string, at?: number): boolean;
    reset(): void;
}
//# sourceMappingURL=health.d.ts.map