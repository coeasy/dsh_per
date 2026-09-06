/**
 * Small pure helpers shared by the engine core and its modules.
 *
 * No host access, no mutable state — safe to unit test directly. Kept apart
 * from the core so that the review/audit/accounting modules can import the
 * same text and diff parsing without reaching back into engine.ts.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Flatten a message `content` array (or a plain string) to text. */
export function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n');
}

/** Count added/removed lines in a unified diff. */
export function countDiffLines(diff: string): number {
  let n = 0;
  for (const line of diff.split('\n')) {
    if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) n++;
  }
  return n;
}

/** Diff-line count from a tool-result `meta` bag (`diffLines` | `diff` | `appliedDiff`). */
export function diffLinesFromMeta(meta: unknown): number {
  if (!meta || typeof meta !== 'object') return 0;
  const m = meta as Record<string, unknown>;
  if (typeof m.diffLines === 'number') return m.diffLines;
  if (typeof m.diff === 'string') return countDiffLines(m.diff);
  if (typeof m.appliedDiff === 'string') return countDiffLines(m.appliedDiff);
  return 0;
}

/** Read a text file if present; never throws (saved-overrides loader seam). */
export function readIfExists(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}
