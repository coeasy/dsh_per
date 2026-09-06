export function registerCommands(ctx) {
    const commands = ctx.host.get('commands');
    const register = commands?.register;
    if (!register)
        return;
    const def = (name, description, hint, handler) => register({ name, description, input: { hint }, handler });
    def('per', '编排执行模式快捷开关与一键启动', '<任务文本> | <on|off|auto>', ({ agent, rawInput }) => {
        const input = String(rawInput ?? '').trim();
        const sessionId = agent.id;
        ctx.agents.set(sessionId, agent);
        if (input === 'on' || input === 'off' || input === 'auto') {
            if (input === 'auto')
                ctx.sessionModeOverride.delete(sessionId);
            else {
                // bounded memory: sessions are host-lifetime; cap the per-session map
                // like passthroughObserve so a long-lived host cannot grow it forever
                if (ctx.sessionModeOverride.size > 5000)
                    ctx.sessionModeOverride.clear();
                ctx.sessionModeOverride.set(sessionId, input);
            }
            const text = input === 'on'
                ? '本会话：全部进入编排（跳过门禁，可用 /per auto 恢复）'
                : input === 'off'
                    ? '本会话：全部透传当前模型（可用 /per auto 恢复）'
                    : '本会话：恢复门禁自动判定';
            return { kind: 'success', text };
        }
        if (!input) {
            const ov = ctx.sessionModeOverride.get(sessionId);
            return {
                kind: 'success',
                text: `用法: /per <任务文本> 一键进编排；/per on|off|auto 切换会话执行模式\n当前会话模式: ${ov ? ov : `auto（门禁判定，插件 ${ctx.isOrchestrationEnabled() ? '启用' : '未启用'}）`}`,
            };
        }
        ctx.oneShot.set(sessionId, { forced: true });
        ctx.launchTask(agent, input);
        return { kind: 'success', text: '已强制进入编排（/per）' };
    });
    def('orch', '多模型编排控制', '<status|set|reset|save|budget|task|passthrough|abort> [args]', ({ agent, rawInput }) => {
        const [sub, ...rest] = String(rawInput ?? '').trim().split(/\s+/);
        const sessionId = agent.id;
        ctx.agents.set(sessionId, agent);
        switch (sub) {
            case 'status': {
                const ses = ctx.sessionEffective(sessionId);
                const stages = ses.stages;
                const auditModels = stages?.plan_audit?.length ? stages.plan_audit.map((a) => a.model).join('/') : null;
                const t = ctx.registry.activeForSession(sessionId);
                const cfg = ctx.cfg();
                return {
                    kind: 'success',
                    text: [
                        `模式: ${ctx.isOrchestrationEnabled() ? (cfg.mode === 'gated' ? 'gated' : 'auto(gated)') : 'passthrough（未配置/关闭）'}`,
                        stages ? `规划=${stages.plan.model} 执行=${stages.execute.model} 复核=${stages.review.model}${auditModels ? ` 审计=${auditModels}` : ''}` : '阶段模型未配置',
                        `预算: 今日 ¥${ctx.ledger.estimatedToday().toFixed(2)}/${cfg.budget.daily_limit_cny}；透传 ¥${ctx.ledger.passthroughToday().toFixed(2)}`,
                        t ? `活动任务: ${t.id} [${t.state}] 修复轮 ${t.snapshot.counters.fix_cycle}/${cfg.fix_loop.max_cycles}${t.snapshot.auditSkipped ? `；审计放行 ${t.snapshot.auditSkipped} 次` : ''}` : '活动任务: 无',
                    ].join('\n'),
                };
            }
            case 'set': {
                const patch = {};
                for (const part of rest) {
                    const m = /^(plan|execute|review)=(.+)$/.exec(part);
                    if (m && m[1] && m[2])
                        patch[m[1]] = m[2];
                }
                if (!Object.keys(patch).length)
                    return { kind: 'error', text: '用法: /orch set plan=<model> execute=<model> review=<model>' };
                if (ctx.sessionOverrides.size > 5000)
                    ctx.sessionOverrides.clear(); // bounded memory
                ctx.sessionOverrides.set(sessionId, { ...(ctx.sessionOverrides.get(sessionId) ?? {}), ...patch });
                ctx.applyOverrides();
                return { kind: 'success', text: '会话级覆盖已生效（/orch reset 回落，/orch save 持久化）' };
            }
            case 'reset':
                ctx.sessionOverrides.delete(sessionId);
                ctx.applyOverrides();
                return { kind: 'success', text: '已清除会话覆盖，回落 YAML 默认' };
            case 'save': {
                // persist THIS session's flat stage→model patch as the global default
                // (same shape the boot loader reads); other sessions' overrides are
                // per-session and must not be captured here
                const f = ctx.savedOverridesPath;
                const mine = ctx.sessionOverrides.get(sessionId) ?? {};
                const merged = { ...JSON.parse(ctx.fsOps.readTextIfExists(f) ?? '{}'), ...mine };
                ctx.fsOps.writeText(f, JSON.stringify(merged, null, 2));
                ctx.setSavedRaw(merged); // keep the in-memory base layer in sync immediately
                ctx.applyOverrides();
                return { kind: 'success', text: '当前覆盖已保存为全局默认（重启后加载）' };
            }
            case 'budget':
                return {
                    kind: 'success',
                    text: `编排消耗: 今日 ¥${ctx.ledger.estimatedToday().toFixed(3)} / ¥${ctx.cfg().budget.daily_limit_cny}\n透传观测: 今日 ¥${ctx.ledger.passthroughToday().toFixed(3)}（不计入硬上限 #27）`,
                };
            case 'task': {
                const goal = rest.join(' ').trim();
                if (!goal)
                    return { kind: 'error', text: '用法: /orch task <目标>（强制进编排，绕过分流）' };
                ctx.oneShot.set(sessionId, { forced: true });
                ctx.launchTask(agent, goal);
                return { kind: 'success', text: '已强制进入编排' };
            }
            case 'passthrough':
                ctx.oneShot.set(sessionId, { passthrough: true });
                return { kind: 'success', text: '下一条消息将透传当前模型（一次性）' };
            case 'abort': {
                const t = ctx.registry.activeForSession(sessionId);
                if (!t)
                    return { kind: 'error', text: '没有进行中的编排任务' };
                void ctx.cancelTask(t);
                return { kind: 'success', text: `任务 ${t.id} 已请求终止` };
            }
            default:
                return { kind: 'error', text: '用法: /orch <status|set|reset|save|budget|task|passthrough|abort>' };
        }
    });
}
//# sourceMappingURL=commands.js.map