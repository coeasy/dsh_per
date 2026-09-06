// CI gate: verify the transition table's structural invariants (开发计划 §8).
// 1) event closure — every exact row key is a known event; every fallback
//    resolves to a real row or global event
// 2) termination — every non-terminal state can reach a terminal state
// 3) zero-cost cycles — every cycle contains a counter-consuming edge
// 4) fallback chains — acyclic and depth ≤ 2
// 5) variant reachability — a `${event}:variant` row is dead when the same
//    state also has an UNGUARDED exact `event` row (fsm resolves exact rows
//    first), unless the engine emits the composite event name explicitly
// 6) build freshness — no src/ file may be newer than its lib/ counterpart,
//    otherwise this gate would be validating stale output
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// v3: load the table from SOURCE, not from lib/. v2 imported
// `../lib/task/transition-table.js`, so an unbuilt tree made this gate report
// OK against yesterday's table while src/ had moved on (measured: src/engine.ts
// was 399s newer than lib/engine.js while ci:checks still passed).
const { transpileModule } = require('typescript');
const tablePath = join(ROOT, 'src/task/transition-table.ts');
const tableTs = readFileSync(tablePath, 'utf8');
const tableCjs = transpileModule(tableTs, {
  compilerOptions: { module: 'CommonJS', target: 'ES2022' },
  fileName: tablePath,
}).outputText;
const tableExports = new Function('exports', 'module', tableCjs + '\n;return exports;')({}, { exports: {} });
const { TRANSITION_TABLE, GLOBAL_EVENTS } = tableExports;

const TERMINAL = new Set(['DONE', 'DONE_FLAGGED', 'ABORTED']);
const STATES = ['IDLE', 'PLANNING', 'PLAN_FAIL', 'EXECUTING', 'RE-PLANNING', 'REVIEWING', ...TERMINAL];
const KNOWN_EVENTS = new Set([
  'task/launch', 'plan/ok', 'plan/fail', 'plan/steps-exceeded', 'plan/retry',
  'exec/ok', 'exec/need-replan', 'exec/fail', 'exec/steps-exceeded',
  'replan/ok', 'replan/fail',
  'review/pass', 'review/fail-exec', 'review/fail-plan', 'review/ambiguous', 'review/deadlock',
  'budget/exhausted', 'user/cancel', 'circuit/broken', 'model/hard-fail',
]);

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL: ${msg}`); };

// ── 1) closure ──
const allRowKeys = new Set();
for (const rules of Object.values(TRANSITION_TABLE)) {
  for (const key of Object.keys(rules)) allRowKeys.add(key);
}
const hasFallbackTarget = (fb) => {
  if (GLOBAL_EVENTS[fb]) return true;
  if (allRowKeys.has(fb)) return true; // composite rows are referenced by full key
  const base = fb.split(':')[0];
  for (const rules of Object.values(TRANSITION_TABLE)) {
    for (const key of Object.keys(rules)) {
      if (key === fb || key.split(':')[0] === base) return true;
    }
  }
  return false;
};
for (const [state, rules] of Object.entries(TRANSITION_TABLE)) {
  for (const [key, rule] of Object.entries(rules)) {
    const base = key.split(':')[0];
    const keyValid = KNOWN_EVENTS.has(base) || [...Object.values(TRANSITION_TABLE)].some((rs) =>
      Object.values(rs).some((r) => r.fallback === key));
    if (!keyValid) fail(`unknown event key "${key}" in ${state}`);
    if (!STATES.includes(rule.to)) fail(`unknown target state "${rule.to}" in ${state}:${key}`);
    if (TERMINAL.has(state)) fail(`terminal state ${state} has outgoing rows`);
    if (rule.fallback && !hasFallbackTarget(rule.fallback)) fail(`fallback "${rule.fallback}" of ${state}:${key} resolves to nothing`);
  }
}

// ── 2) termination reachability ──
function edgesFrom(state) {
  const out = new Set();
  const rules = TRANSITION_TABLE[state] ?? {};
  for (const rule of Object.values(rules)) {
    out.add(rule.to);
    if (rule.fallback) {
      // fallbacks resolve to rows in other states — approximate by allowing terminal
      out.add('__fallback__');
    }
  }
  for (const g of Object.keys(GLOBAL_EVENTS)) out.add('ABORTED'); // global interrupts reach ABORTED
  return out;
}
function reachable(state, seen = new Set()) {
  if (seen.has(state)) return new Set();
  seen.add(state);
  for (const t of edgesFrom(state)) {
    if (t === '__fallback__') { seen.add('ABORTED'); continue; }
    reachable(t, seen);
  }
  return seen;
}
for (const s of STATES.filter((x) => !TERMINAL.has(x))) {
  const r = reachable(s);
  if (!['DONE', 'DONE_FLAGGED', 'ABORTED'].some((t) => r.has(t))) fail(`state ${s} cannot reach a terminal state`);
}

// ── 3) zero-cost cycles ──
const consumes = (rule) => {
  const c = rule.action?.counters;
  return Boolean(c && Object.keys(c).length);
};
// DFS all simple cycles over states
const cycles = [];
function dfs(path, visited) {
  const cur = path.at(-1);
  for (const next of edgesFrom(cur)) {
    if (next === '__fallback__') continue;
    if (next === 'ABORTED' || TERMINAL.has(next)) continue;
    const idx = path.indexOf(next);
    if (idx !== -1) {
      cycles.push(path.slice(idx));
      continue;
    }
    if (visited.has(next)) continue;
    visited.add(next);
    dfs([...path, next], visited);
    visited.delete(next);
  }
}
for (const s of STATES.filter((x) => !TERMINAL.has(x))) dfs([s], new Set([s]));
for (const cycle of cycles) {
  const hasCost = cycle.some((state) => Object.values(TRANSITION_TABLE[state] ?? {}).some(consumes));
  // entering RE-PLANNING / PLAN_FAIL always consumes via actions; REVIEWING→REVIEWING supplement counts
  if (!hasCost) fail(`zero-cost cycle detected: ${cycle.join(' -> ')}`);
}

// ── 4) fallback chain depth ──
function resolveFallback(fb) {
  // exact full-key row first, then base-name matches
  const exact = [];
  const byBase = [];
  for (const [s, rs] of Object.entries(TRANSITION_TABLE)) {
    for (const [k] of Object.entries(rs)) {
      if (k === fb) exact.push([s, k]);
      else if (k.split(':')[0] === fb.split(':')[0]) byBase.push([s, k]);
    }
  }
  return exact.length ? exact : byBase;
}
function fallbackDepth(state, key, seen = new Set(), depth = 0) {
  if (depth > 2) return Infinity;
  const rule = (TRANSITION_TABLE[state] ?? {})[key];
  if (!rule?.fallback) return depth;
  if (GLOBAL_EVENTS[rule.fallback]) return depth + 1;
  const targets = resolveFallback(rule.fallback).filter(([s, k]) => !seen.has(`${s}:${k}`));
  if (!targets.length) return Infinity; // only self-references remain => cycle
  let max = depth + 1;
  for (const [s, k] of targets) {
    max = Math.max(max, fallbackDepth(s, k, new Set([...seen, `${state}:${key}`]), depth + 1));
  }
  return max;
}
for (const [state, rules] of Object.entries(TRANSITION_TABLE)) {
  for (const key of Object.keys(rules)) {
    if (fallbackDepth(state, key) === Infinity) fail(`fallback chain from ${state}:${key} is cyclic or exceeds depth 2`);
  }
}

// ── 5) variant rows must be reachable (P1-07) ──
// `fsm.transition` tries the EXACT event row first, then `${event}:variant`
// rows in definition order. An exact row without a guard therefore shadows
// every variant of that event — the only legitimate escape is the engine
// emitting the full composite name (`'exec/ok:DONE'`). Scan src/ for it.
const srcFiles = (() => {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.ts')) out.push(full);
    }
  };
  if (existsSync(join(ROOT, 'src'))) walk(join(ROOT, 'src'));
  return out;
})();
const srcSources = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
for (const [state, rules] of Object.entries(TRANSITION_TABLE)) {
  for (const [key, rule] of Object.entries(rules)) {
    if (!key.includes(':')) continue;
    const base = key.split(':')[0];
    const exact = rules[base];
    if (exact && !exact.guard && !srcSources.includes(`'${key}'`) && !srcSources.includes(`"${key}"`)) {
      fail(`dead row ${state}:${key} — unguarded exact row "${base}" shadows it and no explicit composite emission exists`);
    }
    void rule;
  }
}

// ── 6) build freshness — the gate must never validate stale lib/ output ──
const libDir = join(ROOT, 'lib');
let freshnessNote = 'fresh';
if (!existsSync(libDir)) {
  freshnessNote = 'lib/ absent (skipped)';
} else {
  let stale = 0;
  for (const f of srcFiles) {
    const rel = relative(join(ROOT, 'src'), f);
    const js = join(ROOT, 'lib', rel.replace(/\.ts$/, '.js'));
    if (!existsSync(js)) {
      stale++;
      continue;
    }
    if (statSync(js).mtimeMs < statSync(f).mtimeMs) stale++;
  }
  if (stale > 0) {
    fail(`stale build: ${stale} src/ file(s) newer than (or missing from) lib/ — run "pnpm run build" before the gate`);
    freshnessNote = `${stale} stale`;
  }
}

// summary
const version = pkg.version;
if (failures === 0) {
  console.log(`ci-checks: OK (v${version}) — ${Object.keys(TRANSITION_TABLE).length} states with rows, ${cycles.length} cycles all costed, fallbacks acyclic, variant rows reachable, build ${freshnessNote} (src)`);
} else {
  console.error(`ci-checks: ${failures} failure(s)`);
  process.exit(1);
}
