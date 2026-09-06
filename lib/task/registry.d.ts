import type { OrchestratorTask } from './fsm.js';
/**
 * Task registry — change-set A8: explicit sessionId→taskId mapping replaces
 * the (invalid) `task:` prefix filtering; plus the serial scheduler (ADR #19,
 * interface shaped for parallel later).
 */
export declare class TaskRegistry {
    private byId;
    /** A8 mapping: root session id → active task */
    private activeBySession;
    /** child (subagent) session ids tracked for filtering */
    private childSessions;
    attach(task: OrchestratorTask): void;
    get(id: string): OrchestratorTask | undefined;
    /** Active task for a root session, if any. */
    activeForSession(sessionId: string): OrchestratorTask | undefined;
    /** Terminal cleanup: drop the active mapping when a task settles. */
    settle(task: OrchestratorTask): void;
    /** A8: child-session bookkeeping for event filtering. */
    trackChild(sessionId: string): void;
    isChild(sessionId: string): boolean;
    /** Drop child bookkeeping once its parent task settles (bounded memory). */
    untrackChild(sessionId: string): void;
    /** Prune terminal tasks retained past the retention window; files stay on disk. */
    prune(retentionMs?: number, now?: () => number): void;
    all(): OrchestratorTask[];
}
/** Serial scheduler (ADR #19): one running task, the rest queued in order. */
export declare class TaskScheduler {
    private queue;
    private running;
    get queuedBehind(): number;
    positionOf(task: OrchestratorTask): number;
    /** Offer a task to the scheduler; returns true when it may run now. */
    admit(task: OrchestratorTask): boolean;
    /** Notify completion; returns the next task to run, if any. */
    finished(task: OrchestratorTask): OrchestratorTask | undefined;
}
//# sourceMappingURL=registry.d.ts.map