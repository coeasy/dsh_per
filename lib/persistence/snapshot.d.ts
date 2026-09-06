import type { TaskSnapshot } from '../types.js';
/**
 * Task snapshot persistence (v5.0 §9.4, change-set V7): JSON files under the
 * plugin data dir; write-temp-then-rename for crash safety. Recovery scans
 * non-terminal, non-abandoned snapshots.
 *
 * Durability contract (P1-13): terminal and abandoned snapshots are written
 * synchronously — the recovery policy and the /orch UX both read them right
 * after settlement. Intermediate states coalesce: `save()` only marks the
 * snapshot dirty and schedules one `setImmediate` flush per tick, so a turn
 * with several transitions costs a single write. `flushAll()` drains the
 * pending set (engine dispose + `process.once('exit')` backstop).
 */
export declare class SnapshotStore {
    private dir;
    private pending;
    private scheduled;
    constructor(dir: string);
    private file;
    save(snapshot: TaskSnapshot): void;
    /** Synchronously write every pending intermediate snapshot (no-op when clean). */
    flushAll(): void;
    private writeSync;
    load(id: string): TaskSnapshot | undefined;
    /** Non-terminal, non-abandoned snapshots for recovery. */
    recoverable(): TaskSnapshot[];
}
//# sourceMappingURL=snapshot.d.ts.map