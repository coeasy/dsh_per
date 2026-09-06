import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTerminal } from '../types.js';
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
export class SnapshotStore {
    dir;
    pending = new Map();
    scheduled = false;
    constructor(dir) {
        this.dir = dir;
        mkdirSync(this.dir, { recursive: true });
    }
    file(id) {
        return join(this.dir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    }
    save(snapshot) {
        if (isTerminal(snapshot.state) || snapshot.abandoned) {
            this.pending.delete(snapshot.id); // a queued intermediate write is stale now
            this.writeSync(snapshot);
            return;
        }
        this.pending.set(snapshot.id, snapshot);
        if (!this.scheduled) {
            this.scheduled = true;
            setImmediate(() => {
                this.scheduled = false;
                this.flushAll();
            });
        }
    }
    /** Synchronously write every pending intermediate snapshot (no-op when clean). */
    flushAll() {
        const drain = [...this.pending.values()];
        this.pending.clear();
        for (const snap of drain)
            this.writeSync(snap);
    }
    writeSync(snapshot) {
        const target = this.file(snapshot.id);
        const tmp = `${target}.tmp`;
        try {
            writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
            renameSync(tmp, target); // write-temp-then-rename: crash-safe swap
        }
        catch {
            // best-effort durability
        }
    }
    load(id) {
        try {
            const p = this.file(id);
            if (!existsSync(p))
                return undefined;
            return JSON.parse(readFileSync(p, 'utf8'));
        }
        catch {
            return undefined;
        }
    }
    /** Non-terminal, non-abandoned snapshots for recovery. */
    recoverable() {
        const out = [];
        try {
            for (const f of existingJson(this.dir)) {
                try {
                    const s = JSON.parse(readFileSync(f, 'utf8'));
                    if (!['DONE', 'DONE_FLAGGED', 'ABORTED'].includes(s.state) && !s.abandoned)
                        out.push(s);
                }
                catch {
                    /* skip damaged */
                }
            }
        }
        catch {
            /* no dir */
        }
        return out;
    }
}
function existingJson(dir) {
    try {
        return readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => join(dir, f));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=snapshot.js.map