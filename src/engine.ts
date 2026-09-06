/**
 * Orchestrator plugin engine — wires the FSM, protocols and router into the
 * DSH host. Host-plane mount: one instance serves every session; agents are
 * distinguished by the `agent` field fused into agent/* payloads and by the
 * session identity passed to `session/event` listeners.
 *
 * Layout (docs/重构方案-v3.md §2-D): this file owns
 *
 *   - `createEngine` and every piece of shared mutable state,
 *   - ALL `transition()` emission, through `transitionOrLog` — modules that
 *     need one report the event name (`accountUsage`) or call a callback
 *     defined here (`cancelTask`, `settle`, `launchTask`),
 *   - the host listeners (input, session events, request waterfall, turn
 *     stopping) and the boot-time recovery,
 *
 * while prompt building (`prompts`), child dispatch (`child-run`, `review`,
 * `audit`), accounting (`accounting`), command registration (`commands`), the
 * transition hook table (`hooks`) and the system prompt (`system-prompt`)
 * live in `src/engine/*`, each receiving the `EngineCtx` bundle below plus
 * explicit arguments and holding no closure state of their own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BudgetLedger, type Pricing } from './budget/ledger.js';
import { mergeOverride, orchestratorConfigSchema, type OrchestratorConfig } from './config/schema.js';
import { isUnpricedModel, resolvePricingRate } from './engine/accounting.js';
import { runAuditGateIfPending } from './engine/audit.js';
import { registerCommands } from './engine/commands.js';
import type { EngineCtx } from './engine/ctx.js';
import { onSessionEvent } from './engine/events.js';
import { buildHooks } from './engine/hooks.js';
import { createNotify } from './engine/notify.js';
import { REVIEW_PROMPT_MARKER } from './engine/prompts.js';
import { onRequest, onRequestError } from './engine/request.js';
import { recover as recoverStale } from './engine/recovery.js';
import { runReview } from './engine/review.js';
import { registerSystemPrompt } from './engine/system-prompt.js';
import { readIfExists, textOfContent } from './engine/util.js';
import { Gate } from './gate/gate.js';
import type {
  AgentHandle,
  EngineDeps,
  FsOps,
  HostContract,
  MechanicalSpawner,
  SettingsService,
  SubagentRuntime,
} from './host-contract.js';
import { MechanicalVerifier } from './protocols/mechanical.js';
import { AUDIT_PROMPT_MARKER } from './protocols/plan-audit.js';
import { SnapshotStore } from './persistence/snapshot.js';
import { ModelHealthService } from './router/health.js';
import { ModelRouter, type StageKey } from './router/model-router.js';
import {
  SETTINGS_NAMESPACE,
  applySettingsOverlay,
  buildConfigBase,
  orchestratorSettingsSchema,
  type OrchestratorSettingsSection,
} from './settings/namespace.js';
import { OrchestratorTask, type TaskHooks } from './task/fsm.js';
import { TaskRegistry, TaskScheduler } from './task/registry.js';
import { MILESTONES, renderAuditNote, renderCost, renderPlanSummary } from './visibility/milestones.js';
import { isTerminal, type RiskLevel, type TaskSnapshot } from './types.js';

export type AnyAgent = AgentHandle;

// public pricing surface — test/units.test.ts imports both from this module,
// so the helpers stay exported here even though the implementation moved to
// src/engine/accounting.ts
export { isUnpricedModel, resolvePricingRate };

export function createEngine(ctx: HostContract, rawConfig: unknown, deps?: Partial<EngineDeps>) {
  const cfg: OrchestratorConfig = orchestratorConfigSchema.parse(rawConfig ?? {});
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const dataDir = join(home, 'storages', 'orchestrator');
  mkdirSync(dataDir, { recursive: true });

  const snapshots = new SnapshotStore(join(dataDir, 'tasks'));
  // P1-13: intermediate saves coalesce per tick; terminal/abandoned saves stay
  // synchronous. `setImmediate` never fires on process exit, so drain here too.
  const exitFlush = () => snapshots.flushAll();
  process.once('exit', exitFlush);
  const health = new ModelHealthService();
  const router = new ModelRouter(() => effectiveConfig, health);
  // a malformed gate pattern in a user patch degrades the gate, it must never
  // throw out of createEngine and keep the plugin from booting (P1-09)
  const gate = new Gate(cfg.gate, (message) => ctx.logger.warn(message));
  // resolves on each debit so settings/session overrides take effect without a
  // restart (same pattern as the limits getter below)
  const pricing: Pricing = { rate: (_provider, model) => resolvePricingRate(effectiveConfig.budget, model) };
  const ledger = new BudgetLedger(join(dataDir, 'budget'), pricing, () => ({
    dailyLimitCny: effectiveConfig.budget.daily_limit_cny,
    taskLimitCny: effectiveConfig.budget.task_limit_cny,
    countPassthrough: effectiveConfig.budget.count_passthrough,
  }));
  const verifier = new MechanicalVerifier(
    {
      enabled: cfg.mechanical_verification.enabled,
      commands: cfg.mechanical_verification.commands,
      timeout_ms: cfg.mechanical_verification.timeout_ms,
      parallel: cfg.mechanical_verification.parallel,
    },
    () => process.cwd(),
    // settings-curated switch: the UI toggle must take effect without a restart
    () => effectiveConfig.mechanical_verification.enabled,
  );

  const registry = new TaskRegistry();
  const scheduler = new TaskScheduler();
  const agents = new Map<string, AnyAgent>();
  const oneShot = new Map<string, { forced?: boolean; passthrough?: boolean }>();
  const sessionModeOverride = new Map<string, 'on' | 'off'>(); // /per on|off per-session; settled with tasks
  const sessionOverrides = new Map<string, Record<string, string>>(); // /orch set per-session stage-model patches
  const passthroughObserve = new Set<string>();
  const lastBinding = new Map<string, { provider?: string; model: string }>();
  const requestRetries = new Map<string, number>(); // sessionId → consecutive request-error retries
  const noticedOnce = new Map<string, Set<string>>(); // sessionId → notice keys already shown
  const childSessions = new Map<string, { taskId: string; role: 'planner' | 'executor' | 'reviewer' | 'auditor' }>();
  const pendingSteer = new Map<string, string | null>(); // taskId → directive text for next turn-stopping
  const disposers: Array<() => void> = [];

  // ── dependency seams (A1) ────────────────────────────────────────────────
  // Each defaults to the production implementation, so omitting `deps` is
  // byte-for-byte the old behaviour; a unit test passes only what it fakes.

  /** Filesystem — the engine's only three direct calls (saved-overrides + data dir). */
  const fsOps: FsOps = deps?.fsOps ?? {
    mkdirRecursive: (d) => mkdirSync(d, { recursive: true }),
    readTextIfExists: readIfExists,
    writeText: (f, t) => writeFileSync(f, t, 'utf8'),
  };

  /** Wall clock — swap to drive the wall-clock breaker and retention windows. */
  const clock: () => number = deps?.clock ?? (() => Date.now());

  /**
   * Subagent dispatch. `undefined` means "resolve from the host per call",
   * which keeps a late-registered provider working; `null` forces the
   * 'service missing' deadlock path.
   */
  const subagentRuntime = (): SubagentRuntime | null => {
    if (deps?.subagents !== undefined) return deps.subagents;
    const host = ctx.get('subagents') as SubagentRuntime | null | undefined;
    return host?.start ? host : null;
  };

  /** Mechanical verification — `spawner` is the verifier unless a test fakes it. */
  const spawner: MechanicalSpawner = deps?.spawner ?? verifier;

  // config layering, top → bottom (v5.3):
  //   session /orch set  >  settings 用户段 (settings.yaml `dsh-per`)
  //   >  saved-overrides.json (/orch save)  >  patch cfg
  const savedOverridesPath = join(dataDir, 'saved-overrides.json');
  let savedRaw: Record<string, string> = (() => {
    try {
      return (JSON.parse(fsOps.readTextIfExists(savedOverridesPath) ?? '{}') as Record<string, string>) ?? {};
    } catch {
      return {};
    }
  })();
  let settingsSection: OrchestratorSettingsSection | null = null;
  let effectiveConfig: OrchestratorConfig = cfg;
  // effectiveConfig = GLOBAL layers only (patch → saved → settings user
  // section). Session /orch set overrides are applied per-session at binding
  // time (sessionEffective / router override), never merged globally — a
  // multi-session host must not let one session's override leak into another.
  const applyOverrides = () => {
    const base = Object.keys(savedRaw).length ? mergeOverride(cfg, savedRaw) : cfg;
    effectiveConfig = settingsSection ? applySettingsOverlay(base, settingsSection) : base;
  };
  const isOrchestrationEnabled = () =>
    effectiveConfig.mode === 'gated' || (effectiveConfig.mode === 'auto' && Boolean(effectiveConfig.stages));

  /** Session-effective config: global layers + THIS session's /orch set overrides. */
  const sessionEffective = (sessionId: string): OrchestratorConfig => {
    const ov = sessionOverrides.get(sessionId);
    return ov && Object.keys(ov).length ? mergeOverride(effectiveConfig, ov) : effectiveConfig;
  };

  // settings namespace registration (official installSettingsSection shape):
  // inject-wait for the settings provider, then register the user layer above
  // the patch config. A failed registration (rejected stored section / missing
  // provider) degrades to patch-only rather than taking the plugin down (D11)
  //
  // S2 (review): the overlay consumes the RAW USER SECTION, not the resolved
  // value — scope.get() resolves schema-defaults + registered base + user, so
  // feeding it to applySettingsOverlay would mask saved-overrides (the base is
  // frozen at registration) and neuter the resurrection defaults. The provider
  // describe() exposes the raw stored user layer; we re-read it per watch.
  try {
    ctx.inject?.(['settings'], (services) => {
      const sctx = services as { settings?: SettingsService; effect?: (fn: () => void, label?: string) => void };
      if (!sctx.settings) return; // provider absent: stay patch-only
      try {
        const seamBase = Object.keys(savedRaw).length ? mergeOverride(cfg, savedRaw) : cfg;
        const scope = sctx.settings.register(SETTINGS_NAMESPACE, orchestratorSettingsSchema, { base: buildConfigBase(seamBase) });
        const rawUserOf = (): OrchestratorSettingsSection | null => {
          try {
            const desc = (sctx.settings!.describe?.({ redactSecrets: true }) as Array<{ ns: string; user?: unknown }> | undefined)?.find((d) => d.ns === SETTINGS_NAMESPACE);
            return (desc?.user as OrchestratorSettingsSection | undefined) ?? null;
          } catch {
            return null;
          }
        };
        settingsSection = rawUserOf();
        applyOverrides();
        const unwatch = scope.watch(() => {
          settingsSection = rawUserOf();
          applyOverrides();
          ctx.logger.info(
            'orchestrator: settings section updated (mode=%s, stages=%s)',
            effectiveConfig.mode,
            Boolean(effectiveConfig.stages),
          );
        });
        disposers.push(unwatch);
        sctx.effect?.(() => () => {
          settingsSection = null;
          applyOverrides();
        });
      } catch (e) {
        // D11: a registration failure inside the deferred inject callback
        // (rejected stored section, provider race) must not take the plugin
        // down — degrade to patch-only and keep serving
        ctx.logger.warn('orchestrator: settings namespace registration failed, falling back to patch-only config: %o', e);
      }
    });
  } catch (e) {
    ctx.logger.warn('orchestrator: settings namespace registration failed, falling back to patch-only config: %o', e);
  }
  applyOverrides();

  const notify = createNotify({ cfg: () => effectiveConfig, agents, noticedOnce });
  const notice = notify.notice;
  const noticeOnce = notify.noticeOnce;
  const directive = notify.directive;

  const stageOfState = (state: string): StageKey =>
    state === 'EXECUTING' ? 'execute' : state === 'REVIEWING' ? 'review' : 'plan';

  // P2-14 (v3 fix): `riskOf` runs on every request/review — compile the
  // sensitive-path globs once per config revision instead of per file per call.
  // The `**/` prefix means "any number of leading segments", i.e. ZERO too, so
  // it is compiled as an OPTIONAL `((?:.*/)?)`. The v2 wording used a required
  // `.*/`, which made `**/auth/**` miss a top-level `auth/login.ts` — that
  // silently demoted the risk to `standard` and let the quick channel deliver
  // straight to DONE with no reviewer at all.
  let sensitiveCache: { src: readonly string[]; res: RegExp[] } | null = null;
  const sensitiveRes = (): RegExp[] => {
    const paths = effectiveConfig.risk_profile.sensitive_paths;
    if (!sensitiveCache || sensitiveCache.src !== paths) {
      const res: RegExp[] = [];
      for (const pat of paths) {
        const deep = pat.startsWith('**/');
        // escape regex specials first (keeping `*`), then translate runs of
        // stars in one pass — a naive `**`→`.*` followed by `*`→`[^/]*` would
        // rewrite the `*` inside the just-inserted `.*`
        const core = (deep ? pat.slice(3) : pat)
          .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? ch : `\\${ch}`))
          .replace(/\*+/g, (stars) => (stars.length >= 2 ? '.*' : '[^/]*'));
        try {
          res.push(new RegExp(`^(?:${deep ? '(?:.*/)?' : ''}${core})$`));
        } catch {
          ctx.logger.warn(`orchestrator: dropping invalid sensitive_paths entry ${JSON.stringify(pat)}`);
        }
      }
      sensitiveCache = { src: paths, res };
    }
    return sensitiveCache.res;
  };

  const riskOf = (snap: TaskSnapshot): RiskLevel => {
    if (snap.plan?.risk_level === 'high') return 'high';
    const hit = [...(snap.plan?.steps.flatMap((s) => s.files ?? []) ?? []), ...snap.executionProduct?.changedFiles ?? []].some((f) =>
      sensitiveRes().some((re) => re.test(f)),
    );
    if (hit) return 'high';
    if ((snap.executionProduct?.diffLines ?? 0) > effectiveConfig.risk_profile.high_diff_lines) return 'elevated';
    return 'standard';
  };

  // ── task settlement ───────────────────────────────────────────────────────

  const settle = (task: OrchestratorTask) => {
    snapshots.save(task.snapshot);
    registry.settle(task);
    // bounded memory: drop per-task and per-session bookkeeping on settlement.
    // The child (reviewer/auditor) sessions are cleaned by CHILD sid here, not
    // by the root session id below — otherwise every dispatch leaks three Map
    // entries for the life of the host (P1-08).
    for (const [sid, info] of childSessions) {
      if (info.taskId !== task.id) continue;
      childSessions.delete(sid);
      registry.untrackChild(sid);
      agents.delete(sid);
      lastBinding.delete(sid);
      requestRetries.delete(sid);
      noticedOnce.delete(sid);
    }
    pendingSteer.delete(task.id);
    noticedOnce.delete(task.snapshot.sessionId);
    lastBinding.delete(task.snapshot.sessionId);
    requestRetries.delete(task.snapshot.sessionId);
    registry.prune(); // terminal tasks past retention leave memory; files stay
    ledger.pruneTasks(new Set(registry.all().map((t) => t.id)));
    const next = scheduler.finished(task);
    if (next) {
      // the plan does not exist yet at queue hand-off, so `executing` would
      // have advertised「计划 0 步」(P1-12) — report the launch instead
      const behind = scheduler.queuedBehind > 0 ? `（后续还有 ${scheduler.queuedBehind} 个任务排队）` : '';
      notice(next.snapshot.sessionId, MILESTONES.launching(next.snapshot.goal, behind));
      transitionOrLog(next, 'task/launch');
      pendingSteer.set(next.id, `【编排任务启动】${next.snapshot.goal}`);
    }
    // drop the agent registration only when no queued task remains for the
    // SAME session — the queued task's launch milestone above is delivered
    // through the agent, and a later event re-registers it anyway
    if (!next || next.snapshot.sessionId !== task.snapshot.sessionId) {
      agents.delete(task.snapshot.sessionId);
    }
  };

  const costLine = (task: OrchestratorTask) => renderCost(task.snapshot, ledger.estimatedToday(), effectiveConfig.budget.daily_limit_cny);

  // ── shared-state bundle handed to the src/engine/* modules ────────────────
  const engine: EngineCtx = {
    host: ctx,
    logger: ctx.logger,
    cfg: () => effectiveConfig,
    registry,
    scheduler,
    ledger,
    health,
    router,
    verifier,
    spawner,
    snapshots,
    fsOps,
    clock,
    subagentRuntime,
    agents,
    childSessions,
    pendingSteer,
    lastBinding,
    noticedOnce,
    requestRetries,
    oneShot,
    sessionModeOverride,
    sessionOverrides,
    passthroughObserve,
    savedOverridesPath,
    savedRaw: () => savedRaw,
    setSavedRaw: (v) => {
      savedRaw = v;
    },
    applyOverrides,
    isOrchestrationEnabled,
    sessionEffective,
    notice,
    directive,
    noticeOnce,
    stageOfState,
    riskOf,
    costLine,
    settle,
    launchTask: (agent, text) => handleUserInput(agent, { source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    cancelTask: (task) => transitionOrLog(task, 'user/cancel').then(() => undefined),
  };

  // ── task hooks (transition actions) ──────────────────────────────────────

  const hooks: TaskHooks = buildHooks(engine);

  async function transitionOrLog(task: OrchestratorTask, event: Parameters<OrchestratorTask['transition']>[0]) {
    let ok = false;
    try {
      ok = await task.transition(event);
    } catch (e) {
      // a hook crash must never surface as an unhandled rejection — the state
      // change already happened, so log, persist, and keep the host alive
      ctx.logger.error(`orchestrator: hook failure on ${event} (${task.id}): %o`, e);
      snapshots.save(task.snapshot);
      return false;
    }
    if (!ok) ctx.logger.warn(`orchestrator: transition ${event} rejected on ${task.id} (state=${task.state})`);
    snapshots.save(task.snapshot);
    return ok;
  }

  // ── task creation & input routing (A10) ─────────────────────────────────

  async function handleUserInput(agent: AnyAgent, message: any) {
    agents.set(agent.id, agent);
    requestRetries.delete(agent.id); // fresh input: reset the consecutive-failure cap
    noticedOnce.delete(agent.id);
    if (message?.source?.kind !== 'user') return; // A8: plugin sources never re-gate
    const sessionId = agent.id;
    const text = textOfContent(message.content).trim();
    if (!text) return;
    // reviewer/auditor children deliver their own prompt as a user message in
    // their own session; run.id != child session id, so the childSessions
    // filter cannot catch it — gate on the prompt markers instead
    if (text.startsWith(REVIEW_PROMPT_MARKER) || text.startsWith(AUDIT_PROMPT_MARKER)) return;
    if (registry.isChild(sessionId)) return;

    const flags = oneShot.get(sessionId) ?? {};
    // consume the one-shot flag before any early return below — leaving it set
    // across the active-task branch made it leak into a later unrelated message
    // (P2-06)
    oneShot.delete(sessionId);
    const active = registry.activeForSession(sessionId);

    if (active && !isTerminal(active.state)) {
      // §9.2 state routing
      const st = active.state;
      if (st === 'PLANNING' || st === 'RE-PLANNING' || st === 'IDLE') {
        active.snapshot.goal = text; // M1 (IDLE = queued task: goal refresh applies at launch)
        active.snapshot.stageSteps.plan = 0;
        notice(sessionId, st === 'IDLE' ? '【编排】任务排队中，目标已更新' : '【编排】目标已更新，重新规划');
      } else if (st === 'EXECUTING') {
        active.snapshot.userDirectives.push(text);
        notice(sessionId, '【编排】收到补充指令，将在下一轮注入');
      } else if (st === 'REVIEWING') {
        active.snapshot.userDirectives.push(text);
        notice(sessionId, '【编排】复核进行中，输入将在下一执行轮生效');
      }
      return;
    }

    // no active task — gate decision (/per on|off override the mode layer per session)
    const modeOv = sessionModeOverride.get(sessionId);
    let decision;
    if (modeOv === 'off') {
      decision = { decision: 'passthrough' as const, forced: false, rule: 'mode: /per off（会话级）' };
    } else if (!isOrchestrationEnabled() && modeOv !== 'on') {
      decision = { decision: 'passthrough' as const, forced: false, rule: 'mode: orchestration disabled (ADR #13)' };
    } else {
      decision = gate.decide({ text, forced: flags.forced || modeOv === 'on', passthroughFlag: flags.passthrough });
    }

    if (decision.decision === 'passthrough') {
      // passthrough sessions never create tasks, so nothing else prunes this
      // set — cap it so a long-lived host cannot grow it without bound
      if (passthroughObserve.size > 5000) passthroughObserve.clear();
      passthroughObserve.add(sessionId);
      return;
    }

    // budget pre-check (A14)
    if (ledger.estimatedToday() >= effectiveConfig.budget.daily_limit_cny) {
      notice(sessionId, MILESTONES.launchRejected('今日预算已触顶，可 /orch budget 查看明细'));
      return;
    }
    // E10: task-level budget pre-check — if the remaining daily budget cannot
    // cover the task limit, the task will almost certainly hit the daily cap
    // and abort mid-run. Reject up front instead of starting a doomed cycle.
    const remaining = effectiveConfig.budget.daily_limit_cny - ledger.estimatedToday();
    if (remaining < effectiveConfig.budget.task_limit_cny * 0.5) {
      notice(sessionId, MILESTONES.launchRejected(`今日剩余预算 ¥${remaining.toFixed(2)} 不足任务限额 ¥${effectiveConfig.budget.task_limit_cny} 的 50%，可 /orch budget 查看明细`));
      return;
    }

    // forced/gated orchestration on an inert install (no stages configured) can
    // never run: reject up front with a clear message instead of creating a
    // task that instantly aborts on the task/launch guard (configValid=false)
    if (!effectiveConfig.stages) {
      notice(sessionId, MILESTONES.launchRejected('未配置阶段模型（stages），编排不可用；请先在设置界面或补丁中配置 plan/execute/review 模型'));
      return;
    }

    const task = new OrchestratorTask({
      id: `task-${clock().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
      sessionId,
      goal: text,
      hooks,
      limits: {
        plan_retry_max: effectiveConfig.limits.plan_retry_max,
        exec_retry_max: effectiveConfig.limits.exec_retry_max,
        replan_cycle_max: effectiveConfig.limits.replan_cycle_max,
        fix_loop_max: effectiveConfig.fix_loop.max_cycles,
      },
      gateDecision: decision,
    });
    registry.attach(task);
    const admitted = scheduler.admit(task);
    if (!admitted) {
      notice(sessionId, MILESTONES.queued(scheduler.positionOf(task)));
      return;
    }
    task.flags.configValid = Boolean(effectiveConfig.stages);
    task.flags.budgetOk = true;
    // C2 / C5: hand the delivery policy to the guard layer. Both default to the
    // historic behaviour, so omitting either key changes nothing.
    task.flags.fixExhaustionAborts = effectiveConfig.fix_loop.exhausted_delivery === 'abort';
    task.flags.budgetExhaustionAborts = effectiveConfig.budget.on_exhausted === 'abort';
    const launched = await transitionOrLog(task, 'task/launch');
    if (launched) notice(sessionId, `【编排】任务启动：${text.slice(0, 80)}（gate: ${decision.rule}）`);
  }

  // ── turn driver (V5: turn-stopping + steer) ─────────────────────────────

  async function onTurnStopping(payload: { agent: AnyAgent; turn: number; signal: AbortSignal }) {
    const agent = payload.agent;
    const sessionId = agent.id;
    agents.set(sessionId, agent);
    const task = registry.activeForSession(sessionId);
    if (!task) return;
    if (isTerminal(task.state)) {
      settle(task);
      return;
    }

    const snap = task.snapshot;
    const steerNext = () => {
      const text = pendingSteer.get(task.id);
      pendingSteer.set(task.id, null);
      if (text) directive(sessionId, text);
      return Boolean(text);
    };

    // P2-20: the EXECUTING→REVIEWING hand-off used to recurse into
    // onTurnStopping; an explicit bounded loop drives the same pipeline without
    // unbounded async stack depth.
    for (let hops = 0; hops < 8; hops++) {
      switch (task.state) {
        case 'PLANNING': {
          if (await runAuditGateIfPending(engine, transitionOrLog, task, agent, payload.signal)) return; // v5.2 gate
          if (snap.stageSteps.plan > effectiveConfig.limits.planning_steps_max) {
            await transitionOrLog(task, 'plan/steps-exceeded');
            await transitionOrLog(task, 'plan/retry');
            steerNext();
            return;
          }
          const err = (task as unknown as { lastPlanError?: string }).lastPlanError;
          pendingSteer.set(
            task.id,
            `【规划指令】请完成调研后输出单个 \`\`\`plan 围栏 JSON 计划（PlanDocument schema：steps[{id,title,files?,risk_note?}], complexity, review_hint, risk_level, estimated_context_tokens）。${err ? `上次错误：${err}` : ''}`,
          );
          steerNext();
          return;
        }
        case 'PLAN_FAIL': {
          await transitionOrLog(task, 'plan/retry');
          steerNext();
          return;
        }
        case 'RE-PLANNING': {
          // No pre-flight replan-cycle check here (P1-05). Every row that
          // increments `replan_cycle` guards on `replan_cycle < max`, so the
          // limit is enforced exactly once — at entry. A check here would be
          // `> max` (permanently dead) or `>= max`, which aborts the LAST
          // permitted attempt and turns a flagged delivery into a bare abort
          // (E2E R13: a NEED_REPLAN loop must land on DONE_FLAGGED with the
          // product, not ABORTED). Exhaustion is reachable from the table
          // instead: `replan/fail` → `replan/fail:EXHAUSTED`.
          if (await runAuditGateIfPending(engine, transitionOrLog, task, agent, payload.signal)) return; // v5.2 gate
          if (snap.stageSteps.plan > effectiveConfig.limits.planning_steps_max) {
            await transitionOrLog(task, 'replan/fail');
            steerNext();
            return;
          }
          pendingSteer.set(task.id, pendingSteer.get(task.id) ?? '【重规划】请基于反馈修订计划并输出 ```plan 围栏 JSON。');
          steerNext();
          return;
        }
        case 'EXECUTING': {
          if (snap.needReplan) {
            snap.needReplan = false;
            await transitionOrLog(task, 'exec/need-replan');
            steerNext();
            return;
          }
          // tool errors present at the turn boundary => exec/fail retry track
          // (bounded by exec_retry_max, then the exec/fail:REPLAN fallback)
          if (snap.execErrorCount > 0) {
            await transitionOrLog(task, 'exec/fail');
            steerNext();
            return;
          }
          if (snap.stageSteps.execute > effectiveConfig.limits.executing_steps_max) {
            await transitionOrLog(task, 'exec/steps-exceeded');
            steerNext();
            return;
          }
          // exec/ok path: quick-channel evaluation requires mechanical verification (A4)
          let quickOk = false;
          if (
            snap.plan?.review_hint === 'skip' &&
            riskOf(snap) !== 'high' &&
            effectiveConfig.mechanical_verification.enabled
          ) {
            const mech = await spawner.run(snap.executionProduct?.changedFiles ?? [], false, { signal: payload.signal });
            snap.mechanicalResult = mech;
            // every CONFIGURED check must pass, lint included (P1-14)
            const checks = [mech.compile, mech.lint, mech.tests].filter(Boolean);
            quickOk = checks.length > 0 && checks.every((c) => c!.check === 'pass');
          }
          if (quickOk) {
            task.flags.quickChannelOk = true;
            await transitionOrLog(task, 'exec/ok:DONE');
            return;
          }
          task.flags.quickChannelOk = false;
          await transitionOrLog(task, 'exec/ok'); // → REVIEWING; loop drives the review (P2-20)
          continue;
        }
        case 'REVIEWING': {
          const verdictRoute = await runReview(engine, transitionOrLog, task, agent, payload.signal);
          if (verdictRoute === 'ended') return;
          // after a fail-exec/inject we steer; after DONE/flagged we end
          if (!steerNext() && !isTerminal(task.state)) {
            // nothing to steer and not terminal (ambiguous handled) — prompt to continue
            directive(sessionId, '【编排】请继续。');
          }
          return;
        }
        default:
          return;
      }
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  // Host listeners are fire-and-forget, but a rejection inside them is NOT
  // benign async work: Node escalates an unhandled rejection and a long-lived
  // host can die with the plugin. Catch, log, and let the next event flow —
  // the FSM has already persisted whatever state change did happen.
  const guard = (label: string, run: () => Promise<unknown>): void => {
    run().catch((error) => {
      ctx.logger.error('orchestrator: %s failed: %o', label, error);
    });
  };

  disposers.push(
    ctx.on('session/event', (session: any, event: any) => {
      guard('session/event', () => onSessionEvent(engine, transitionOrLog, session, event));
    }) as unknown as () => void,
  );
  disposers.push(
    ctx.on('agent/inbox/claimed', (payload: any) => {
      guard('agent/inbox/claimed', () => handleUserInput(payload.agent, payload.message));
    }) as unknown as () => void,
  );
  // NOTE: the two request middlewares are NOT wrapped in `guard` — they answer
  // the host's middleware chain (`{ kind: 'retry' }`, rewritten bindings), so
  // their return value must reach the host verbatim; the host awaits them, so a
  // rejection is handled by the host chain rather than becoming unhandled.
  disposers.push(
    ctx.on('agent/request', (payload: any, next: () => Promise<any>) => onRequest(engine, transitionOrLog, payload, next)) as unknown as () => void,
  );
  disposers.push(
    ctx.on('agent/request-error', (payload: any, next: () => Promise<unknown>) => onRequestError(engine, transitionOrLog, payload, next)) as unknown as () => void,
  );
  disposers.push(ctx.on('agent/turn-stopping', onTurnStopping) as unknown as () => void);
  disposers.push(
    ctx.on('subagent/start', (info: any) => {
      if (info?.id) registry.trackChild(info.id);
    }) as unknown as () => void,
  );

  // v1 recovery policy aborts non-terminal snapshots from dead hosts (see
  // engine/recovery.ts); there is deliberately no session-resume steer — a new
  // host process cannot resume the old conversation's turn loop. The aborts are
  // awaited inside, so a boot is never observed with a stale task still
  // occupying the serial scheduler.
  void recoverStale(engine, hooks).catch((error) => {
    ctx.logger.error('orchestrator: recovery failed: %o', error);
  });

  ctx.effect?.(() => () => {
    for (const d of disposers.splice(0)) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
    exitFlush(); // no pending intermediate snapshot outlives the plugin
    process.off('exit', exitFlush);
  }, 'orchestrator: dispose listeners');

  registerCommands(engine);
  registerSystemPrompt(engine);

  return {
    config: effectiveConfig,
    registry,
    scheduler,
    ledger,
    health,
    verifier,
  };
}

export type OrchestratorEngine = ReturnType<typeof createEngine>;
