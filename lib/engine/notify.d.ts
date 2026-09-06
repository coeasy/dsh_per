import type { OrchestratorConfig } from '../config/schema.js';
import type { AgentHandle } from '../host-contract.js';
export interface NotifyDeps {
    cfg: () => OrchestratorConfig;
    agents: Map<string, AgentHandle>;
    noticedOnce: Map<string, Set<string>>;
}
/** Terminal/abort milestones that must survive `visibility.progress: 'quiet'`. */
export declare function isTerminalNotice(text: string): boolean;
export declare function createNotify(deps: NotifyDeps): {
    notice: (sessionId: string, text: string) => void;
    noticeOnce: (sessionId: string, key: string, text: string) => void;
    directive: (sessionId: string, text: string) => void;
};
//# sourceMappingURL=notify.d.ts.map