/**
 * Host contract + dependency seams (P0-01, phase A1).
 *
 * Before this file `createEngine(ctx: AnyCtx, rawConfig)` accepted an all-`any`
 * host object and hard-wired every seam — the filesystem, the wall clock,
 * subagent dispatch and the mechanical verifier were all inlined in one 1500-line
 * closure, so the engine could only be exercised end-to-end against a live host.
 *
 * This file declares two things and nothing else:
 *
 *   1. the host API the engine actually reads (5 members, 2 optional), and
 *   2. the four replaceable seams (`fsOps`, `clock`, `subagents`, `spawner`)
 *      a unit test doubles without editing engine code.
 *
 * Declarations only — importing this module has no runtime effect.
 */
import type { MechanicalResult } from './types.js';
/** Structured-log target, matching the host's console-shaped logger. */
export interface HostLogger {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
/** A subagent run handle as returned by `SubagentRuntime.start`. */
export interface SubagentRun {
    id?: string;
    /** Resolves with the child's final payload; rejects on infrastructure faults. */
    result: unknown;
    /** Cancel + release; may be absent for a child that already settled. */
    dispose?: () => unknown;
}
/** Fresh in-process child dispatch (`mode: 'spawn'`). */
export interface SubagentRuntime {
    start: (mode: 'spawn', request: {
        parent: unknown;
        prompt: Array<{
            type: string;
            text: string;
        }>;
        signal: AbortSignal;
        label: string;
        agentOptions: {
            provider?: string;
            model: string;
        };
        outputSchema?: unknown;
    }) => SubagentRun | Promise<SubagentRun>;
}
/** One registered host command, as handed to `CommandRegistry.register`. */
export interface CommandDefinition {
    name: string;
    description?: string;
    input?: {
        hint?: string;
    };
    handler?: (args: any) => unknown;
}
/** An agent handle as fused into `agent/*` payloads and `session` events. */
export interface AgentHandle {
    id: string;
    steer: (m: unknown) => void;
    inject: (m: unknown) => void;
    session: {
        id: string;
        events: unknown[];
    };
}
/** Command registration surface, resolved as `ctx.get('commands')`. */
export interface CommandRegistry {
    register?: (definition: CommandDefinition) => unknown;
}
/** System-prompt section surface, resolved as `ctx.get('systemPrompt')`. */
export interface SystemPromptSection {
    section?: (def: {
        name: string;
        order: number;
        text: (context: unknown) => string;
    }) => unknown;
}
/** User-settings seam reached through `ctx.inject(['settings'], …)`. */
export interface SettingsService {
    register: (namespace: string, schema: unknown, opts?: {
        base?: unknown;
    }) => {
        watch: (fn: () => void) => () => void;
    };
    /** Exposes the RAW stored user section (not the schema-resolved value). */
    describe?: (opts?: {
        redactSecrets?: boolean;
    }) => unknown;
}
/**
 * The host surface the engine reads. `on`, `get` and `logger` are required;
 * `inject` and `effect` are optional — a headless test double only needs the
 * event bus, and production hosts omit neither.
 */
export interface HostContract {
    /** Subscribe to a host event; returns a disposer. */
    on: (name: string, listener: (...args: any[]) => unknown) => unknown;
    /** Resolve a host service by name ('subagents', 'commands', 'systemPrompt', 'agentDefaultModel'). */
    get: (name: string) => unknown;
    /** Deferred service injection ('settings'). */
    inject?: (names: string[], fn: (services: Record<string, unknown>) => void) => void;
    /** Register a disposal effect (runs on host shutdown). */
    effect?: (fn: () => void, label?: string) => void;
    logger: HostLogger;
}
/** Filesystem seam — the engine's only three direct calls. */
export interface FsOps {
    mkdirRecursive: (dir: string) => void;
    readTextIfExists: (file: string) => string | null;
    writeText: (file: string, text: string) => void;
}
/** Mechanical-verification seam (`verifier.run`). */
export interface MechanicalSpawner {
    run: (changedFiles: string[], force?: boolean, opts?: {
        signal?: AbortSignal;
    }) => Promise<MechanicalResult> | MechanicalResult;
}
/** Replaceable seams for `createEngine`; all four default to the real thing. */
export interface EngineDeps {
    fsOps: FsOps;
    /** Wall clock — swap to drive the wall-clock breaker and retention windows. */
    clock: () => number;
    /**
     * Subagent dispatch. Pass `null` to force the 'service missing' deadlock
     * path; leave `undefined` to resolve from `ctx.get('subagents')` per call
     * (the production behaviour, which is what keeps a late-registered provider
     * working).
     */
    subagents?: SubagentRuntime | null;
    spawner: MechanicalSpawner;
}
//# sourceMappingURL=host-contract.d.ts.map