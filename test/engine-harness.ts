import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createEngine } from '../src/engine.js';
import { applySettingsOverlay } from '../src/settings/namespace.js';
import type { OrchestratorConfig } from '../src/config/schema.js';
import type { EngineDeps, HostContract } from '../src/host-contract.js';
import type { MechanicalResult } from '../src/types.js';

/**
 * Headless host harness for engine unit tests (P0-01, phase A6).
 *
 * Every engine entry point is reachable through a captured host listener — no
 * E2E harness needed:
 *
 *   handleUserInput      ← host event `agent/inbox/claimed`
 *   onSessionEvent       ← host event `session/event`
 *   onRequest            ← host event `agent/request`
 *   onRequestError       ← host event `agent/request-error`
 *   onTurnStopping       ← host event `agent/turn-stopping`
 *   subagent tracking    ← host event `subagent/start`
 *
 * `dispatchReviewer`, `runAuditGateIfPending`, `accountUsage` and `recover` are
 * not listener-backed, so they are exercised through their callers: review
 * dispatch through a turned-out task in REVIEWING, the audit gate through a
 * fenced plan with plan_audit configured, accounting through `assistant/message`,
 * and recovery through snapshot files pre-seeded under DSH_HOME.
 *
 * The data dir stays on real disk (SnapshotStore, BudgetLedger and the engine's
 * own mkdirSync are not behind the fsOps seam) — a fresh temp DSH_HOME per test
 * gives isolation without touching the user's real ~/.dsh.
 */

export const PLAN_DOC = {
  steps: [{ id: '1', title: 't', files: ['src/a.ts'] }],
  complexity: 'low',
  review_hint: 'full',
  risk_level: 'standard',
  estimated_context_tokens: 100,
};

/** A plan fence the host session event will pick up. */
export const planFence = (over: Record<string, unknown> = {}, withAuditResponse = false): string =>
  '```plan\n' + JSON.stringify({ ...PLAN_DOC, ...over, ...(withAuditResponse ? { audit_response: { adopted: ['IA1'], rebutted: [] } } : {}) }) + '\n```';

export const verdict = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  planVersion: 1,
  pass: false,
  defect_type: 'execution',
  confidence: 0.9,
  issues: [{ id: 'I1', dimension: 'code_quality', severity: 'major', description: '缺陷' }],
  ...over,
});

export const auditVerdict = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  passed: true,
  confidence: 0.9,
  issues: [],
  rebuttal_verdicts: [],
  ...over,
});

export const auditIssue = (
  id: string,
  severity: 'blocker' | 'major' | 'minor' = 'major',
  dimension = 'feasibility',
): Record<string, unknown> => ({
  id,
  dimension,
  severity,
  description: `${id} 问题`,
  suggestion: `${id} 修改建议`,
});

/** Mechanical result: pass unless a specific check is flagged. */
export const mechPass = (overrides: Partial<Record<'compile' | 'tests', string>> = {}): MechanicalResult => ({
  ranAt: 0,
  compile: { check: (overrides.compile ?? 'pass') as MechanicalResult['compile'] extends infer C ? NonNullable<C>['check'] : never },
  tests: { check: (overrides.tests ?? 'pass') as MechanicalResult['tests'] extends infer T ? NonNullable<T>['check'] : never },
});

/**
 * Default config for engine tests: orchestration ON (`mode: 'gated'` makes
 * isOrchestrationEnabled() true without needing a gate regex hit), deepseek-v4-flash
 * stage models so the built-in pricing table keeps cost non-zero. Mechanical
 * verification stays on its schema default (enabled), but the default stub
 * spawner returns no checks — so the quick channel can never fire unless a
 * test injects a spawner that reports passes. `over` is folded in as a settings section.
 */
export const baseConfig = (over: Record<string, unknown> = {}): OrchestratorConfig =>
  applySettingsOverlay(
    {
      mode: 'gated',
      stages: { plan: { model: 'deepseek-v4-flash' }, execute: { model: 'deepseek-v4-flash' }, review: { model: 'deepseek-v4-flash' } },
    } as Record<string, unknown>,
    over as Parameters<typeof applySettingsOverlay>[1],
  );

export interface FakeSubagentRun {
  id: string;
  result: Promise<{ stopReason: string; structured: unknown }>;
  disposed: number;
  dispose: () => unknown;
}

export interface FakeAgent {
  id: string;
  injected: unknown[];
  steered: unknown[];
  session: { id: string; events: unknown[] };
  inject: (m: unknown) => void;
  steer: (m: unknown) => void;
}

export function makeAgent(id = 'sess-1'): FakeAgent {
  return {
    id,
    injected: [],
    steered: [],
    session: { id, events: [] },
    inject(m) { this.injected.push(m); },
    steer(m) { this.steered.push(m); },
  };
}

/** Pull the human text out of a steer/inject message (same shape the engine builds). */
export const textOf = (msg: unknown): string => {
  const c = (msg as { content?: Array<{ type: string; text?: string }> })?.content;
  return Array.isArray(c) ? (c as Array<{ type: string; text?: string }>).map((b) => b.text ?? '').join('\n') : '';
};

/** All push notices for a session, as plain text (plugin notices only). */
export const notices = (agent: FakeAgent): string[] => agent.injected.map(textOf).filter(Boolean);

export interface HarnessOpts {
  config?: OrchestratorConfig;
  deps?: Partial<EngineDeps>;
  agents?: FakeAgent;
  /** Subagent spawns to return, consumed in order; the last one repeats. */
  subagents?: ((request: Record<string, unknown>, seq: number) => FakeSubagentRun)[];
}

/**
 * Assertion-friendly view over a task in the registry. `state`/`id` are getters
 * on `OrchestratorTask`, so they are surfaced alongside the snapshot (where
 * `goal` actually lives) to keep test sites readable.
 */
export interface HarnessTask {
  id: string;
  state: string;
  goal: string;
  snapshot: Record<string, unknown> & {
    state: string;
    goal: string;
    plan: Record<string, unknown> | null;
    planVersion: number;
    needReplan: boolean;
    execErrorCount: number;
    fixEscalated: boolean;
    pendingFixes: unknown[];
    stageSteps: Record<string, number>;
    counters: Record<string, number>;
    illegal?: number;
  };
}

export const tasksOf = (h: Harness): HarnessTask[] =>
  (h.registry as { all: () => Array<{ id: string; state: string; snapshot: HarnessTask['snapshot'] }> }).all().map((t) => ({
    id: t.id,
    state: t.state,
    goal: t.snapshot.goal,
    snapshot: t.snapshot,
  }));

export interface Harness extends Record<string, unknown> {
  config: OrchestratorConfig;
  registry: unknown;
  scheduler: unknown;
  ledger: unknown;
  health: unknown;
  verifier: unknown;
  ctx: HostContract;
  agents: FakeAgent;
  /** host event `agent/inbox/claimed` → handleUserInput */
  handleUserInput: (agent: FakeAgent, message: unknown) => Promise<void>;
  /** host event `session/event` → onSessionEvent */
  onSessionEvent: (session: { id: string }, event: unknown) => Promise<void>;
  /** host event `agent/request` → onRequest */
  onRequest: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;
  /** host event `agent/request-error` → onRequestError */
  onRequestError: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;
  /** host event `agent/turn-stopping` → onTurnStopping */
  onTurnStopping: (payload: { agent: FakeAgent; turn: number; signal: AbortSignal }) => Promise<void>;
  /** host event `subagent/start` → child tracking */
  onSubagentStart: (info: unknown) => void;
  /** every `ctx.on` registration, keyed by host event name */
  commands: Record<string, { name: string; description?: string; input?: { hint?: string }; handler?: (a: { agent: FakeAgent; rawInput: string }) => unknown }>;
  spawnCalls: Array<{ label: string; agentOptions: { provider?: string; model: string }; prompt: string }>;
  home: string;
}

let lastHome: string | null = null;

export function buildHarness(opts: HarnessOpts = {}): Harness {
  const home = mkdtempSync(join(tmpdir(), 'dsh-per-eng-'));
  lastHome = home;
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;

  const cfg = opts.config ?? baseConfig();
  const agent = opts.agents ?? makeAgent();

  const deps: Partial<EngineDeps> = { ...opts.deps };
  if (!deps.fsOps) deps.fsOps = { mkdirRecursive: () => {}, readTextIfExists: () => null, writeText: () => {} };
  if (!deps.clock) deps.clock = () => Date.now();
  if (!deps.spawner) deps.spawner = { run: async () => ({ ranAt: 0 }) };

  let spawnSeq = 0;
  const spawnCalls: Harness['spawnCalls'] = [];
  const mkRun = (): FakeSubagentRun => ({
    id: `run-${spawnSeq}`,
    result: Promise.resolve({ stopReason: 'completed', structured: verdict({ pass: true }) }),
    disposed: 0,
    dispose: () => undefined,
  });
  const subagentRuntime = {
    start: (_mode: 'spawn', request: Record<string, unknown>): FakeSubagentRun => {
      spawnCalls.push({ label: String(request.label ?? ''), agentOptions: request.agentOptions as Harness['spawnCalls'][number]['agentOptions'], prompt: (request.prompt as Array<{ text: string }>)?.[0]?.text ?? '' });
      const spec = opts.subagents?.[Math.min(spawnSeq, (opts.subagents?.length ?? 1) - 1)];
      const run = spec ? spec(request, spawnSeq) : mkRun();
      const r = run as FakeSubagentRun & { __orig?: () => unknown };
      spawnSeq += 1;
      const dispose = r.dispose ?? (r.__orig ?? (() => undefined));
      if (r.dispose !== dispose) r.dispose = () => { r.disposed += 1; void dispose(); };
      return r;
    },
  };
  if (deps.subagents === undefined) deps.subagents = subagentRuntime;

  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const commands: Harness['commands'] = {};
  const ctx: HostContract = {
    on(name, listener) {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => undefined;
    },
    get(name) {
      if (name === 'subagents') return subagentRuntime;
      if (name === 'commands') {
        return {
          // registerCommands() runs inside createEngine, so the target must not
          // reference the harness object that has not been assigned yet (TDZ)
          register(def) {
            commands[def.name] = def as Harness['commands'][string];
            return undefined;
          },
        };
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'default' }) };
      return undefined;
    },
    logger: { info() {}, warn() {}, error() {} },
  };

  const hnd = createEngine(ctx, cfg, deps) as Harness;
  hnd.commands = commands;
  hnd.ctx = ctx;
  hnd.agents = agent;
  hnd.spawnCalls = spawnCalls;
  hnd.home = home;
  // The FSM serializes every transition onto a per-task queue (P0-04) and the
  // launch / review / audit hooks are async, so a host listener can resolve
  // long before its effects (state, notices, steering) are observable. Drain
  // the microtask queue after each call so assertions are deterministic rather
  // than flaky on scheduling. Return values are preserved — the request hooks
  // answer the host's middleware chain (retry / error kinds).
  const drain = async (result: unknown): Promise<unknown> => {
    if (result instanceof Promise) await result;
    await flush();
    return result;
  };
  hnd.handleUserInput = async (a, m) =>
    await drain((listeners.get('agent/inbox/claimed')?.[0] as unknown as (p: { agent: FakeAgent; message: unknown }) => unknown)?.({ agent: a, message: m }));
  hnd.onSessionEvent = async (session, event) =>
    await drain((listeners.get('session/event')?.[0] as unknown as (s: { id: string }, e: unknown) => unknown)?.(session, event));
  hnd.onRequest = (payload, next) => Promise.resolve(drain((listeners.get('agent/request')?.[0] as unknown as (p: unknown, n: () => Promise<unknown>) => unknown)?.(payload, next)));
  hnd.onRequestError = (payload, next) => Promise.resolve(drain((listeners.get('agent/request-error')?.[0] as unknown as (p: unknown, n: () => Promise<unknown>) => unknown)?.(payload, next)));
  hnd.onTurnStopping = (payload) => Promise.resolve(drain((listeners.get('agent/turn-stopping')?.[0] as unknown as (p: unknown) => unknown)?.(payload)));
  hnd.onSubagentStart = (info) => void (listeners.get('subagent/start')?.[0] as unknown as (i: unknown) => unknown)?.(info);

  if (previous === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previous;
  return hnd;
}

/** One event-loop turn — enough for recover()'s fire-and-forget promise chain. */
export const flush = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

/** Drive a fresh task from IDLE to EXECUTING (plan fence accepted); returns the task. */
export async function driveToExecuting(h: Harness, text = '重构认证模块', planOver: Record<string, unknown> = {}): Promise<HarnessTask> {
  await h.handleUserInput(h.agents, { source: { kind: 'user' }, content: [{ type: 'text', text }] });
  await h.onSessionEvent({ id: h.agents.id }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: planFence(planOver) }] } } });
  return tasksOf(h)[0]!;
}

afterEach(() => {
  if (lastHome) {
    try {
      // best-effort cleanup of the per-test DSH_HOME
      rmSync(lastHome, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup is best effort */
    }
    lastHome = null;
  }
  delete process.env.DSH_HOME;
});
