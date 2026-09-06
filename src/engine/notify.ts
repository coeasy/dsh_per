/**
 * User-visible messaging (notice / directive) — extracted from the core so the
 * quiet-mode filter lives in one place (docs/重构方案-v3.md §2-D).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { OrchestratorConfig } from '../config/schema.js';
import type { AgentHandle } from '../host-contract.js';

export interface NotifyDeps {
  cfg: () => OrchestratorConfig;
  agents: Map<string, AgentHandle>;
  noticedOnce: Map<string, Set<string>>;
}

/** Terminal/abort milestones that must survive `visibility.progress: 'quiet'`. */
export function isTerminalNotice(text: string): boolean {
  return text.startsWith('⚠️【编排】') || text.includes('任务完成 ✓');
}

export function createNotify(deps: NotifyDeps) {
  const { cfg, agents, noticedOnce } = deps;

  const notice = (sessionId: string, text: string) => {
    // C6: `visibility.progress: 'quiet'` keeps in-flight milestones out of the
    // conversation and only lets terminal outcomes and warnings through. The
    // milestone templates are stable strings, so the filter keys off their
    // markers rather than threading a message kind through every call site.
    if (cfg().visibility.progress === 'quiet' && !isTerminalNotice(text)) return;
    const agent = agents.get(sessionId);
    const msg = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'per', form: 'notice', summary: text.slice(0, 120) },
    });
    if (agent) agent.inject(msg);
  };

  /** notice dedup: inject a keyed notice at most once per session turn-cycle */
  const noticeOnce = (sessionId: string, key: string, text: string) => {
    let seen = noticedOnce.get(sessionId);
    if (!seen) {
      seen = new Set();
      noticedOnce.set(sessionId, seen);
    }
    if (seen.has(key)) return;
    seen.add(key);
    notice(sessionId, text);
  };

  const directive = (sessionId: string, text: string) => {
    const agent = agents.get(sessionId);
    const msg = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'per', form: 'instructions' },
    });
    if (agent) agent.steer(msg);
  };

  return { notice, noticeOnce, directive };
}
