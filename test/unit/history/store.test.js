import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createStore, retry, sugarHome } from '../../../src/history/store.js';
import { tempDir } from '../../helpers/fixture.js';

function node(id, outcome, ms, index, type = 'model') {
  return { id, name: id.split('.').pop(), type, materialization: type === 'model' ? 'table' : 'test', outcome, durationMs: ms, index };
}

function run(id, startedAt, nodes, command = 'build') {
  return { id, command, rawCommand: `dbt ${command}`, target: 'dev', version: '2.0.11', startedAt, endedAt: startedAt + 1000, status: 'success', total: nodes.length, nodes: new Map(nodes.map((n) => [n.id, n])) };
}

test('re-exports sugarHome for library users', () => {
  assert.equal(sugarHome({ DBT_SUGAR_HOME: '/x' }), '/x');
});

test('retry repeats lock errors, then gives up; other errors fail at once', async () => {
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw new Error('IO Error: Could not set lock on file');
    return 'ok';
  };
  assert.equal(await retry(flaky, { wait }), 'ok');
  assert.deepEqual(waits, [100, 100]);
  await assert.rejects(retry(async () => { throw new Error('Conflicting lock'); }, { attempts: 2, wait }), /Conflicting lock/);
  await assert.rejects(retry(async () => { throw new Error('boom'); }, { wait }), /boom/);
  assert.equal(await retry(async () => 'default wait'), 'default wait');
});

test('saves runs, finds the previous run of the same command, and reports flaky and slow nodes', async (t) => {
  const store = createStore({ dir: tempDir(t) });
  const many = Array.from({ length: 450 }, (_, i) => node(`model.p.m${i}`, 'success', 10, i));
  await store.saveRun('/p', run('r0', 100, many));
  await store.saveRun('/p', run('r1', 1000, [node('model.p.b', 'success', 90000, 2), node('model.p.a', 'success', 50, 1), node('test.p.t', 'error', 5, null, 'test')]));
  await store.saveRun('/p', run('r2', 2000, [node('model.p.a', 'error', 70, 1), node('model.p.b', 'success', 80000, 2), node('test.p.t', 'success', 5, 3, 'test')]));
  await store.saveRun('/p', run('r3', 3000, [node('test.p.t', 'error', null, 1, 'test')]));
  await store.saveRun('/p', run('r4', 4000, [node('model.p.a', 'success', 1, 1)], 'run'));
  await store.saveRun('/p', run('r2', 2000, [node('model.p.a', 'error', 70, 1), node('model.p.b', 'success', 80000, 2), node('test.p.t', 'success', 5, 3, 'test')]));

  const previous = await store.previousRun('/p', 'build', 2500);
  assert.equal(previous.id, 'r2');
  assert.deepEqual(previous.order, ['model.p.a', 'model.p.b', 'test.p.t']);
  assert.deepEqual(previous.nodes.get('model.p.a'), { ms: 70, outcome: 'error' });
  assert.deepEqual((await store.previousRun('/p', 'build', 3500)).nodes.get('test.p.t'), { ms: null, outcome: 'error' });
  assert.equal(await store.previousRun('/p', 'build', 50), null);
  assert.equal(await store.previousRun('/other', 'build', 9999), null);

  const stats = await store.stats('/p');
  assert.deepEqual(stats.flaky, [{ id: 'test.p.t', name: 't', fails: 2, runs: 3 }]);
  assert.deepEqual(stats.slow[0], { id: 'model.p.b', name: 'b', materialization: 'table', ms: 85000 });
  assert.equal(stats.slow.length, 5);
});

test('saveRun keeps only the newest ten runs and their nodes per project', async (t) => {
  const store = createStore({ dir: tempDir(t) });
  for (let i = 0; i < 12; i += 1) await store.saveRun('/p', run(`t${i}`, 1000 + i, [node('model.p.a', 'success', i, 1)]));
  await store.saveRun('/q', run('q0', 1, [node('model.q.a', 'success', 1, 1)]));
  assert.equal(await store.previousRun('/p', 'build', 1002), null);
  assert.equal((await store.previousRun('/p', 'build', 1003)).id, 't2');
  assert.equal((await store.previousRun('/q', 'build', 2)).id, 'q0');
});
