/**
 * EngineCtx — the single shared-state bundle handed to the engine/* modules
 * (docs/重构方案-v3.md §2-D).
 *
 * Rules this file exists to enforce:
 *
 *  - Modules receive `ctx` plus explicit arguments and never hold their own
 *    mutable closure state. Every Map below is *owned* by `createEngine` and
 *    only exposed here, so a module cannot drift from the core's view.
 *  - Transition emission stays in engine.ts. A module that needs one either
 *    reports the event name to return (see `accounting.accountUsage`) or calls
 *    a callback that is *defined in the core* (`cancelTask`, `launchTask`,
 *    `settle`), so the FSM call graph stays auditable in one place.
 *  - `cfg()` is a getter, not a snapshot: settings/session overrides mutate
 *    `effectiveConfig` in place without a restart, and a captured reference
 *    would go stale on the next `/orch set`.
 */
import type { AgentHandle, FsOps, HostContract, HostLogger, MechanicalSpawner, SubagentRuntime } from '../host-contract.js';
import type { OrchestratorConfig } from '../config/schema.js';
import type { BudgetLedger } from '../budget/ledger.js';
import type { MechanicalVerifier } from '../protocols/mechanical.js';
import type { SnapshotStore } from '../persistence/snapshot.js';
import type { ModelHealthService } from '../router/health.js';
import type { ModelRouter, StageKey } from '../router/model-router.js';
import type { OrchestratorTask } from '../task/fsm.js';
import type { TaskRegistry, TaskScheduler } from '../task/registry.js';
import type { RiskLevel, TaskSnapshot } from '../types.js';
export type AnyAgent = AgentHandle;
/**
 * The core's `transitionOrLog`, passed to modules that need to drive the FSM.
 * Keeping the *definition* in engine.ts means every transition call site can be
 * audited from one file even when the calling logic lives in a module.
 */
export type TransitionFn = (task: OrchestratorTask, event: Parameters<OrchestratorTask['transition']>[0]) => Promise<boolean>;
/** Bookkeeping for a reviewer/auditor/planner/executor child session. */
export interface ChildSessionInfo {
    taskId: string;
    role: 'planner' | 'executor' | 'reviewer' | 'auditor';
}
export interface EngineCtx {
    host: HostContract;
    logger: HostLogger;
    /** Current effective config (global layers only; session overrides via `sessionEffective`). */
    cfg: () => OrchestratorConfig;
    registry: TaskRegistry;
    scheduler: TaskScheduler;
    ledger: BudgetLedger;
    health: ModelHealthService;
    router: ModelRouter;
    verifier: MechanicalVerifier;
    spawner: MechanicalSpawner;
    snapshots: SnapshotStore;
    fsOps: FsOps;
    clock: () => number;
    subagentRuntime: () => SubagentRuntime | null;
    agents: Map<string, AnyAgent>;
    childSessions: Map<string, ChildSessionInfo>;
    pendingSteer: Map<string, string | null>;
    lastBinding: Map<string, {
        provider?: string;
        model: string;
    }>;
    noticedOnce: Map<string, Set<string>>;
    requestRetries: Map<string, number>;
    oneShot: Map<string, {
        forced?: boolean;
        passthrough?: boolean;
    }>;
    sessionModeOverride: Map<string, 'on' | 'off'>;
    sessionOverrides: Map<string, Record<string, string>>;
    passthroughObserve: Set<string>;
    savedOverridesPath: string;
    savedRaw: () => Record<string, string>;
    setSavedRaw: (v: Record<string, string>) => void;
    applyOverrides: () => void;
    isOrchestrationEnabled: () => boolean;
    sessionEffective: (sessionId: string) => OrchestratorConfig;
    notice: (sessionId: string, text: string) => void;
    directive: (sessionId: string, text: string) => void;
    noticeOnce: (sessionId: string, key: string, text: string) => void;
    stageOfState: (state: string) => StageKey;
    riskOf: (snap: TaskSnapshot) => RiskLevel;
    costLine: (task: OrchestratorTask) => string;
    settle: (task: OrchestratorTask) => void;
    launchTask: (agent: AnyAgent, text: string) => void;
    cancelTask: (task: OrchestratorTask) => Promise<void>;
}
//# sourceMappingURL=ctx.d.ts.map