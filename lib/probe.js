import { appendFileSync } from 'node:fs';
/**
 * E2E diagnostic probe: logs every host-visible event to $DSH_E2E_PROBE_LOG.
 * Loaded via a --patch overlay row in test runs only.
 */
export default {
    name: 'e2e-probe',
    apply(ctx) {
        const logPath = process.env.DSH_E2E_PROBE_LOG ?? 'probe.log';
        const t0 = Date.now();
        const log = (msg) => {
            try {
                appendFileSync(logPath, `${Date.now() - t0}ms ${msg}\n`);
            }
            catch {
                /* ignore */
            }
        };
        log(`probe mounted; ctx=${typeof ctx}`);
        try {
            const settings = ctx.get?.('settings');
            const section = settings?.get?.('llm-pi-ai') ?? settings?.section?.('llm-pi-ai');
            log(`settings llm-pi-ai: ${JSON.stringify(section).slice(0, 400)}`);
        }
        catch (e) {
            log(`settings read error: ${e}`);
        }
        try {
            setTimeout(() => {
                try {
                    const llm = ctx.get?.('llm');
                    const providers = llm?.listProviders?.() ?? [];
                    log(`llm providers: ${JSON.stringify(providers).slice(0, 500)}`);
                }
                catch (e) {
                    log(`llm read error: ${e}`);
                }
            }, 800);
        }
        catch {
            /* ignore */
        }
        try {
            ctx.on('session/event', (session, event) => {
                const d = event?.data ?? {};
                if (event?.type === 'request/header') {
                    log(`REQ ${JSON.stringify(d).slice(0, 300)}`);
                    return;
                }
                if (event?.type === 'request/error' || event?.type === 'request/fail') {
                    log(`REQERR ${JSON.stringify(d).slice(0, 300)}`);
                    return;
                }
                if (String(event?.type).startsWith('assistant/chunk')) {
                    const raw = JSON.stringify(d ?? {});
                    if (log.n === undefined)
                        log.n = 0;
                    log.n++;
                    if (log.n <= 8 || log.n % 2000 === 0)
                        log(`chunk#${log.n} ${raw.slice(0, 260)}`);
                    return;
                }
                if (event?.type === 'agent/inbox/spliced') {
                    const raw = JSON.stringify(d ?? {});
                    log(`splice ${raw.slice(0, 260)}`);
                    return;
                }
                const sid = String(session?.id ?? '?').slice(-6);
                const detail = event?.type === 'assistant/message'
                    ? ` len=${JSON.stringify(d?.message?.content ?? []).length}`
                    : event?.type === 'turn/start' || event?.type === 'turn/end'
                        ? ` [${sid}] ${JSON.stringify(d ?? {}).slice(0, 200)}`
                        : '';
                log(`evt ${event?.type}${detail}`);
            });
            log('session/event listener registered');
        }
        catch (e) {
            log(`listener error: ${e}`);
        }
        try {
            ctx.on('agent/inbox/claimed', (agent, message, turn) => {
                const m = message;
                const t = turn;
                log(`claimed agent=${agent?.id} src=${m?.source?.kind ?? '?'} turn=${t?.id ?? '?'}`);
            });
            log('inbox listener registered');
        }
        catch (e) {
            log(`inbox listener error: ${e}`);
        }
    },
};
//# sourceMappingURL=probe.js.map