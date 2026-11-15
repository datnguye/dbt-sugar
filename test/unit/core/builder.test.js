import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createSnapshotBuilder } from '../../../src/core/builder.js';
import { createDbtSource } from '../../../src/dbt/source.js';
import { parseManifest } from '../../../src/dbt/manifest.js';
import { FIXTURE, makeRun, previousOf } from '../../helpers/fixture.js';

function fakeSource(runs, manifest = null) {
  return { dir: '/p', name: 'p', read: () => ({ found: true, runs, manifest, log: new Map() }) };
}

function fakeStore(overrides = {}) {
  const calls = { saved: [], previous: [], stats: [] };
  const store = {
    calls,
    saveRun: async (dir, run) => calls.saved.push([dir, run.id]),
    previousRun: async (dir, command, before) => {
      calls.previous.push([dir, command, before]);
      return before === 50 ? previousOf([['model.p.x', 'success']]) : null;
    },
    stats: async (dir) => {
      calls.stats.push(dir);
      return { flaky: [{ name: 'flaky_test', fails: 2, runs: 5 }] };
    },
    ...overrides
  };
  return store;
}

test('builds the real project without history', async () => {
  const builder = createSnapshotBuilder({ sources: [createDbtSource({ projectDir: FIXTURE, env: {} })], now: () => 42 });
  const snapshot = await builder.build();
  const [project] = snapshot.projects;
  assert.deepEqual([snapshot.generatedAt, snapshot.history, project.name, project.otel, project.version, project.runs.length], [42, false, 'jaffle', true, '2.0.11', 1]);
  assert.equal(project.suggestions[0].gain, 'unblocks 16 nodes');
  assert.ok(project.runs[0].log.length > 0);
  assert.ok(project.runs[0].log.every((e) => e.inv === project.runs[0].invocationId));
});

test('saves each finished run once, lists live runs first, keeps ten', async () => {
  const runs = [
    ...Array.from({ length: 11 }, (_, i) => makeRun({ id: `done-${i}`, status: 'success', startedAt: i * 10 })),
    makeRun({ id: 'live', startedAt: 1 })
  ];
  const store = fakeStore();
  const builder = createSnapshotBuilder({ sources: [fakeSource(runs)], store });
  const first = await builder.build();
  await builder.build();
  assert.equal(store.calls.saved.length, 11);
  assert.deepEqual(first.projects[0].runs.map((r) => r.key), ['live', 'done-10', 'done-9', 'done-8', 'done-7', 'done-6', 'done-5', 'done-4', 'done-3', 'done-2']);
  assert.deepEqual(store.calls.previous[0], ['/p', 'build', 1]);
  assert.equal(first.history, true);
  assert.deepEqual(first.projects[0].suggestions.map((t) => t.kind), ['FLAKY']);
  assert.equal(first.projects[0].version, null);
});

test('a failing store never breaks the snapshot', async () => {
  const fail = async () => {
    throw new Error('locked');
  };
  const store = fakeStore({ saveRun: fail, previousRun: fail, stats: fail });
  const snapshot = await createSnapshotBuilder({ sources: [fakeSource([makeRun({ status: 'error' })])], store }).build();
  assert.equal(snapshot.projects[0].runs.length, 1);
  assert.deepEqual(snapshot.projects[0].suggestions, []);
  const empty = await createSnapshotBuilder({ sources: [fakeSource([])] }).build();
  assert.deepEqual([empty.projects[0].runs, empty.projects[0].suggestions], [[], []]);
  assert.equal(typeof empty.generatedAt, 'number');
});

function loadManifest(file) {
  return parseManifest(JSON.parse(fs.readFileSync(path.join(FIXTURE, file), 'utf8')));
}

function baseSource(state) {
  return { dir: '/p', name: 'p', read: () => ({ found: true, runs: [], manifest: state.manifest, log: new Map(), base: state.base, head: state.head ?? null, git: state.git ?? null }) };
}

async function diffOf(builder) {
  return (await builder.build()).projects[0].diff;
}

function side(status, extra = {}) {
  return { status, ref: 'main', sha: 'aaaa1111', out: '/cache/aaaa1111/p', warning: null, manifest: null, ...extra };
}

test('diff: off without a base, explains a missing manifest, passes base status through, memoizes the result', async () => {
  const current = loadManifest('target/manifest.json');
  const baseManifest = loadManifest('base/manifest.json');
  const git = { current: 'feature/x', branches: ['feature/x', 'main'], base: 'main' };
  const state = { manifest: current, base: null, git };
  const builder = createSnapshotBuilder({ sources: [baseSource(state)] });
  assert.equal(await diffOf(builder), null);
  state.manifest = null;
  state.base = side('ready', { manifest: baseManifest });
  const missing = await diffOf(builder);
  assert.equal(missing.status, 'error');
  assert.match(missing.error, /no target\/manifest\.json yet/);
  assert.equal(missing.baseAt, baseManifest.generatedAt);
  state.manifest = current;
  state.base = side('missing');
  const needed = await diffOf(builder);
  assert.deepEqual([needed.status, needed.side, needed.out, needed.result, needed.git], ['missing', 'base', '/cache/aaaa1111/p', null, git]);
  state.base = side('error', { error: 'boom' });
  assert.equal((await diffOf(builder)).error, 'boom');
  state.base = side('ready', { manifest: baseManifest });
  const first = await diffOf(builder);
  assert.equal(first.result.summary.modified, 3);
  assert.equal(first.head, null);
  assert.equal((await diffOf(builder)).result, first.result);
  state.manifest = loadManifest('target/manifest.json');
  assert.notEqual((await diffOf(builder)).result, first.result);
});

test('diff: a selected compare branch replaces the working tree, and its pending status wins', async () => {
  const current = loadManifest('target/manifest.json');
  const baseManifest = loadManifest('base/manifest.json');
  const state = { manifest: null, base: side('ready', { manifest: baseManifest }), head: side('missing', { ref: 'feature/x', sha: 'bbbb2222', out: '/cache/bbbb2222/p' }) };
  const builder = createSnapshotBuilder({ sources: [baseSource(state)] });
  const pending = await diffOf(builder);
  assert.deepEqual([pending.status, pending.side, pending.out], ['missing', 'head', '/cache/bbbb2222/p']);
  assert.deepEqual(pending.head, { ref: 'feature/x', sha: 'bbbb2222', status: 'missing' });
  state.head = side('ready', { ref: 'feature/x', sha: 'bbbb2222', manifest: current });
  const ready = await diffOf(builder);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.result.summary.modified, 3);
  assert.equal(ready.currentAt, current.generatedAt);
});
