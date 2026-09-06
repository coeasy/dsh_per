/**
 * Child-run plumbing shared by the reviewer and the plan auditors.
 *
 * `withTimeoutDispose` (docs/重构方案-v3.md A4) is the one template that the
 * reviewer and auditor dispatches both used to copy line-for-line; it now
 * lives here so the two fixes it carries cannot diverge:
 *
 *  - `disposed` makes the dispose call idempotent — the timeout branch and the
 *    `finally` used to dispose the same child handle twice, which would error
 *    or leak for any non-idempotent handle;
 *  - a real child rejection is logged with its original error instead of being
 *    folded into the timeout's `null` sentinel, which made "no verdict"
 *    un-debuggable.
 */
import type { HostLogger } from '../host-contract.js';
import type { AnyAgent } from './ctx.js';
export declare function withTimeoutDispose(promise: Promise<unknown> | undefined, dispose: () => unknown, ms: number, logger: HostLogger): Promise<any | null>;
/**
 * P2-18: child agents cannot inherit a provider through the request waterfall —
 * resolve it explicitly (stage override, else the parent's live route, else the
 * deployment default). Shared by reviewer and auditors.
 */
export declare function resolveChildProvider(host: {
    get: (name: string) => unknown;
}, agent: AnyAgent, lastBinding: Map<string, {
    provider?: string;
    model: string;
}>, binding: {
    provider?: string;
}): string | undefined;
//# sourceMappingURL=child-run.d.ts.map