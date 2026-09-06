import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Eval the built bundle with a fake module loader; returns what the factory registers. */
function loadBundle(requireShim) {
  const code = readFileSync(join(root, 'web', 'dist', 'client.js'), 'utf8');
  let loaded: { apply: unknown; inject: unknown } | undefined;
  const fakeWindow = {
    __ModuleLoader__: {
      load: (def) => {
        expect(def.id).toBe('dsh-per');
        expect(typeof def.factory).toBe('function');
        loaded = def.factory(requireShim);
        return loaded;
      },
    },
  };
  const fn = new Function('window', code);
  fn(fakeWindow);
  return { mod: loaded!, registrations: [], slotInjects: [] };
}

const reactStub = {
  createElement: (...args) => ({ $$el: args[0], props: args[1] }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
};

function makeCtx() {
  const registered = [];
  const slotInjectCalls = [];
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  };
  const ctx = {
    get: (name) => (name === 'connection' ? { api: { settings: { mutate: async () => ({ result: { ok: true, value: { revision: 2 } } }) } } } : undefined),
    settingsScope: { bind: ({ namespace }) => (expect(namespace).toBe('dsh-per'), scope) },
    slots: {
      inject: (slot, gen) => {
        slotInjectCalls.push(slot);
        for (const _ of gen()) { /* drain */ }
      },
      register: (opts, component) => {
        registered.push({ opts, component });
        return { dispose: () => {} };
      },
    },
  };
  return { ctx, registered, slotInjectCalls };
}

describe('web bundle (lazy CJS loader format)', () => {
  it('loads under a fake __ModuleLoader__ and exports apply/inject', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    expect(typeof mod.apply).toBe('function');
    expect(Array.isArray(mod.inject)).toBe(true);
    expect(mod.inject).toContain('settingsScope');
    expect(mod.inject).toContain('slots');
    expect(mod.inject).toContain('connection');
  });

  it('apply registers one card into settings.plugin.item keyed by the namespace', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const { ctx, registered, slotInjectCalls } = makeCtx();
    mod.apply(ctx);
    expect(slotInjectCalls).toEqual(['settings.plugin.item']);
    expect(registered).toHaveLength(1);
    expect(registered[0].opts.name).toBe('settings.plugin.item');
    expect(registered[0].opts.key).toBe('dsh-per');
    expect(typeof registered[0].opts.inject).toBe('function');
    expect(typeof registered[0].component).toBe('function');
    const face = registered[0].opts.inject();
    expect(Object.keys(face.hooks).sort()).toEqual(['orchestratorApi', 'orchestratorCard']);
    expect(typeof face.hooks.orchestratorCard.getSnapshot).toBe('function');
    expect(typeof face.hooks.orchestratorCard.subscribe).toBe('function');
  });

  it('card render returns null while the namespace is unavailable', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const { ctx, registered } = makeCtx();
    mod.apply(ctx);
    const Card = registered[0].component;
    const face = registered[0].opts.inject();
    // simulate a non-ready snapshot: the component reads via the hook prop
    const useOrchestratorCard = (sel) => sel({ status: 'unavailable' });
    const useOrchestratorApi = (sel) => sel({});
    const out = Card({ useOrchestratorCard, useOrchestratorApi });
    expect(out).toBeNull();
    void face;
  });

  it('S1: makeDraft on an inert snapshot yields three editable stage rows (card never crashes, resurrection path reachable)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const draft = mod.makeDraft({ mode: 'auto' }); // no stages: inert install
    expect(draft.stages.plan).not.toBeNull();
    expect(draft.stages.execute).not.toBeNull();
    expect(draft.stages.review).not.toBeNull();
    expect(draft.stages.plan.model).toBe('');
    // a complete trio in the draft produces one set op per row (resurrection)
    draft.stages.plan.model = 'a/p';
    draft.stages.execute.model = 'a/e';
    draft.stages.review.model = 'a/r';
    const ops = mod.buildStageOps(draft, {}, {});
    expect(ops.filter((o) => o.path[0] === 'stages' && o.path[1] === 'plan').length).toBe(1);
    expect(ops.find((o) => o.path[1] === 'plan')?.value?.model).toBe('a/p');
  });

  it('buildStageOps: row equal to base is dropped (true inherit, no equal-value override)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = {
      stages: { plan: { model: 'base/plan', provider: 'wps', reasoning_effort: 'high', on_failure: 'hard_fail' } },
    };
    const draft = {
      stages: {
        plan: { model: 'base/plan', provider: 'wps', reasoning_effort: 'high', on_failure: 'hard_fail' },
        execute: null,
        review: null,
        plan_audit: [],
      },
    };
    const user = { stages: { plan: { model: 'user/plan' } } }; // pre-existing override
    const ops = mod.buildStageOps(draft, base, user);
    expect(ops).toEqual([{ op: 'unset', path: ['stages', 'plan'] }]); // revert to inherit
  });

  it('buildStageOps: touched row writes a set with ONLY the changed leaves (cleared/same-as-base omitted for true inherit)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = {
      stages: { plan: { model: 'base/plan', provider: 'wps', reasoning_effort: 'high', on_failure: 'hard_fail' } },
    };
    // user edited provider only; effort/on_failure stay at base values → omitted from entry
    const draft = {
      stages: {
        plan: { model: 'base/plan', provider: 'other', reasoning_effort: 'high', on_failure: 'hard_fail' },
        execute: null,
        review: null,
        plan_audit: [],
      },
    };
    const ops = mod.buildStageOps(draft, base, {});
    expect(ops).toEqual([
      { op: 'set', path: ['stages', 'plan'], value: { model: 'base/plan', provider: 'other' } },
    ]);
  });

  it('buildStageOps: empty row (cleared model) drops the user entry', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = { stages: { plan: { model: 'base/plan' } } };
    const draft = { stages: { plan: { model: '', provider: '', reasoning_effort: '', on_failure: '' }, execute: null, review: null, plan_audit: [] } };
    const ops = mod.buildStageOps(draft, base, { stages: { plan: { model: 'user/plan' } } });
    expect(ops).toEqual([{ op: 'unset', path: ['stages', 'plan'] }]);
  });

  it('buildStageOps: plan_audit write preserves base effort/on_failure (no silent degrade)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = {
      stages: { plan_audit: [{ model: 'aud/a', provider: 'wps', reasoning_effort: 'high', on_failure: 'auto_degrade', fallback_chain: [] }] },
    };
    // user only edits the auditor model
    const draft = { stages: { plan: null, execute: null, review: null, plan_audit: [{ model: 'aud/a2', provider: '', reasoning_effort: '', on_failure: '' }] } };
    const ops = mod.buildStageOps(draft, base, {});
    expect(ops).toEqual([
      { op: 'set', path: ['stages', 'plan_audit'], value: [{ model: 'aud/a2', provider: 'wps', reasoning_effort: 'high', on_failure: 'auto_degrade', fallback_chain: [] }] },
    ]);
  });

  it('buildStageOps: identical audit list vs base → unset (inherit)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = { stages: { plan_audit: [{ model: 'aud/a', reasoning_effort: 'high', on_failure: 'auto_degrade', fallback_chain: [] }] } };
    const draft = { stages: { plan: null, execute: null, review: null, plan_audit: [{ model: 'aud/a', reasoning_effort: 'high', on_failure: 'auto_degrade' }] } };
    const ops = mod.buildStageOps(draft, base, { stages: { plan_audit: [{ model: 'aud/a', reasoning_effort: 'high' }] } });
    expect(ops).toEqual([{ op: 'unset', path: ['stages', 'plan_audit'] }]);
  });

  it('buildStageOps: clearing effort to base value omits it from entry (true inherit, not equal-value override)', () => {
    const { mod } = loadBundle((name) => (name === 'react' ? reactStub : undefined));
    const base = { stages: { plan: { model: 'm', reasoning_effort: 'high', on_failure: 'hard_fail' } } };
    // user changed effort to 'low', now reverted to 'high' (same as base) + changed provider
    const draft = { stages: { plan: { model: 'm', provider: 'other', reasoning_effort: 'high', on_failure: 'hard_fail' }, execute: null, review: null, plan_audit: [] } };
    const ops = mod.buildStageOps(draft, base, {});
    // effort and on_failure omitted (same as base) → seam inherits; only model + changed provider in entry
    expect(ops).toEqual([{ op: 'set', path: ['stages', 'plan'], value: { model: 'm', provider: 'other' } }]);
  });
});
