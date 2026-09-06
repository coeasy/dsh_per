export async function withTimeoutDispose(promise, dispose, ms, logger) {
    let timer;
    let disposed = false;
    const release = () => {
        if (disposed)
            return;
        disposed = true;
        void Promise.resolve(dispose?.()).catch((error) => logger.warn('orchestrator: child dispose failed: %o', error));
    };
    const timeoutRace = new Promise((resolve) => {
        timer = setTimeout(() => {
            release();
            resolve(null);
        }, ms);
    });
    try {
        return await Promise.race([promise, timeoutRace]);
    }
    catch (error) {
        // not a timeout: the child promise itself rejected. Keep the `null`
        // sentinel so callers degrade to deadlock, but leave a breadcrumb.
        logger.warn('orchestrator: child dispatch rejected (treated as deadlock): %o', error);
        return null;
    }
    finally {
        if (timer)
            clearTimeout(timer);
        release();
    }
}
/**
 * P2-18: child agents cannot inherit a provider through the request waterfall —
 * resolve it explicitly (stage override, else the parent's live route, else the
 * deployment default). Shared by reviewer and auditors.
 */
export function resolveChildProvider(host, agent, lastBinding, binding) {
    return (binding.provider ??
        lastBinding.get(agent.id)?.provider ??
        host.get('agentDefaultModel')?.currentSelection?.()?.provider);
}
//# sourceMappingURL=child-run.js.map