import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { diffManifests, hunks, lineDiff } from '../../../src/core/diff.js';
import { parseManifest } from '../../../src/dbt/manifest.js';
import { FIXTURE } from '../../helpers/fixture.js';

const TYPES = { operation: 'operation', model: 'model', seed: 'seed', test: 'test', source: 'source', exposure: 'exposure', snapshot: 'snapshot', unit_test: 'unit_test', macro: 'macro' };

function manifest(spec, project = 'p') {
  const nodes = {};
  const parentMap = {};
  const childMap = {};
  for (const [name, n] of Object.entries(spec)) {
    const type = n.type ?? 'model';
    const id = `${TYPES[type]}.${n.package ?? project}.${name}`;
    nodes[id] = { unique_id: id, name, resource_type: type, package_name: n.package ?? project, original_file_path: `models/${name}.sql`, description: n.description ?? '', raw_code: n.code ?? `select 1 as ${name}`, checksum: n.checksum === undefined ? { checksum: n.code ?? name } : n.checksum, columns: n.columns ?? {}, config: n.config ?? { materialized: 'table' } };
    parentMap[id] = (n.parents ?? []).map((p) => `model.${project}.${p}`);
  }
  for (const [id, parents] of Object.entries(parentMap)) for (const p of parents) (childMap[p] ??= []).push(id);
  for (const id of Object.keys(nodes)) childMap[id] ??= [];
  return parseManifest({ metadata: { project_name: project }, nodes, parent_map: parentMap, child_map: childMap });
}

function load(file) {
  return parseManifest(JSON.parse(fs.readFileSync(path.join(FIXTURE, file), 'utf8')));
}

test('lineDiff and hunks show changed lines with context and collapse the rest', () => {
  assert.deepEqual(lineDiff('a\nb', 'a\nc'), [{ op: ' ', text: 'a' }, { op: '+', text: 'c' }, { op: '-', text: 'b' }]);
  assert.deepEqual(lineDiff(null, 'x'), [{ op: '+', text: 'x' }]);
  assert.deepEqual(lineDiff('x', ''), [{ op: '-', text: 'x' }]);
  assert.equal(lineDiff('a\n'.repeat(1600), 'b'), null);
  const before = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const after = [...before];
  after[10] = 'changed';
  const shown = hunks(lineDiff(before.join('\n'), after.join('\n')));
  assert.deepEqual(shown[0], { op: '…', text: '7 unchanged lines' });
  assert.equal(shown.at(-1).text, '6 unchanged lines');
  assert.deepEqual(hunks([{ op: ' ', text: 'x' }]), [{ op: '…', text: '1 unchanged line' }]);
  assert.equal(hunks(lineDiff('x', 'y')).length, 2);
});

test('the real jaffle-shop change: contract column types flagged as breaking', () => {
  const d = diffManifests(load('base/manifest.json'), load('target/manifest.json'));
  assert.deepEqual(d.summary, { added: 0, modified: 3, removed: 0, impacted: 1, breaking: 2, tests: 0 });
  assert.deepEqual(d.changes.map((c) => c.name), ['fct_customer_segment_orders', 'orders', 'raw_orders']);
  assert.match(d.changes[1].breaking[0], /enforced contract changes: order_total numeric → numeric\(16, 2\)/);
  assert.deepEqual(d.changes[2].reasons, ['code']);
  assert.equal(d.changes[2].code, null);
  assert.deepEqual(d.impacted, [{ id: 'model.jaffle_shop.customers', name: 'customers', type: 'model', via: 'orders' }]);
  assert.equal(d.command, 'dbt build --select fct_customer_segment_orders+ orders+ raw_orders+');
});

test('added, removed and modified nodes carry their reasons, breaking notes and checklist', () => {
  const base = manifest({
    stg: { code: 'select 1', columns: { id: { name: 'id', data_type: 'int' }, old: { name: 'old', data_type: 'int' } } },
    mart: { parents: ['stg'], code: 'select * from stg', config: { materialized: 'table' } },
    gone: { parents: ['stg'] },
    user_of_gone: { parents: ['gone'] },
    keep: {},
    contracted: { columns: { a: { name: 'a', data_type: 'int' }, b: { name: 'b', data_type: 'int' } }, config: { materialized: 'table', contract: { enforced: true } } },
    loose: { config: { materialized: 'view' } },
    t1: { type: 'test', parents: ['keep'] },
    other: { package: 'dbt_utils' }
  });
  const current = manifest({
    stg: { code: 'select 1', columns: { id: { name: 'id', data_type: 'bigint' }, fresh: { name: 'fresh', data_type: 'int' } } },
    mart: { parents: ['stg', 'keep'], code: 'select *\nfrom stg', description: 'the mart', config: { materialized: 'incremental', unique_key: 'id' } },
    user_of_gone: {},
    keep: {},
    added_model: { parents: ['keep'], code: 'select 2' },
    contracted: { columns: { a: { name: 'a', data_type: 'text' } }, config: { materialized: 'table', contract: { enforced: true } } },
    loose: { config: { materialized: 'view', contract: { enforced: true } } },
    t1: { type: 'test', parents: ['keep'] },
    t2: { type: 'test', parents: ['keep'] },
    other: { package: 'dbt_utils', code: 'changed' }
  });
  const d = diffManifests(base, current);
  const by = Object.fromEntries(d.changes.map((c) => [c.name, c]));
  assert.equal(by.other, undefined);
  assert.equal(by.t1, undefined);
  assert.equal(by.t2.change, 'added');
  assert.equal(by.added_model.change, 'added');
  assert.deepEqual(by.added_model.code, [{ op: '+', text: 'select 2' }]);
  assert.equal(by.gone.change, 'removed');
  assert.deepEqual(by.gone.breaking, ['removed while 1 node in the base depended on it']);
  assert.equal(by.gone.code, null);
  assert.deepEqual(by.stg.columns, { added: ['fresh'], removed: ['old'], typed: [{ name: 'id', from: 'int', to: 'bigint' }] });
  assert.match(by.stg.breaking[0], /drops old; 1 downstream node may still select it/);
  assert.deepEqual(by.mart.reasons, ['code', 'config', 'deps', 'description']);
  assert.deepEqual(by.mart.config.map((c) => c.field), ['materialized', 'unique_key']);
  assert.deepEqual(by.mart.deps, { added: ['model.p.keep'], removed: [] });
  assert.ok(by.mart.code.some((l) => l.op === '+'));
  assert.deepEqual(by.mart.breaking, ['incremental config changed: plan a --full-refresh']);
  assert.match(by.contracted.breaking[0], /enforced contract changes: -b, a int → text/);
  assert.deepEqual(by.loose.breaking, ['contract now enforced: the build fails if column types drift']);
  assert.deepEqual(by.keep.reasons, ['tests']);
  assert.deepEqual(by.keep.tests, { from: 1, to: 2 });
  assert.equal(d.changes.at(-1).type, 'test');
  assert.ok(d.changes.indexOf(by.gone) < d.changes.indexOf(by.keep));
  assert.ok(d.checklist.includes('added_model has no tests'));
  assert.ok(d.checklist.includes('added_model is new and has no description'));
  assert.ok(d.checklist.includes('mart: run with --full-refresh after merge'));
  assert.match(d.command, /^dbt build --select /);
  assert.ok(d.impacted.every((n) => !d.changes.some((c) => c.id === n.id)));
});

test('nodes without a package or project are compared, unchanged nodes are skipped, a test-only change has no build command', () => {
  const plain = (spec) => parseManifest({ nodes: { a: { unique_id: 'a', name: 'a', resource_type: 'model', checksum: { checksum: spec } }, s: { unique_id: 's', name: 's', resource_type: 'seed', checksum: { checksum: 'x' } } } });
  assert.equal(diffManifests(plain('1'), plain('1')).changes.length, 0);
  assert.equal(diffManifests(plain('1'), plain('1')).command, null);
  assert.deepEqual(diffManifests(plain('1'), plain('2')).changes.map((c) => c.reasons), [['code']]);
  const t = (n) => manifest({ m: {}, ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, { type: 'test', parents: ['m'] }])) });
  const testsOnly = diffManifests(manifest({ m: {}, t0: { type: 'test', parents: ['m'], code: 'a' } }), manifest({ m: {}, t0: { type: 'test', parents: ['m'], code: 'b' } }));
  assert.equal(testsOnly.command, null);
  assert.equal(testsOnly.summary.tests, 1);
  assert.equal(diffManifests(t(1), t(1)).changes.length, 0);
  const seeds = diffManifests(manifest({ s: { type: 'seed', code: '', checksum: { checksum: 'a' } } }), manifest({ s: { type: 'seed', code: '', checksum: { checksum: 'b' } } }));
  assert.equal(seeds.changes[0].code, null);
  const removedLeaf = diffManifests(manifest({ leaf: {} }), manifest({}));
  assert.deepEqual(removedLeaf.changes[0].breaking, []);
  const gaps = hunks(lineDiff(['x', ...'abcdefg'.split(''), 'y'].join('\n'), ['X', ...'abcdefg'.split(''), 'Y'].join('\n')));
  assert.ok(gaps.some((l) => l.text === '1 unchanged line'));
  const wide = diffManifests(
    manifest({ root: {}, a: { parents: ['root'] }, b: { parents: ['root'] }, z: { parents: ['a', 'b'] }, c1: { columns: { x: { name: 'x' }, y: { name: 'y', data_type: 'int' }, w: { name: 'w' } }, config: { materialized: 'table', contract: { enforced: true } } }, d1: { columns: { u: { name: 'u' }, v: { name: 'v' } } }, d2: { parents: ['d1'] }, d3: { parents: ['d1'] } }),
    manifest({ a: { parents: [] }, b: { parents: [] }, z: { parents: ['a', 'b'] }, c1: { columns: { y: { name: 'y' }, w: { name: 'w', data_type: 'int' } }, config: { materialized: 'table', contract: { enforced: true } } }, d1: { columns: {} }, d2: { parents: ['d1'] }, d3: { parents: ['d1'] } })
  );
  const w = Object.fromEntries(wide.changes.map((c) => [c.name, c]));
  assert.deepEqual(w.root.breaking, ['removed while 3 nodes in the base depended on it']);
  assert.match(w.c1.breaking[0], /-x, y int → \?, w \? → int/);
  assert.match(w.d1.breaking[0], /drops u, v; 2 downstream nodes may still select them/);
  const ghost = parseManifest({ metadata: { project_name: 'p' }, nodes: { 'model.p.m': { unique_id: 'model.p.m', name: 'm', resource_type: 'model', package_name: 'p', checksum: { checksum: '1' } } }, child_map: { 'model.p.m': ['metric.p.revenue'] } });
  const ghost2 = parseManifest({ metadata: { project_name: 'p' }, nodes: { 'model.p.m': { unique_id: 'model.p.m', name: 'm', resource_type: 'model', package_name: 'p', checksum: { checksum: '2' } } }, child_map: { 'model.p.m': ['metric.p.revenue'] } });
  assert.equal(diffManifests(ghost, ghost2).changes[0].downstream, 0);
  const fan = diffManifests(manifest({ m: {}, k1: { parents: ['m'] }, k2: { parents: ['m'] }, op: { type: 'operation', parents: ['m'] }, s1: { type: 'snapshot', parents: ['m'] }, op2: { type: 'operation', parents: ['m'] } }), manifest({ m: { code: 'new' }, k1: { parents: ['m'] }, op: { type: 'operation', parents: ['m'] }, k2: { parents: ['m'] }, s1: { type: 'snapshot', parents: ['m'] }, op2: { type: 'operation', parents: ['m'] } }));
  assert.deepEqual(fan.impacted.map((n) => n.name), ['k1', 'k2', 's1', 'op', 'op2']);
  const exposure = diffManifests(manifest({ m: {}, z: { type: 'exposure', parents: ['m'] } }), manifest({ m: { code: 'new' }, z: { type: 'exposure', parents: ['m'] } }));
  assert.deepEqual(exposure.impacted.map((n) => n.type), ['exposure']);
});
