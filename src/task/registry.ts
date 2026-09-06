import { isTerminal } from '../types.js';
import type { OrchestratorTask } from './fsm.js';

/**
 * Task registry — change-set A8: explicit sessionId→taskId mapping replaces
 * the (invalid) `task:` prefix filtering; plus the serial scheduler (ADR #19,
 * interface shaped for parallel later).
 */
export class TaskRegistry {
  private byId = new Map<string, OrchestratorTask>();
  /** A8 mapping: root session id → active task */
  private activeBySession = new Map<string, string>();
  /** child (subagent) session ids tracked for filtering */
  private childSessions = new Set<string>();

  attach(task: OrchestratorTask): void {
    this.byId.set(task.id, task);
    if (!isTerminal(task.state) && !task.snapshot.abandoned) {
      this.activeBySession.set(task.snapshot.sessionId, task.id);
    }
  }

  get(id: string): OrchestratorTask | undefined {
    return this.byId.get(id);
  }

  /** Active task for a root session, if any. */
  activeForSession(sessionId: string): OrchestratorTask | undefined {
    const id = this.activeBySession.get(sessionId);
    return id ? this.byId.get(id) : undefined;
  }

  /** Terminal cleanup: drop the active mapping when a task settles. */
  settle(task: OrchestratorTask): void {
    const current = this.activeBySession.get(task.snapshot.sessionId);
    if (current === task.id) this.activeBySession.delete(task.snapshot.sessionId);
  }

  /** A8: child-session bookkeeping for event filtering. */
  trackChild(sessionId: string): void {
    this.childSessions.add(sessionId);
  }

  isChild(sessionId: string): boolean {
    return this.childSessions.has(sessionId);
  }

  /** Drop child bookkeeping once its parent task settles (bounded memory). */
  untrackChild(sessionId: string): void {
    this.childSessions.delete(sessionId);
  }

  /** Prune terminal tasks retained past the retention window; files stay on disk. */
  prune(retentionMs = 24 * 3600_000, now: () => number = Date.now): void {
    const t0 = now();
    for (const [id, t] of this.byId) {
      if (isTerminal(t.state) && t0 - t.snapshot.updatedAt > retentionMs) this.byId.delete(id);
    }
  }

  all(): OrchestratorTask[] {
    return [...this.byId.values()];
  }
}

/** Serial scheduler (ADR #19): one running task, the rest queued in order. */
export class TaskScheduler {
  private queue: OrchestratorTask[] = [];
  private running: OrchestratorTask | null = null;

  get queuedBehind(): number {
    return this.queue.length;
  }

  positionOf(task: OrchestratorTask): number {
    if (this.running === task) return 0;
    const idx = this.queue.indexOf(task);
    return idx === -1 ? -1 : idx + 1;
  }

  /** Offer a task to the scheduler; returns true when it may run now. */
  admit(task: OrchestratorTask): boolean {
    if (this.running === null) {
      this.running = task;
      return true;
    }
    this.queue.push(task);
    return false;
  }

  /** Notify completion; returns the next task to run, if any. */
  finished(task: OrchestratorTask): OrchestratorTask | undefined {
    if (this.running === task) {
      this.running = this.queue.shift() ?? null;
      return this.running ?? undefined;
    }
    const idx = this.queue.indexOf(task);
    if (idx !== -1) this.queue.splice(idx, 1);
    return undefined;
  }
}
