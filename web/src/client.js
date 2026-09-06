// dsh-per web client — lazy CJS factory body (wrapped by scripts/build-web.mjs).
// Registers the plugin's settings card into the `settings.plugin.item` slot,
// keyed by the settings namespace `dsh-per` (D8). The card owns its
// chrome, stages drafts locally, and writes through the client settings scope /
// raw settings.mutate ops with namespace-revision fencing.
const React = require('react');
const h = React.createElement;

const NAMESPACE = 'dsh-per';
const STAGE_KEYS = ['plan', 'execute', 'review'];
const EFFORTS = ['off', 'low', 'medium', 'high', 'max'];
const MODES = ['auto', 'passthrough', 'gated'];
const ON_FAILURE = ['hard_fail', 'auto_degrade'];
const STAGE_LABELS = { plan: '规划', execute: '执行', review: '复核' };

const css = [
  '.dsh-orch-card{display:flex;flex-direction:column;gap:10px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dsh-orch-head{display:flex;flex-direction:column;gap:2px}',
  '.dsh-orch-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:1.5}',
  '.dsh-orch-desc{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5}',
  '.dsh-orch-section{display:flex;flex-direction:column;gap:8px}',
  '.dsh-orch-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.dsh-orch-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
  '.dsh-orch-cell{display:flex;flex-direction:column;gap:3px;min-width:150px;flex:1}',
  '.dsh-orch-label{font-size:11px;color:var(--dsh-orch-muted,var(--dsw-alias-label-tertiary));display:flex;gap:6px;align-items:center}',
  '.dsh-orch-input,.dsh-orch-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:30px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:12px;min-width:0}',
  '.dsh-orch-input:focus-visible,.dsh-orch-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
  '.dsh-orch-input:disabled,.dsh-orch-select:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
  '.dsh-orch-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500}',
  '.dsh-orch-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.dsh-orch-btn{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 14px;cursor:pointer}',
  '.dsh-orch-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-orch-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-orch-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
  '.dsh-orch-link{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:none;border:none;padding:0;cursor:pointer}',
  '.dsh-orch-link:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  '.dsh-orch-note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin:0}',
  '.dsh-orch-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error);margin:0}',
].join('');
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-per/card"]') === null) {
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-per';
  tag.dataset.pluginCss = 'dsh-per/card';
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ── snapshot ↔ draft helpers ────────────────────────────────────────────────

const clean = (v) => (v === undefined || v === null || v === '' ? undefined : v);

function stageToDraft(s) {
  const row = s ?? {};
  return {
    model: (typeof row.model === 'string' ? row.model : '').trim(),
    provider: (typeof row.provider === 'string' ? row.provider : '').trim(),
    reasoning_effort: typeof row.reasoning_effort === 'string' ? row.reasoning_effort : '',
    on_failure: typeof row.on_failure === 'string' ? row.on_failure : '',
  };
}

function makeDraft(value) {
  const v = value ?? {};
  const st = v.stages ?? {};
  // ALWAYS render three editable stage rows: an inert install (patch without
  // stages) must be configurable through this card — the resurrection path in
  // applySettingsOverlay materializes a trio when all three carry models.
  return {
    mode: typeof v.mode === 'string' ? v.mode : 'auto',
    stages: {
      plan: st.plan ? stageToDraft(st.plan) : stageToDraft(null),
      execute: st.execute ? stageToDraft(st.execute) : stageToDraft(null),
      review: st.review ? stageToDraft(st.review) : stageToDraft(null),
      plan_audit: Array.isArray(st.plan_audit) ? st.plan_audit.map(stageToDraft) : [],
    },
    budget: {
      daily_limit_cny: v.budget?.daily_limit_cny ?? '',
      task_limit_cny: v.budget?.task_limit_cny ?? '',
    },
    mechanical_verification: { enabled: v.mechanical_verification?.enabled !== false },
  };
}

/** deep user-layer presence check: is this leaf explicitly overridden? */
function userHas(user, path) {
  let cur = user;
  for (const p of path) {
    if (cur === undefined || cur === null || typeof cur !== 'object') return false;
    cur = cur[p];
  }
  return cur !== undefined;
}

function draftEqualsBase(row, baseRow) {
  const b = baseRow ?? {};
  return (clean(row.model) ?? undefined) === (b.model ?? undefined)
    && (clean(row.provider) ?? undefined) === (b.provider ?? undefined)
    && (clean(row.reasoning_effort) ?? undefined) === (b.reasoning_effort ?? undefined)
    && (clean(row.on_failure) ?? undefined) === (b.on_failure ?? undefined);
}

function rowInvalid(row) {
  // a kept row needs a model; cleared optional fields are fine (inherit)
  const kept = clean((row.model ?? '').trim()) !== undefined || clean(row.provider) !== undefined
    || clean(row.reasoning_effort) !== undefined || clean(row.on_failure) !== undefined;
  if (!kept) return false; // whole row dropped
  if (clean((row.model ?? '').trim()) === undefined) return true; // partial row without model
  if (clean(row.reasoning_effort) !== undefined && !EFFORTS.includes(row.reasoning_effort)) return true;
  if (clean(row.on_failure) !== undefined && !ON_FAILURE.includes(row.on_failure)) return true;
  return false;
}

function auditToUser(row, baseRow) {
  const out = { model: row.model };
  // untouched optional fields carry the base row's value so a full-array
  // rewrite cannot silently degrade them to schema defaults; fallback_chain is
  // carried ALWAYS (zod fills [] on base entries) so the array comparison is
  // stable and a patch-configured auditor chain survives a card save
  const b = baseRow ?? {};
  if (clean(row.provider) !== undefined) out.provider = row.provider;
  else if (clean(b.provider) !== undefined) out.provider = b.provider;
  if (clean(row.reasoning_effort) !== undefined) out.reasoning_effort = row.reasoning_effort;
  else if (clean(b.reasoning_effort) !== undefined) out.reasoning_effort = b.reasoning_effort;
  if (clean(row.on_failure) !== undefined) out.on_failure = row.on_failure;
  else if (clean(b.on_failure) !== undefined) out.on_failure = b.on_failure;
  out.fallback_chain = Array.isArray(b.fallback_chain) ? [...b.fallback_chain] : [];
  return out;
}

/**
 * Build the stage ops for one save.
 *
 * Row semantics (true inherit, no equal-value overrides):
 *  - an EMPTY row (model cleared) or a row identical to its base row is
 *    dropped from the user layer (unset) — it re-inherits wholesale;
 *  - a row the user touched is written as ONE whole-row set containing ONLY
 *    model (required for schema) plus optional leaves that actually differ
 *    from the base — cleared or same-as-base leaves are omitted so the seam
 *    inherits them rather than pinning an equal-value override.
 */
function buildStageOps(draft, base, user) {
  const ops = [];
  const bSt = base?.stages ?? {};
  const uSt = user?.stages ?? {};
  const dropRow = (key) => {
    if (uSt[key] !== undefined) ops.push({ op: 'unset', path: ['stages', key] });
  };
  for (const key of STAGE_KEYS) {
    const row = draft.stages[key];
    if (!row) { dropRow(key); continue; }
    if (rowInvalid(row)) continue; // blocked earlier; skip defensively
    const b = bSt[key] ?? {};
    const trimmed = { ...row, model: (row.model ?? '').trim(), provider: (row.provider ?? '').trim() };
    if (clean(trimmed.model) === undefined || draftEqualsBase(trimmed, b)) { dropRow(key); continue; }
    // model is required whenever a stage entry exists in the user layer;
    // it may be an equal-value override (acceptable — the row is user-owned)
    const entry = { model: trimmed.model };
    for (const f of ['provider', 'reasoning_effort', 'on_failure']) {
      const dv = f === 'provider' ? clean(trimmed[f]) : clean(row[f]);
      const bv = clean(b[f]);
      // only include leaves the user explicitly set AND that differ from base;
      // cleared or same-as-base leaves are omitted → seam inherits
      if (dv !== undefined && dv !== bv) entry[f] = dv;
    }
    ops.push({ op: 'set', path: ['stages', key], value: entry });
  }
  // plan_audit: arrays replace wholesale at the seam — carry base values for
  // untouched fields so an untouched auditor keeps its effort/on_failure
  const audits = (draft.stages.plan_audit ?? [])
    .filter((r) => clean(r.model) !== undefined)
    .map((r, i) => auditToUser(r, bSt.plan_audit?.[i]));
  const bAudits = Array.isArray(bSt.plan_audit) ? bSt.plan_audit : [];
  const same = JSON.stringify(audits) === JSON.stringify(bAudits);
  if (same) { if (uSt.plan_audit !== undefined) ops.push({ op: 'unset', path: ['stages', 'plan_audit'] }); }
  else ops.push({ op: 'set', path: ['stages', 'plan_audit'], value: audits });
  return ops;
}

/** top-level scalar op for one save: set when off-base, unset when re-inheriting */
function scalarOp(draftValue, baseValue, userHasIt, path) {
  const dv = clean(draftValue);
  const bv = clean(baseValue);
  if (dv === undefined) return null;
  if (dv !== bv) return { op: 'set', path, value: dv };
  if (userHasIt) return { op: 'unset', path };
  return null;
}

function buildSaveOps(draft, snap) {
  const base = snap.base ?? {};
  const user = snap.user ?? {};
  const ops = [...buildStageOps(draft, base, user)];
  const modeOp = scalarOp(draft.mode, base.mode ?? 'auto', user.mode !== undefined, ['mode']);
  if (modeOp) ops.push(modeOp);
  const budget = base.budget ?? {};
  const ub = user.budget ?? {};
  for (const k of ['daily_limit_cny', 'task_limit_cny']) {
    const raw = String(draft.budget[k] ?? '').trim();
    const dv = raw === '' ? undefined : Number(raw);
    const bv = budget[k];
    if (dv === undefined) { if (ub[k] !== undefined) ops.push({ op: 'unset', path: ['budget', k] }); continue; }
    if (dv !== bv) ops.push({ op: 'set', path: ['budget', k], value: dv });
    else if (ub[k] !== undefined) ops.push({ op: 'unset', path: ['budget', k] });
  }
  const mech = base.mechanical_verification ?? {};
  const dv = draft.mechanical_verification.enabled;
  const bv = mech.enabled !== false;
  if (dv !== bv) ops.push({ op: 'set', path: ['mechanical_verification', 'enabled'], value: dv });
  else if (userHas(user, ['mechanical_verification', 'enabled'])) ops.push({ op: 'unset', path: ['mechanical_verification', 'enabled'] });
  return ops;
}

// ── UI primitives ───────────────────────────────────────────────────────────

function Field(props) {
  const { label, value, onChange, options, invalid, overridden, disabled, placeholder, type, allowEmpty } = props;
  const badge = overridden ? h('span', { className: 'dsh-orch-badge' }, '已覆盖') : null;
  const common = {
    className: options ? 'dsh-orch-select' : 'dsh-orch-input',
    value,
    disabled,
    onChange: (e) => onChange(e.target.value),
  };
  let control;
  if (options) {
    control = h('select', common, [
      ...(allowEmpty === false ? [] : [h('option', { value: '', key: '_' }, '（继承）')]),
      ...options.map((o) => h('option', { value: o, key: o }, o)),
    ]);
  } else {
    control = h('input', { ...common, type: type ?? 'text', placeholder: placeholder ?? '' });
  }
  return h('label', { className: 'dsh-orch-cell' },
    h('span', { className: 'dsh-orch-label' }, label, badge),
    control,
  );
}

function StageRow(props) {
  const { title, row, user, disabled, onChange, onReset } = props;
  const uRow = user?.stages?.[props.stageKey];
  const set = (f) => (v) => onChange({ ...row, [f]: v });
  return h('div', { className: 'dsh-orch-row' },
    h('div', { className: 'dsh-orch-cell', style: { flex: '0 0 56px', minWidth: 56 } },
      h('span', { className: 'dsh-orch-label' }, title, uRow !== undefined ? h('span', { className: 'dsh-orch-badge' }, '已覆盖') : null),
    ),
    h(Field, { label: '模型', value: row.model, onChange: set('model'), disabled, overridden: userHas(user, ['stages', props.stageKey, 'model']), placeholder: '留空=继承' }),
    h(Field, { label: 'provider', value: row.provider, onChange: set('provider'), disabled, overridden: userHas(user, ['stages', props.stageKey, 'provider']), placeholder: '留空=继承' }),
    h(Field, { label: '推理档位', value: row.reasoning_effort, onChange: set('reasoning_effort'), options: EFFORTS, disabled, overridden: userHas(user, ['stages', props.stageKey, 'reasoning_effort']) }),
    h(Field, { label: '失败策略', value: row.on_failure, onChange: set('on_failure'), options: ON_FAILURE, disabled, overridden: userHas(user, ['stages', props.stageKey, 'on_failure']) }),
    h('button', { className: 'dsh-orch-link', disabled, onClick: onReset, type: 'button' }, '重置为继承'),
  );
}

function AuditRow(props) {
  const { row, index, disabled, onChange, onRemove, user } = props;
  const uAudit = user?.stages?.plan_audit;
  const overridden = Array.isArray(uAudit) && uAudit[index] !== undefined;
  const set = (f) => (v) => onChange(index, { ...row, [f]: v });
  return h('div', { className: 'dsh-orch-row' },
    h('div', { className: 'dsh-orch-cell', style: { flex: '0 0 56px', minWidth: 56 } },
      h('span', { className: 'dsh-orch-label' }, `审计${index + 1}`, overridden ? h('span', { className: 'dsh-orch-badge' }, '已覆盖') : null),
    ),
    h(Field, { label: '模型', value: row.model, onChange: set('model'), disabled, overridden }),
    h(Field, { label: 'provider', value: row.provider, onChange: set('provider'), disabled, overridden }),
    h(Field, { label: '推理档位', value: row.reasoning_effort, onChange: set('reasoning_effort'), options: EFFORTS, disabled, overridden }),
    h(Field, { label: '失败策略', value: row.on_failure, onChange: set('on_failure'), options: ON_FAILURE, disabled, overridden }),
    h('button', { className: 'dsh-orch-link', disabled, onClick: onRemove, type: 'button' }, '删除'),
  );
}

// ── card component ──────────────────────────────────────────────────────────

function OrchestratorCard(props) {
  const snap = props.useOrchestratorCard((s) => s);
  const api = props.useOrchestratorApi((a) => a);
  const ready = snap.status === 'ready';
  const [draft, setDraft] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(null);
  const [basedOn, setBasedOn] = React.useState(-1);
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;

  React.useEffect(() => {
    if (!ready) return;
    if (basedOn !== snap.revision && (!dirtyRef.current || draft === null)) {
      setDraft(makeDraft(snap.value));
      setBasedOn(snap.revision);
      setFailed(null);
    }
  }, [ready, snap.revision, basedOn, draft]);

  if (!ready) return null;
  const d = draft ?? makeDraft(snap.value);
  const disabled = saving || !snap.writable;
  const user = snap.user ?? {};
  const base = snap.base ?? {};

  const edit = (fn) => {
    setDraft((cur) => fn(structuredClone(cur ?? makeDraft(snap.value))));
    setDirty(true);
    setFailed(null);
  };

  const invalid = STAGE_KEYS.some((k) => d.stages[k] && rowInvalid(d.stages[k]))
    || d.stages.plan_audit.some((r) => rowInvalid(r))
    || (d.budget.daily_limit_cny !== '' && (!Number.isInteger(Number(d.budget.daily_limit_cny)) || Number(d.budget.daily_limit_cny) <= 0))
    || (d.budget.task_limit_cny !== '' && (!Number.isInteger(Number(d.budget.task_limit_cny)) || Number(d.budget.task_limit_cny) <= 0));

  const save = async () => {
    if (invalid || disabled) return;
    const ops = buildSaveOps(d, snap);
    setSaving(true);
    setFailed(null);
    let resp;
    try {
      resp = await api.settings.mutate({
        ns: NAMESPACE,
        ops,
        ...(snap.revision === undefined ? {} : { expectedRevision: snap.revision }),
      });
    } catch (e) {
      // revision conflict: the namespace moved past the revision we read
      setFailed('conflict');
      setSaving(false);
      return;
    }
    if (resp?.result && resp.result.ok === false) {
      // host rejected the write (schema/validate failure) — drafts stay so the
      // user can correct them; distinct copy from a conflict
      setFailed('rejected');
      setSaving(false);
      return;
    }
    // authoritative reseed from the write response (M5): the mirror snapshot
    // may still be the pre-write value — never flash back to it
    const view = resp?.result?.value;
    if (view && typeof view.revision === 'number') {
      setDraft(makeDraft(view.value ?? d));
      setBasedOn(view.revision);
      setDirty(false);
    } else {
      setBasedOn(-1); // no view echoed: reseed from the next pushed snapshot
      setDirty(false);
    }
    setSaving(false);
  };

  const discard = () => {
    setDraft(makeDraft(snap.value));
    setDirty(false);
    setFailed(null);
  };

  const resetSection = async () => {
    if (disabled) return;
    const ops = [];
    if (user.stages !== undefined) ops.push({ op: 'unset', path: ['stages'] });
    if (user.mode !== undefined) ops.push({ op: 'unset', path: ['mode'] });
    if (user.budget !== undefined) ops.push({ op: 'unset', path: ['budget'] });
    if (user.mechanical_verification !== undefined) ops.push({ op: 'unset', path: ['mechanical_verification'] });
    if (!ops.length) return;
    setSaving(true);
    setFailed(null);
    let resp;
    try {
      resp = await api.settings.mutate({
        ns: NAMESPACE,
        ops,
        ...(snap.revision === undefined ? {} : { expectedRevision: snap.revision }),
      });
    } catch {
      setFailed('conflict');
      setSaving(false);
      return;
    }
    if (resp?.result && resp.result.ok === false) {
      setFailed('rejected');
      setSaving(false);
      return;
    }
    const view = resp?.result?.value;
    if (view && typeof view.revision === 'number') {
      setDraft(makeDraft(view.value ?? snap.base ?? snap.value));
      setBasedOn(view.revision);
      setDirty(false);
    } else {
      setDraft(makeDraft(snap.base ?? snap.value));
      setBasedOn(-1);
      setDirty(false);
    }
    setSaving(false);
  };

  const setAudit = (i, row) => edit((cur) => { cur.stages.plan_audit[i] = row; return cur; });
  const removeAudit = (i) => edit((cur) => { cur.stages.plan_audit.splice(i, 1); return cur; });
  const addAudit = () => edit((cur) => {
    if (cur.stages.plan_audit.length < 2) cur.stages.plan_audit.push(stageToDraft(null));
    return cur;
  });

  return h('div', { className: 'dsh-orch-card' },
    h('div', { className: 'dsh-orch-head' },
      h('span', { className: 'dsh-orch-title' }, '编排 Orchestrator', dirty ? h('span', { className: 'dsh-orch-badge', style: { marginLeft: 8 } }, '未保存') : null),
      h('span', { className: 'dsh-orch-desc' }, '三阶段模型编排：规划 → 计划审计 → 执行 → 复核。此处配置优先于插件补丁，会话内 /orch set 优先于此处。'),
    ),
    !snap.writable ? h('p', { className: 'dsh-orch-note' }, '当前连接为 memory 模式或文档只读：仅可查看。') : null,
    failed === 'conflict' ? h('p', { className: 'dsh-orch-error' }, '保存冲突：设置已被其他窗口/进程修改，已重新载入最新值，请重试。')
      : failed === 'rejected' ? h('p', { className: 'dsh-orch-error' }, '保存未通过校验（整数预算、模型必填等），草稿已保留，请修正后重试。')
      : null,
    h('div', { className: 'dsh-orch-section' },
      h('span', { className: 'dsh-orch-section-title' }, '执行模式'),
      h(Field, {
        label: '模式', value: d.mode, options: MODES, disabled, allowEmpty: false,
        overridden: user.mode !== undefined,
        onChange: (v) => edit((cur) => { cur.mode = v || 'auto'; return cur; }),
      }),
    ),
    h('div', { className: 'dsh-orch-section' },
      h('span', { className: 'dsh-orch-section-title' }, '阶段模型'),
      ...STAGE_KEYS.map((k) => h(StageRow, {
        key: k, stageKey: k, title: STAGE_LABELS[k], row: d.stages[k], base, user, disabled,
        onChange: (row) => edit((cur) => { cur.stages[k] = row; return cur; }),
        onReset: () => edit((cur) => { cur.stages[k] = stageToDraft(null); return cur; }),
      })),
      h('div', { className: 'dsh-orch-row' },
        h('span', { className: 'dsh-orch-section-title' }, '计划审计（0–2 个）'),
        h('button', { className: 'dsh-orch-link', disabled: disabled || d.stages.plan_audit.length >= 2, onClick: addAudit, type: 'button' }, '+ 添加审计员'),
      ),
      ...d.stages.plan_audit.map((row, i) => h(AuditRow, {
        key: i, index: i, row, user, disabled, onChange: setAudit, onRemove: () => removeAudit(i),
      })),
    ),
    h('div', { className: 'dsh-orch-section' },
      h('span', { className: 'dsh-orch-section-title' }, '预算（元）'),
      h('div', { className: 'dsh-orch-row' },
        h(Field, {
          label: '单任务上限', value: String(d.budget.task_limit_cny), type: 'number', disabled,
          overridden: userHas(user, ['budget', 'task_limit_cny']),
          onChange: (v) => edit((cur) => { cur.budget.task_limit_cny = v; return cur; }),
        }),
        h(Field, {
          label: '每日上限', value: String(d.budget.daily_limit_cny), type: 'number', disabled,
          overridden: userHas(user, ['budget', 'daily_limit_cny']),
          onChange: (v) => edit((cur) => { cur.budget.daily_limit_cny = v; return cur; }),
        }),
      ),
    ),
    h('div', { className: 'dsh-orch-section' },
      h('span', { className: 'dsh-orch-section-title' }, '机械校验'),
      h('label', { className: 'dsh-orch-label' },
        h('input', {
          type: 'checkbox', disabled, checked: d.mechanical_verification.enabled,
          onChange: (e) => edit((cur) => { cur.mechanical_verification.enabled = e.target.checked; return cur; }),
        }),
        '启用执行产物机械校验（脚本可运行性验证）',
        user.mechanical_verification?.enabled !== undefined ? h('span', { className: 'dsh-orch-badge' }, '已覆盖') : null,
      ),
    ),
    h('div', { className: 'dsh-orch-actions' },
      h('button', { className: 'dsh-orch-btn dsh-orch-btnPrimary', disabled: disabled || invalid || !dirty, onClick: save, type: 'button' }, saving ? '保存中…' : '保存'),
      h('button', { className: 'dsh-orch-btn', disabled: !dirty || saving, onClick: discard, type: 'button' }, '放弃'),
      h('button', { className: 'dsh-orch-link', disabled: disabled || saving, onClick: resetSection, type: 'button' }, '恢复继承默认'),
      invalid ? h('span', { className: 'dsh-orch-error' }, '有未填完的阶段行（保留行必须有模型）或非法数值。') : null,
    ),
  );
}

// ── plugin apply ────────────────────────────────────────────────────────────

const inject = ['connection', 'settingsScope', 'slots'];

function apply(ctx) {
  const { api } = ctx.get('connection');
  const scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
  const cardStore = {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (listener) => scope.subscribe(listener),
  };
  const apiStore = {
    getSnapshot: () => api,
    subscribe: () => () => {}, // static: the connection api reference is stable
  };
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: NAMESPACE,
      inject: () => ({ hooks: { orchestratorCard: cardStore, orchestratorApi: apiStore } }),
    }, OrchestratorCard);
  });
}

module.exports = { apply, inject, buildSaveOps, buildStageOps, auditToUser, clean, makeDraft, stageToDraft, rowInvalid };
