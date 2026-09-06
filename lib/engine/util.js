/**
 * Small pure helpers shared by the engine core and its modules.
 *
 * No host access, no mutable state — safe to unit test directly. Kept apart
 * from the core so that the review/audit/accounting modules can import the
 * same text and diff parsing without reaching back into engine.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
/** Flatten a message `content` array (or a plain string) to text. */
export function textOfContent(content) {
    if (!Array.isArray(content))
        return typeof content === 'string' ? content : '';
    return content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
}
/** Count added/removed lines in a unified diff. */
export function countDiffLines(diff) {
    let n = 0;
    for (const line of diff.split('\n')) {
        if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')))
            n++;
    }
    return n;
}
/** Diff-line count from a tool-result `meta` bag (`diffLines` | `diff` | `appliedDiff`). */
export function diffLinesFromMeta(meta) {
    if (!meta || typeof meta !== 'object')
        return 0;
    const m = meta;
    if (typeof m.diffLines === 'number')
        return m.diffLines;
    if (typeof m.diff === 'string')
        return countDiffLines(m.diff);
    if (typeof m.appliedDiff === 'string')
        return countDiffLines(m.appliedDiff);
    return 0;
}
/** Read a text file if present; never throws (saved-overrides loader seam). */
export function readIfExists(file) {
    try {
        return existsSync(file) ? readFileSync(file, 'utf8') : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=util.js.map