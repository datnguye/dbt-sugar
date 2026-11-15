import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countDescendants, countsOf, runView } from '../../../src/core/snapshot.js';
import { createDbtSource } from '../../../src/dbt/source.js';
import { FIXTURE, makeRun, manifestOf, node, previousOf } from '../../helpers/fixture.js';

const DIAMOND = manifestOf({ a: ['b', 'c'], b: ['d'], c: ['d'] });

function liveRun() {
  return makeRun({ total: 4, nodes: [node('a'), node('b', 'running', { startedAt: 150 })] });
}

test('the real finished build: counts, mood, nothing next', () => {
  const { runs, manifest } = createDbtSource({ projectDir: FIXTURE, env: {} }).read();
  const view = runView(runs[0], { manifest });
  assert.deepEqual(view.counts, { success: 36, warn: 0, error: 1, skipped: 16, running: 0, queued: 0 });
  assert.deepEqual([view.warnings, view.errors, view.mood, view.total, view.status], [8, 1, 'failed', 53, 'error']);
  assert.deepEqual([view.running, view.next, view.atRisk], [[], [], []]);
  assert.equal(view.finished.length, 40);
  assert.ok(view.finished.every((n, i, all) => i === 0 || all[i - 1].endedAt <= n.endedAt));
  assert.equal(view.phases.at(-1).name, 'analyze');
});

test('without history, up next comes from manifest children, ready first', () => {
  const view = runView(liveRun(), { manifest: DIAMOND });
  assert.deepEqual(view.next.map((n) => [n.name, n.waitingOn, n.last, n.type]), [
    ['c', [], null, 'model'],
    ['d', ['b', 'c'], null, 'model']
  ]);
  assert.deepEqual(view.running.map((n) => [n.name, n.startedAt, n.last]), [['b', 150, null]]);
  assert.deepEqual([view.counts.queued, view.mood, view.atRisk], [2, 'running', []]);
  assert.deepEqual(runView(liveRun()).next, []);
});

test('with history, up next follows the previous order and flags nodes at risk', () => {
  const previous = previousOf([['a', 'success'], ['b', 'error', 500], ['d', 'success'], ['c', 'success'], ['model.x.gone', 'success']]);
  const view = runView(liveRun(), { manifest: DIAMOND, previous });
  assert.deepEqual(view.next.map((n) => n.name), ['c', 'gone', 'd']);
  assert.deepEqual(view.next.find((n) => n.name === 'gone').type, null);
  assert.deepEqual(view.running[0].last, { ms: 500, outcome: 'error' });
  assert.deepEqual(view.atRisk, [{ name: 'b', count: 1 }]);
});

test('countsOf sorts outcomes and only queues on live runs', () => {
  const nodes = [node('a'), node('b', 'success', { warned: true }), node('c', 'error'), node('d', 'canceled'), node('e', 'skipped'), node('f', 'running')];
  assert.deepEqual(countsOf(makeRun({ nodes, total: 10 })), { success: 1, warn: 1, error: 1, skipped: 2, running: 1, queued: 4 });
  assert.equal(countsOf(makeRun({ nodes, total: 2 })).queued, 0);
  assert.equal(countsOf(makeRun({ nodes, total: 10, status: 'success' })).queued, 0);
});

test('countDescendants walks each child once within a set', () => {
  assert.equal(countDescendants(DIAMOND, 'a', new Set(['b', 'c', 'd'])), 3);
  assert.equal(countDescendants(DIAMOND, 'a', new Set(['b'])), 1);
  assert.equal(countDescendants(DIAMOND, 'zzz', new Set(['b'])), 0);
  assert.equal(countDescendants(null, 'a', new Set(['b'])), 0);
  assert.equal(countDescendants({ nodes: new Map([['a', { children: ['ghost'] }]]) }, 'a', new Set(['ghost'])), 1);
});

test('failed nodes carry their error line and how many skipped nodes they blocked; lastEventAt tracks the newest event', () => {
  const manifest = manifestOf({ 'model.p.a': ['model.p.b'], 'model.p.c': [] });
  const run = makeRun({
    status: 'error',
    endedAt: 900,
    phases: [{ name: 'run', startedAt: 50, endedAt: 950 }, { name: 'render', startedAt: 60, endedAt: null }],
    nodes: [node('model.p.a', 'error'), node('model.p.b', 'skipped'), node('model.p.c', 'error'), node('model.p.d', 'error', { startedAt: 970 }), node('model.p.e', 'running', { startedAt: 980 })],
    messages: [
      { level: 'error', code: 'DbDriverFailed', nodeId: 'model.p.a', text: 'Database Error in model a\n  Catalog Error: nope' },
      { level: 'error', code: 'X', nodeId: 'model.p.c', text: 'only line' },
      { level: 'error', code: 'Y', nodeId: null, text: 'global' }
    ]
  });
  const view = runView(run, { manifest });
  assert.deepEqual(view.failed.map((f) => [f.name, f.error, f.blocked]), [['a', 'Catalog Error: nope', 1], ['c', 'only line', 0], ['d', null, 0]]);
  assert.equal(view.lastEventAt, 980);
  assert.deepEqual(view.skipped.map((n) => [n.name, n.via]), [['b', 'a']]);
  const bare = runView(makeRun({ status: 'error', nodes: [node('x', 'error'), node('y', 'skipped')] }));
  assert.deepEqual(bare.skipped.map((n) => n.via), [null]);
  const chain = runView(makeRun({ status: 'error', nodes: [node('a', 'error'), node('b', 'skipped'), node('c', 'skipped'), node('d', 'success')] }), { manifest: manifestOf({ a: ['b', 'd'], b: ['c'], c: [] }) });
  assert.deepEqual(chain.skipped.map((n) => [n.name, n.via]), [['b', 'a'], ['c', 'a']]);
  assert.equal(runView(makeRun({ startedAt: 5 })).lastEventAt, 5);
});
