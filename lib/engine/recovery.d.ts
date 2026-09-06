/**
 * Boot-time recovery (v1 policy: every non-terminal, non-abandoned snapshot is
 * aborted and persisted, so a ghost task cannot occupy the serial scheduler).
 *
 * v3: the aborts are awaited and failures are logged — the previous
 * fire-and-forget `.then(...).catch(() => undefined)` could leave a snapshot
 * non-abandoned on disk if the process exited mid-flight, making every later
 * boot re-abort it.
 */
import { type TaskHooks } from '../task/fsm.js';
import type { EngineCtx } from './ctx.js';
export declare function recover(engine: EngineCtx, hooks: TaskHooks): Promise<void>;
//# sourceMappingURL=recovery.d.ts.map