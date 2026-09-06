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

export async function withTimeoutDispose(
  promise: Promise<unknown> | undefined,
  dispose: () => unknown,
  ms: number,
  logger: HostLogger,
): Promise<any | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const release = (): void => {
    if (disposed) return;
    disposed = true;
    void Promise.resolve(dispose?.()).catch((error) =>
      logger.warn('orchestrator: child dispose failed: %o', error),
    );
  };
  const timeoutRace = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      release();
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutRace]);
  } catch (error) {
    // not a timeout: the child promise itself rejected. Keep the `null`
    // sentinel so callers degrade to deadlock, but leave a breadcrumb.
    logger.warn('orchestrator: child dispatch rejected (treated as deadlock): %o', error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}

/**
 * P2-18: child agents cannot inherit a provider through the request waterfall —
 * resolve it explicitly (stage override, else the parent's live route, else the
 * deployment default). Shared by reviewer and auditors.
 */
export function resolveChildProvider(
  host: { get: (name: string) => unknown },
  agent: AnyAgent,
  lastBinding: Map<string, { provider?: string; model: string }>,
  binding: { provider?: string },
): string | undefined {
  return (
    binding.provider ??
    lastBinding.get(agent.id)?.provider ??
    (host.get('agentDefaultModel') as { currentSelection?: () => { provider?: string } } | undefined)?.currentSelection?.()?.provider
  );
}
