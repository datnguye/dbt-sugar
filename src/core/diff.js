const DIFFABLE = new Set(['model', 'snapshot', 'seed', 'source', 'exposure', 'analysis', 'unit_test', 'test']);
const RANK = { model: 0, snapshot: 1, seed: 2, source: 3, exposure: 4, analysis: 5, unit_test: 6, test: 7 };
const TEST_TYPES = new Set(['test', 'unit_test']);
const BUILDABLE = new Set(['model', 'snapshot', 'seed']);
const CODE_LIMIT = 1500;
const CONTEXT = 3;
const CONFIG_LABEL = { materialized: 'materialized', uniqueKey: 'unique_key', strategy: 'incremental_strategy', onSchemaChange: 'on_schema_change', contract: 'contract.enforced' };

export function lineDiff(before, after) {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  if (a.length > CODE_LIMIT || b.length > CODE_LIMIT) return null;
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ op: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      ops.push({ op: '+', text: b[j] });
      j += 1;
    } else {
      ops.push({ op: '-', text: a[i] });
      i += 1;
    }
  }
  return ops;
}

function gap(n) {
  return { op: '…', text: `${n} unchanged line${n === 1 ? '' : 's'}` };
}

export function hunks(ops) {
  const near = ops.map((_, k) => ops.slice(Math.max(0, k - CONTEXT), k + CONTEXT + 1).some((o) => o.op !== ' '));
  const out = [];
  let skipped = 0;
  ops.forEach((o, k) => {
    if (near[k]) {
      if (skipped) out.push(gap(skipped));
      skipped = 0;
      out.push(o);
    } else skipped += 1;
  });
  if (skipped) out.push(gap(skipped));
  return out;
}

function own(manifest, node) {
  return DIFFABLE.has(node.type) && (!node.package || !manifest.project || node.package === manifest.project);
}

function descendants(manifest, id) {
  const seen = new Set();
  const queue = [...manifest.nodes.get(id).children];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(manifest.nodes.get(next)?.children ?? []));
  }
  return [...seen].filter((d) => manifest.nodes.has(d) && !TEST_TYPES.has(manifest.nodes.get(d).type));
}

function columnChanges(before, after) {
  const added = Object.keys(after).filter((c) => !(c in before));
  const removed = Object.keys(before).filter((c) => !(c in after));
  const typed = Object.keys(after).filter((c) => c in before && before[c].type !== after[c].type).map((c) => ({ name: c, from: before[c].type, to: after[c].type }));
  return { added, removed, typed };
}

function compare(base, current, b, c) {
  const reasons = [];
  if ((b.checksum ?? b.code) !== (c.checksum ?? c.code)) reasons.push('code');
  const config = Object.keys(CONFIG_LABEL).filter((k) => b.config[k] !== c.config[k]).map((k) => ({ field: CONFIG_LABEL[k], from: b.config[k], to: c.config[k] }));
  if (config.length) reasons.push('config');
  const columns = columnChanges(b.columns, c.columns);
  if (columns.added.length || columns.removed.length || columns.typed.length) reasons.push('columns');
  const deps = { added: c.parents.filter((p) => !b.parents.includes(p)), removed: b.parents.filter((p) => !c.parents.includes(p)) };
  if (deps.added.length || deps.removed.length) reasons.push('deps');
  if (b.description !== c.description) reasons.push('description');
  const tests = { from: base.testsOf.get(b.id) ?? 0, to: current.testsOf.get(c.id) ?? 0 };
  if (tests.from !== tests.to) reasons.push('tests');
  return { reasons, config, columns, deps, tests };
}

function breakingOf(change, base, current, b, c) {
  const notes = [];
  if (change.change === 'removed') {
    const users = descendants(base, b.id).length;
    if (users) notes.push(`removed while ${users} node${users === 1 ? '' : 's'} in the base depended on it`);
    return notes;
  }
  if (change.change !== 'modified') return notes;
  const contract = b.config.contract || c.config.contract;
  const { removed, typed } = change.columns;
  if (contract && (removed.length || typed.length)) notes.push(`enforced contract changes: ${[...removed.map((r) => `-${r}`), ...typed.map((t) => `${t.name} ${t.from ?? '?'} → ${t.to ?? '?'}`)].join(', ')}`);
  else if (removed.length && change.downstream) notes.push(`drops ${removed.join(', ')}; ${change.downstream} downstream node${change.downstream === 1 ? '' : 's'} may still select ${removed.length === 1 ? 'it' : 'them'}`);
  const incremental = [b.config.materialized, c.config.materialized].includes('incremental');
  if (incremental && change.config.some((c) => ['materialized', 'unique_key', 'incremental_strategy', 'on_schema_change'].includes(c.field))) notes.push('incremental config changed: plan a --full-refresh');
  if (!b.config.contract && c.config.contract) notes.push('contract now enforced: the build fails if column types drift');
  return notes;
}

function byReview(a, b) {
  return Math.sign(b.breaking.length) - Math.sign(a.breaking.length) || RANK[a.type] - RANK[b.type] || a.name.localeCompare(b.name);
}

export function diffManifests(base, current) {
  const ids = new Set([...base.nodes.values()].filter((n) => own(base, n)).map((n) => n.id));
  for (const n of current.nodes.values()) if (own(current, n)) ids.add(n.id);
  const changes = [];
  for (const id of ids) {
    const b = base.nodes.get(id);
    const c = current.nodes.get(id);
    const node = c ?? b;
    const kind = !b ? 'added' : !c ? 'removed' : 'modified';
    const detail = kind === 'modified' ? compare(base, current, b, c) : { reasons: [], config: [], columns: { added: [], removed: [], typed: [] }, deps: { added: [], removed: [] }, tests: null };
    if (kind === 'modified' && !detail.reasons.length) continue;
    const code = kind === 'removed' ? null : lineDiff(kind === 'added' ? '' : b.code, c.code);
    const change = {
      id,
      name: node.name,
      type: node.type,
      file: node.file,
      change: kind,
      ...detail,
      code: code && (kind === 'added' || detail.reasons.includes('code')) && (b?.code || c.code) ? hunks(code) : null,
      downstream: descendants(kind === 'removed' ? base : current, id).length
    };
    change.breaking = breakingOf(change, base, current, b, c);
    changes.push(change);
  }
  changes.sort(byReview);
  const changed = new Set(changes.map((c) => c.id));
  const impacted = new Map();
  for (const change of changes.filter((c) => c.change !== 'removed' && !TEST_TYPES.has(c.type))) {
    for (const id of descendants(current, change.id)) {
      if (!changed.has(id) && !impacted.has(id)) impacted.set(id, { id, name: current.nodes.get(id).name, type: current.nodes.get(id).type, via: change.name });
    }
  }
  const models = changes.filter((c) => c.type === 'model' && c.change !== 'removed');
  const checklist = [
    ...models.filter((c) => !current.testsOf.get(c.id)).map((c) => `${c.name} has no tests`),
    ...models.filter((c) => c.change === 'added' && !current.nodes.get(c.id).description.trim()).map((c) => `${c.name} is new and has no description`),
    ...changes.filter((c) => c.breaking.some((n) => n.includes('full-refresh'))).map((c) => `${c.name}: run with --full-refresh after merge`)
  ];
  const build = changes.filter((c) => c.change !== 'removed' && BUILDABLE.has(c.type)).map((c) => `${c.name}+`);
  const count = (kind) => changes.filter((c) => c.change === kind).length;
  return {
    summary: { added: count('added'), modified: count('modified'), removed: count('removed'), impacted: impacted.size, breaking: changes.filter((c) => c.breaking.length).length, tests: changes.filter((c) => TEST_TYPES.has(c.type)).length },
    changes,
    impacted: [...impacted.values()].sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || a.name.localeCompare(b.name)),
    checklist,
    command: build.length ? `dbt build --select ${build.join(' ')}` : null
  };
}
