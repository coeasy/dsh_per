/** Flatten a message `content` array (or a plain string) to text. */
export declare function textOfContent(content: unknown): string;
/** Count added/removed lines in a unified diff. */
export declare function countDiffLines(diff: string): number;
/** Diff-line count from a tool-result `meta` bag (`diffLines` | `diff` | `appliedDiff`). */
export declare function diffLinesFromMeta(meta: unknown): number;
/** Read a text file if present; never throws (saved-overrides loader seam). */
export declare function readIfExists(file: string): string | null;
//# sourceMappingURL=util.d.ts.map