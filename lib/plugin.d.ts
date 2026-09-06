import type { HostContract } from './host-contract.js';
/**
 * Plugin entry — plain Cordis plugin (loader unwraps `default`). apply-style
 * avoids cross-instance Service class identity issues when installed into a
 * profile's node_modules.
 */
declare const _default: {
    name: string;
    apply(this: unknown, ctx: HostContract, config: unknown): void;
};
export default _default;
//# sourceMappingURL=plugin.d.ts.map