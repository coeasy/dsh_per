import type { HostContract } from './host-contract.js';
import { createEngine } from './engine.js';

/**
 * Plugin entry — plain Cordis plugin (loader unwraps `default`). apply-style
 * avoids cross-instance Service class identity issues when installed into a
 * profile's node_modules.
 */
export default {
  name: 'per',
  apply(this: unknown, ctx: HostContract, config: unknown) {
    const engine = createEngine(ctx, config);
    ctx.logger.info('orchestrator: plugin active (mode=%s)', (engine.config as { mode?: string }).mode);
    // return nothing: cordis treats a returned function as a dispose callback
  },
};
