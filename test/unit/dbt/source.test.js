import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { artifactsDir } from '../../../src/dbt/base.js';
import { createDbtSource } from '../../../src/dbt/source.js';
import { FIXTURE, tempDir, writeFile } from '../../helpers/fixture.js';

const SHAS = { main: 'aaaa1111', 'feature/x': 'bbbb2222' };

function fakeGit({ broken = false } = {}) {
  return async (cmd, args) => {
    if (broken) throw new Error('not a repo');
    if (args.includes('symbolic-ref')) throw new Error('no origin');
    if (args.includes('--abbrev-ref')) return { stdout: 'feature/x\n' };
    if (args.includes('for-each-ref')) return { stdout: 'refs/heads/feature/x\nrefs/heads/main\n' };
    const ref = args.at(-1).replace('^{commit}', '');
    if (SHAS[ref]) return { stdout: `${SHAS[ref]}\n` };
    throw new Error('missing');
  };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test('a source reads otel, manifest and log from the project folders', () => {
  const source = createDbtSource({ projectDir: FIXTURE, env: {} });
  assert.equal(source.name, 'jaffle');
  assert.deepEqual(source.watchDirs(), [FIXTURE, path.join(FIXTURE, 'logs'), path.join(FIXTURE, 'target')]);
  const data = source.read();
  assert.equal(data.found, true);
  assert.equal(data.runs[0].total, 53);
  assert.equal(data.manifest.project, 'jaffle_shop');
  assert.ok(data.log.get('01a1debb-736e-7cc2-8cea-197f353bfa6b').length > 0);
});

test('DBT_LOG_PATH and DBT_TARGET_PATH move the folders it reads; no diff means no base, head or git', () => {
  const source = createDbtSource({ projectDir: FIXTURE, env: { DBT_LOG_PATH: 'other-logs', DBT_TARGET_PATH: '/abs/target' } });
  assert.equal(source.logDir, path.join(FIXTURE, 'other-logs'));
  assert.equal(source.targetDir, '/abs/target');
  assert.deepEqual(source.read(), { found: false, runs: [], manifest: null, log: new Map(), untracked: null, base: null, head: null, git: null });
  assert.equal(source.selectDiff({ base: 'main' }), false);
  assert.equal(source.buildDiff('base'), false);
  assert.equal(createDbtSource({ projectDir: FIXTURE }).logDir, path.resolve(FIXTURE, process.env.DBT_LOG_PATH || 'logs'));
});

test('with a diff, read() reports git branches, the base, and a selected head; artifacts build on request', async (t) => {
  const cacheDir = tempDir(t);
  let clock = 0;
  let changes = 0;
  const source = createDbtSource({ projectDir: FIXTURE, env: {}, diff: { cacheDir, exec: fakeGit() }, now: () => clock, onChange: () => (changes += 1) });
  assert.equal(source.read().git, null);
  await source.refreshGit();
  await tick();
  const first = source.read();
  assert.deepEqual(first.git, { current: 'feature/x', branches: ['feature/x', 'main'], base: 'main' });
  assert.deepEqual([first.base.status, first.base.ref], ['missing', 'main']);
  assert.deepEqual([first.head.status, first.head.ref, first.head.source], ['ready', null, 'target']);
  writeFile(path.join(artifactsDir(cacheDir, FIXTURE, SHAS['feature/x']), 'manifest.json'), fs.readFileSync(path.join(FIXTURE, 'target', 'manifest.json'), 'utf8'));
  assert.equal(source.selectDiff({ base: 'main', head: 'feature/x' }), true);
  source.read();
  await tick();
  const picked = source.read();
  assert.equal(picked.head.status, 'ready');
  assert.equal(picked.head.ref, 'feature/x');
  assert.equal(source.buildDiff('nope'), false);
  assert.equal(source.buildDiff('head'), true);
  assert.equal(source.buildDiff('base'), true);
  assert.equal(source.selectDiff({}), true);
  await tick();
  assert.equal(source.read().head.ref, null);
  assert.equal(source.buildDiff('head'), true);
  clock = 30000;
  source.read();
  await tick();
  assert.ok(changes >= 3);
});

test('git info is null when git fails', async (t) => {
  const source = createDbtSource({ projectDir: tempDir(t), env: {}, diff: { cacheDir: tempDir(t), exec: fakeGit({ broken: true }) } });
  await source.refreshGit();
  assert.equal(source.read().git, null);
});

test('a git diff outside a repo resolves to an error through the default onChange and clock', async (t) => {
  const source = createDbtSource({ projectDir: tempDir(t), env: {}, diff: { cacheDir: tempDir(t) } });
  assert.equal(source.read().base.status, 'resolving');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(source.read().base.status, 'error');
});

test('finished runs are archived and come back after the log is gone, live runs first and no duplicates', (t) => {
  const archiveRoot = tempDir(t);
  const live = createDbtSource({ projectDir: FIXTURE, env: {}, archiveRoot });
  const first = live.read();
  assert.equal(first.runs.length, 1);
  assert.equal(live.read().runs.length, 1);
  const later = createDbtSource({ projectDir: FIXTURE, env: { DBT_LOG_PATH: tempDir(t) }, archiveRoot });
  const restored = later.read();
  assert.equal(restored.found, false);
  assert.deepEqual(restored.runs.map((r) => r.id), [first.runs[0].id]);
  assert.equal(restored.runs[0].nodes.size, 53);
  const both = createDbtSource({ projectDir: FIXTURE, env: {}, archiveRoot });
  assert.deepEqual(both.read().runs.map((r) => r.id), [first.runs[0].id]);
});

test('runs and logs in per-process subfolders of logs/ are read, watched and archived', (t) => {
  const dir = tempDir(t);
  const sub = path.join(dir, 'logs', 'sugar-1');
  fs.mkdirSync(sub, { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'logs', 'otel.jsonl'), path.join(sub, 'otel.jsonl'));
  fs.copyFileSync(path.join(FIXTURE, 'logs', 'dbt.log'), path.join(sub, 'dbt.log'));
  const source = createDbtSource({ projectDir: dir, env: {}, archiveRoot: tempDir(t) });
  assert.ok(source.watchDirs().includes(sub));
  const data = source.read();
  assert.equal(data.runs.length, 1);
  assert.ok(data.log.get(data.runs[0].invocationId).length > 0);
  assert.ok(data.runs[0].log.length > 0);
});

function copyProject(t, { otel = (text) => text } = {}) {
  const dir = tempDir(t);
  writeFile(path.join(dir, 'logs', 'otel.jsonl'), otel(fs.readFileSync(path.join(FIXTURE, 'logs', 'otel.jsonl'), 'utf8')));
  writeFile(path.join(dir, 'logs', 'dbt.log'), fs.readFileSync(path.join(FIXTURE, 'logs', 'dbt.log'), 'utf8'));
  writeFile(path.join(dir, 'target', 'manifest.json'), fs.readFileSync(path.join(FIXTURE, 'target', 'manifest.json'), 'utf8'));
  return dir;
}

test('a newer dbt.log invocation without an OTel run is reported as untracked', (t) => {
  const dir = copyProject(t);
  const source = createDbtSource({ projectDir: dir, env: {} });
  assert.equal(source.read().untracked, null);
  const log = path.join(dir, 'logs', 'dbt.log');
  fs.appendFileSync(log, '==================== 2026-11-15T13:25:36Z | manual ====================\n10:00:00.000000 [info ]: dbt 2.0.11\n');
  assert.equal(source.read().untracked.invocationId, 'manual');
  const sub = path.join(dir, 'logs', 'sugar-1', 'dbt.log');
  writeFile(sub, '==================== 2026-11-15T13:30:00Z | later ====================\n10:00:00.000000 [info ]: dbt 2.0.11\n');
  fs.utimesSync(sub, new Date(), new Date(Date.now() + 60000));
  assert.equal(source.read().untracked.invocationId, 'later');
  fs.rmSync(sub);
  fs.utimesSync(log, 0, 0);
  fs.appendFileSync(path.join(dir, 'logs', 'otel.jsonl'), '');
  assert.equal(createDbtSource({ projectDir: dir, env: {} }).read().untracked, null);
});

test('the diff parse reuses the profiles dir and target of the latest run unless sugar was given its own', async (t) => {
  const dir = copyProject(t, { otel: (text) => text.replaceAll('"profiles_dir":"/home/dev/.dbt"', '"profiles_dir":"/p","target":"ci"') });
  const parses = [];
  const exec = async (cmd, args, options) => {
    if (cmd === 'dbt') return parses.push(options.env);
    return fakeGit()(cmd, args);
  };
  const follow = createDbtSource({ projectDir: dir, env: {}, diff: { cacheDir: tempDir(t), exec } });
  follow.read();
  follow.buildDiff('head');
  await tick();
  assert.deepEqual([parses[0].DBT_PROFILES_DIR, parses[0].DBT_TARGET], ['/p', 'ci']);
  const own = createDbtSource({ projectDir: dir, env: { DBT_PROFILES_DIR: '/mine', DBT_TARGET: 'dev' }, diff: { cacheDir: tempDir(t), exec } });
  own.read();
  own.buildDiff('head');
  await tick();
  assert.deepEqual([parses[1].DBT_PROFILES_DIR, parses[1].DBT_TARGET], ['/mine', 'dev']);
});
