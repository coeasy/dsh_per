/**
 * Host contract + dependency seams (P0-01, phase A1).
 *
 * Before this file `createEngine(ctx: AnyCtx, rawConfig)` accepted an all-`any`
 * host object and hard-wired every seam — the filesystem, the wall clock,
 * subagent dispatch and the mechanical verifier were all inlined in one 1500-line
 * closure, so the engine could only be exercised end-to-end against a live host.
 *
 * This file declares two things and nothing else:
 *
 *   1. the host API the engine actually reads (5 members, 2 optional), and
 *   2. the four replaceable seams (`fsOps`, `clock`, `subagents`, `spawner`)
 *      a unit test doubles without editing engine code.
 *
 * Declarations only — importing this module has no runtime effect.
 */
export {};
//# sourceMappingURL=host-contract.js.map