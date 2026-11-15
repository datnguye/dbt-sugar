import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggest } from '../../../src/core/suggest.js';
import { createDbtSource } from '../../../src/dbt/source.js';
import { FIXTURE, makeRun, manifestOf, node } from '../../helpers/fixture.js';

test('the real build: the locations error first, then warnings and project gaps', () => {
  const { runs, manifest } = createDbtSource({ projectDir: FIXTURE, env: {} }).read();
  const tips = suggest({ run: runs[0], manifest });
  assert.deepEqual(tips.map((t) => t.kind), ['ERROR', 'WARNING', 'WARNING', 'TESTS', 'DOCS', 'FRESHNESS']);
  assert.equal(tips[0].title, 'locations: Catalog Error: Type with name timestamp_ntz does not exist!');
  assert.deepEqual([tips[0].gain, tips[0].fix], ['unblocks 16 nodes', 'Open models/marts/locations.sql']);
  assert.ok(tips.some((t) => t.title.startsWith('7× ColumnTypeMismatch') && t.gain === '−7 warnings'));
  assert.deepEqual([tips[3].title, tips[3].gain], ['5 of 15 models have no tests', 'coverage 67% → 100%']);
  assert.equal(tips[5].title, '6 sources without a freshness check');
});

test('error and warning tips handle missing nodes, codes and text', () => {
  const manifest = manifestOf({ a: ['b'] }, { types: { t: 'test' } });
  const run = makeRun({
    nodes: [node('a', 'error'), node('b', 'skipped')],
    messages: [
      { level: 'error', code: 'X', nodeId: null, text: 'no node' },
      { level: 'error', code: 'DbDriverFailed', nodeId: 'a', text: 'Database Error\n  missing column\n' },
      { level: 'error', code: 'Boom', nodeId: 'model.p.gone', text: 'single line' },
      { level: 'error', code: 'Silent', nodeId: 'model.p.quiet', text: '' },
      { level: 'warn', code: null, text: 'same\nsecond line' },
      { level: 'warn', code: null, text: 'same\nsecond line' }
    ]
  });
  const tips = suggest({ run, manifest });
  assert.deepEqual(tips.filter((t) => t.kind === 'ERROR').map((t) => [t.title, t.gain, t.fix]), [
    ['a: missing column', 'unblocks 1 node', ''],
    ['gone: single line', 'fixes the run', ''],
    ['quiet: Silent', 'fixes the run', '']
  ]);
  const warning = tips.find((t) => t.kind === 'WARNING');
  assert.deepEqual([warning.title, warning.gain, warning.why], ['2× Warning: same', '−2 warnings', 'same\nsecond line']);
  assert.deepEqual(suggest({ run: makeRun({ messages: [{ level: 'error', code: 'E', nodeId: 'model.p.x', text: 'oops' }] }) })[0].gain, 'fixes the run');
});

test('project tips list long name sets and vanish when the project is tidy', () => {
  const many = manifestOf(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`m${i}`, []])));
  const tests = suggest({ manifest: many }).find((t) => t.kind === 'TESTS');
  assert.equal(tests.why, 'm0, m1, m2, m3, m4, m5 and 2 more');
  assert.equal(tests.gain, 'coverage 0% → 100%');
  const tidy = manifestOf({ a: ['t'] }, { types: { t: 'test' }, sources: { s: { unique_id: 's', name: 'x', source_name: 'raw', freshness: { warn_after: { count: 1 } } } } });
  assert.deepEqual(suggest({ manifest: tidy }), []);
  const one = manifestOf({ a: [] });
  one.nodes.get('a').description = ' ';
  one.sources.push({ id: 's', name: 'raw.x', freshness: false });
  assert.deepEqual(suggest({ manifest: one }).map((t) => t.title), ['1 of 1 model has no tests', '1 model without a description', '1 source without a freshness check']);
});

test('history adds flaky tests and slow tables, ranked after errors', () => {
  const history = {
    flaky: [{ name: 'unique_x', fails: 3, runs: 10 }],
    slow: [
      { name: 'big', ms: 120000, materialization: 'table' },
      { name: 'quick', ms: 30000, materialization: 'table' },
      { name: 'viewy', ms: 90000, materialization: 'view' }
    ]
  };
  const run = makeRun({ messages: [{ level: 'error', code: 'E', nodeId: 'model.p.a', text: 'x' }, { level: 'warn', code: 'W', text: 'w' }] });
  const tips = suggest({ run, history });
  assert.deepEqual(tips.map((t) => t.kind), ['ERROR', 'FLAKY', 'SPEED', 'WARNING']);
  assert.deepEqual([tips[1].title, tips[2].title], ['unique_x failed 3 of the last 10 runs', 'big takes 120s as a table: consider incremental']);
  assert.deepEqual(suggest({}), []);
});
