import type { TaskSnapshot } from '../types.js';
/** Clip long free text for push messages; Chinese-safe (no word boundaries). */
export declare function truncate(text: string, max: number): string;
/** Milestone push messages (v5.0 §10 + ADR #14). Templates are constants for snapshot tests. */
export declare const MILESTONES: {
    readonly planComplete: (steps: number, complexity: string, model: string) => string;
    readonly executing: (model: string, steps: number, queueNote?: string) => string;
    readonly reviewing: (model: string) => string;
    readonly reviewResult: (pass: boolean, blockers: number, majors: number, minors: number) => string;
    readonly fixRound: (round: number, max: number, count: number, escalated: number) => string;
    readonly done: (summary: string, cost: string) => string;
    readonly doneFlagged: (fixRounds: number, unresolved: number, summary: string, cost: string) => string;
    readonly aborted: (reason: string, spent: string) => string;
    readonly queued: (position: number) => string;
    /** Queue head picked up after the previous task settled — no plan exists yet,
     *  so no step count may appear here (that belongs to `executing`). */
    readonly launching: (goal: string, queueNote?: string) => string;
    readonly launchRejected: (reason: string) => string;
    readonly replanning: (feedback: string) => string;
    readonly planAuditing: (models: string) => string;
    readonly planAuditPassed: (models: string) => string;
    readonly planAuditFailed: (blocked: number, rejected: number, round: number, max: number) => string;
    readonly planAuditSkipped: () => string;
};
export declare function renderPlanSummary(snapshot: TaskSnapshot): string;
export declare function renderCost(snapshot: TaskSnapshot, dailySpent: number, dailyLimit: number): string;
/** v5.2: factual audit trailing note for final reports ('' when audit never ran). */
export declare function renderAuditNote(snapshot: TaskSnapshot): string;
//# sourceMappingURL=milestones.d.ts.map