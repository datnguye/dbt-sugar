import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createArchive, deserializeRun, KEEP_RUNS, logSlice, serializeRun } from '../../../src/dbt/archive.js';
import { tempDir, writeFile } from '../../helpers/fixture.js';

const LOG = ['==================== 2026-11-15T10:00:00Z | inv-a ====================', '10:00:00.100000 [info ]: a1', '10:00:00.200000 [warn ]: a2', '==================== 2026-11-15T10:05:00Z | inv-b ====================', '10:05:00.100000 [info ]: b1'].join('\n');

function run(n, extra = {}) {
  return { id: `trace-${n}`, invocationId: `inv-${n}`, command: 'build', startedAt: 1000 + n, endedAt: 2000 + n, status: 'success', total: 1, phases: [], messages: [], nodes: new Map([[`model.p.m${n}`, { id: `model.p.m${n}`, name: `m${n}`, outcome: 'success' }]]), ...extra };
}

function project(t) {
  const dir = tempDir(t);
  writeFile(path.join(dir, 'target', 'manifest.json'), JSON.stringify({ metadata: { invocation_id: 'inv-a' }, nodes: {} }));
  writeFile(path.join(dir, 'target', 'run_results.json'), JSON.stringify({ metadata: { invocation_id: 'inv-other' } }));
  writeFile(path.join(dir, 'logs', 'dbt.log'), LOG);
  return { dir, targetDir: path.join(dir, 'target'), logFile: path.join(dir, 'logs', 'dbt.log') };
}

test('serialize and deserialize keep every node', () => {
  const r = run(1);
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(r))));
  assert.deepEqual([...back.nodes.keys()], ['model.p.m1']);
  assert.equal(back.invocationId, 'inv-1');
});

test('logSlice cuts one invocation out of dbt.log', () => {
  assert.equal(logSlice(LOG, 'inv-a'), LOG.split('\n').slice(0, 3).join('\n'));
  assert.equal(logSlice(LOG, 'inv-b'), LOG.split('\n').slice(3).join('\n'));
  assert.equal(logSlice(LOG, 'nope'), null);
});

test('save stores run.json, matching artifacts and the log slice; running or repeated runs are skipped', (t) => {
  const p = project(t);
  const archive = createArchive({ root: tempDir(t), project: p.dir });
  assert.equal(archive.save(run('a', { status: 'running' }), p), false);
  const saved = run('a');
  assert.equal(archive.save(saved, p), true);
  assert.deepEqual(saved.log.map((e) => [e.level, e.text, e.inv]), [['info', 'a1', 'inv-a'], ['warn', 'a2', 'inv-a']]);
  assert.equal(archive.save(run('a'), p), false);
  const [folder] = fs.readdirSync(archive.dir);
  const files = fs.readdirSync(path.join(archive.dir, folder)).sort();
  assert.deepEqual(files, ['dbt.log', 'manifest.json', 'run.json']);
  assert.equal(archive.save(run('z'), { targetDir: path.join(p.dir, 'missing'), logFile: path.join(p.dir, 'missing.log') }), true);
  assert.deepEqual(fs.readdirSync(path.join(archive.dir, fs.readdirSync(archive.dir).find((f) => f.endsWith('trace-z')))), ['run.json']);
});

test('keeps only the newest invocations and reloads them after a restart', (t) => {
  const p = project(t);
  const root = tempDir(t);
  const archive = createArchive({ root, project: p.dir, keep: 3 });
  for (let n = 1; n <= 5; n += 1) archive.save(run(n), p);
  assert.equal(fs.readdirSync(archive.dir).length, 3);
  writeFile(path.join(archive.dir, '9999-broken', 'run.json'), '{not json');
  writeFile(path.join(archive.dir, 'notes.txt'), 'ignored');
  const reloaded = createArchive({ root, project: p.dir, keep: 4 });
  const runs = reloaded.load();
  assert.deepEqual(runs.map((r) => r.id), ['trace-5', 'trace-4', 'trace-3']);
  assert.equal(reloaded.save(run(5), p), false);
  assert.deepEqual(createArchive({ root: tempDir(t), project: p.dir }).load(), []);
  assert.equal(KEEP_RUNS, 10);
});
