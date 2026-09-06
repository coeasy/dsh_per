/**
 * Boot-time recovery (v1 policy: every non-terminal, non-abandoned snapshot is
 * aborted and persisted, so a ghost task cannot occupy the serial scheduler).
 *
 * v3: the aborts are awaited and failures are logged — the previous
 * fire-and-forget `.then(...).catch(() => undefined)` could leave a snapshot
 * non-abandoned on disk if the process exited mid-flight, making every later
 * boot re-abort it.
 */
import { OrchestratorTask, type TaskHooks } from '../task/fsm.js';
import type { EngineCtx } from './ctx.js';

export async function recover(engine: EngineCtx, hooks: TaskHooks): Promise<void> {
  const { snapshots, registry, cfg, logger } = engine;
  const pending: Promise<void>[] = [];
  for (const snap of snapshots.recoverable()) {
    const task = new OrchestratorTask({
      now: engine.clock,
      id: snap.id,
      sessionId: snap.sessionId,
      goal: snap.goal,
      hooks,
      limits: {
        plan_retry_max: cfg().limits.plan_retry_max,
        exec_retry_max: cfg().limits.exec_retry_max,
        replan_cycle_max: cfg().limits.replan_cycle_max,
        fix_loop_max: cfg().fix_loop.max_cycles,
      },
    });
    // v5.2 backward compatibility: snapshots written before the plan-audit
    // extension lack planAudit/auditSkipped — normalize so the gate can never
    // push into undefined (crash) or increment NaN
    task.snapshot = { ...snap, planAudit: snap.planAudit ?? [], auditSkipped: snap.auditSkipped ?? 0 };
    registry.attach(task);
    task.snapshot.abandoned = true;
    pending.push(
      task
        .forceAbort('stale_snapshot')
        .then(() => {
          snapshots.save(task.snapshot);
          registry.settle(task);
        })
        .catch((error) => {
          logger.warn('orchestrator: stale snapshot abort failed for %s: %o', snap.id, error);
        }),
    );
  }
  await Promise.all(pending);
}
