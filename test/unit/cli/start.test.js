import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { applySelection, openStore, run, runDbt, start } from '../../../src/cli/start.js';
import { artifactsDir } from '../../../src/dbt/base.js';
import { FIXTURE, tempDir, writeFile } from '../../helpers/fixture.js';

const noStore = async () => null;
const fakeStore = async () => ({ file: '/tmp/h.duckdb', saveRun: async () => {}, previousRun: async () => null, stats: async () => ({}) });

function fakeChild() {
  return Object.assign(new EventEmitter(), { kill() {} });
}

function project(t) {
  const dir = tempDir(t);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function options(dir, extra = {}) {
  return { host: '127.0.0.1', open: false, port: 0, portExplicit: true, projectDirs: [dir], command: [], ...extra };
}

function getState(url) {
  return new Promise((resolve, reject) => {
    http.get(`${url}api/state`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('openStore loads the DuckDB store, or returns null when it cannot', async (t) => {
  const store = await openStore({ env: { DBT_SUGAR_HOME: tempDir(t) } });
  assert.match(store.file, /history\.duckdb$/);
  assert.equal(await openStore({ env: {}, load: async () => { throw new Error('no binding'); } }), null);
});

test('runDbt sets DBT_OTEL_FILE_NAME unless given, and reports one exit code', () => {
  const calls = [];
  const exits = [];
  const child = fakeChild();
  runDbt(['dbt', 'build'], { cwd: '/p', env: { A: '1' }, logDir: '/p/logs', now: () => 42, spawn: (cmd, args, opts) => (calls.push([cmd, args, opts]), child), onExit: (c) => exits.push(c) });
  assert.deepEqual(calls[0].slice(0, 2), ['dbt', ['build']]);
  assert.equal(calls[0][2].env.DBT_OTEL_FILE_NAME, 'otel.jsonl');
  assert.equal(calls[0][2].env.DBT_LOG_PATH, path.join('/p/logs', `sugar-42-${process.pid}`));
  assert.equal(calls[0][2].cwd, '/p');
  child.emit('exit', null);
  child.emit('exit', 0);
  assert.deepEqual(exits, [1]);
  const other = fakeChild();
  runDbt(['dbt'], { cwd: '/p', env: { DBT_OTEL_FILE_NAME: 'otel-1.jsonl', DBT_LOG_PATH: '/own/logs' }, spawn: (cmd, args, opts) => (calls.push([cmd, args, opts]), other), onExit: (c) => exits.push(c) });
  assert.equal(calls[1][2].env.DBT_OTEL_FILE_NAME, 'otel-1.jsonl');
  assert.equal(calls[1][2].env.DBT_LOG_PATH, '/own/logs');
  runDbt(['dbt'], { cwd: '/p', env: {}, logDir: '/p/logs', spawn: (cmd, args, opts) => (calls.push([cmd, args, opts]), fakeChild()), onExit() {} });
  assert.match(calls[2][2].env.DBT_LOG_PATH, /sugar-\d+-\d+$/);
  other.emit('error', new Error('ENOENT'));
  assert.deepEqual(exits, [1, 127]);
});

test('start serves the snapshot of the watched project and refreshes on file changes', async (t) => {
  const dir = project(t);
  const logs = [];
  const opened = [];
  const app = await start(options(dir, { open: true }), { env: {}, log: (l) => logs.push(l), open: (u) => opened.push(u), store: noStore });
  t.after(() => app.close());
  assert.deepEqual(opened, [app.url]);
  assert.match(logs.join('\n'), /dbt sugar is open at http:\/\/127\.0\.0\.1:\d+\/[\s\S]*history: off/);
  const state = await getState(app.url);
  assert.equal(state.projects[0].runs[0].counts.error, 1);
  writeFile(path.join(dir, 'logs', 'otel-2.jsonl'), '{"record_type":"SpanStart","trace_id":"t2","event_type":"v1.public.events.fusion.invocation.Invocation","start_time_unix_nano":"1794738299000000000","attributes":{"eval_args":{"command":"run"}}}\n');
  await Promise.all([app.refresh(), app.refresh()]);
  await sleep(400);
  assert.equal((await getState(app.url)).projects[0].runs[0].command, 'run');
});

test('start wraps a dbt command and keeps serving after it exits', async (t) => {
  const dir = project(t);
  const logs = [];
  const children = [];
  const spawn = () => {
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const app = await start(options(dir, { command: ['dbt', 'build'], host: '::1' }), { env: {}, log: (l) => logs.push(l), spawn, store: fakeStore });
  t.after(() => app.close());
  assert.match(app.url, /^http:\/\/\[::1\]:\d+\/$/);
  assert.match(logs.join('\n'), /history: \/tmp\/h\.duckdb/);
  children[0].emit('exit', 2);
  assert.equal(app.exitCode, 2);
  assert.match(logs.at(-1), /dbt exited with 2; the page stays open/);
  const failing = await start(options(dir, { command: ['nope'] }), { env: {}, log: (l) => logs.push(l), spawn, store: noStore });
  t.after(() => failing.close());
  children[1].emit('error', new Error('ENOENT'));
  assert.match(logs.at(-1), /could not start "nope"/);
});

test('start falls back to the next port unless the port was explicit', async (t) => {
  const dir = project(t);
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const busy = blocker.address().port;
  const app = await start(options(dir, { port: busy, portExplicit: false }), { env: {}, log() {}, store: noStore });
  t.after(() => app.close());
  assert.equal(app.port, busy + 1);
  await assert.rejects(start(options(dir, { port: busy }), { env: {}, log() {}, store: noStore }), { code: 'EADDRINUSE' });
  await assert.rejects(start(options(dir, { port: 70000, portExplicit: false }), { env: {}, log() {}, store: noStore }), { code: 'ERR_SOCKET_BAD_PORT' });
});

test('run prints usage, help, version, busy ports, and exits with the dbt code on SIGINT', async (t) => {
  const out = [];
  const err = [];
  const exits = [];
  const deps = { log: (l) => out.push(l), error: (l) => err.push(l), exit: (c) => exits.push(c), store: noStore, env: {} };
  await run(['--port', 'x'], deps);
  assert.match(err[0], /^sugar: --port must be/);
  await run(['-h'], deps);
  await run(['-v'], { ...deps, version: '9.9.9' });
  assert.match(out[0], /Usage: sugar/);
  assert.equal(out[1], '9.9.9');
  const dir = project(t);
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  await run(['-d', dir, '--no-open', '-p', String(blocker.address().port)], deps);
  assert.match(err.at(-1), /port \d+ is busy; try --port 0/);
  await run(['-d', path.join(dir, 'missing'), '--no-open', '-p', '70000'], deps);
  assert.match(err.at(-1), /--port must be 0-65535/);
  const app = await run(['-d', dir, '--no-open', '-p', '0'], deps);
  app.exitCode = 3;
  process.emit('SIGINT');
  await sleep(50);
  app.exitCode = null;
  process.emit('SIGTERM');
  await sleep(50);
  assert.deepEqual(exits, [2, 1, 2, 3, 0]);
});

test('run reports unexpected start failures', async () => {
  const err = [];
  const exits = [];
  await run(['--no-open'], { log() {}, error: (l) => err.push(l), exit: (c) => exits.push(c), store: async () => { throw new Error('kaput'); } });
  assert.deepEqual(exits, [1]);
  assert.equal(err[0], 'sugar: kaput');
});

async function waitForDiff(url, done) {
  for (let i = 0; i < 50; i += 1) {
    const diff = (await getState(url)).projects[0].diff;
    if (done(diff)) return diff;
    await sleep(100);
  }
  throw new Error('diff never settled');
}

function request(url, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-sugar-token': token } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function gitRepo(dir) {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature/x');
  return git('rev-parse', 'main');
}

test('applySelection routes select and build to the right project and rejects bad input', () => {
  const calls = [];
  const sources = [{ dir: '/p', selectDiff: (x) => (calls.push(['select', x]), true), buildDiff: (x) => (calls.push(['build', x]), true) }];
  assert.equal(applySelection(sources), false);
  assert.equal(applySelection(sources, { project: '/other' }), false);
  assert.equal(applySelection(sources, { project: '/p', base: 'main', head: 'feature/x' }), true);
  assert.equal(applySelection(sources, { project: '/p', action: 'build', side: 'head' }), true);
  assert.equal(applySelection(sources, { project: '/p', base: '--upload-pack=evil' }), false);
  assert.equal(applySelection(sources, { project: '/p', head: 42 }), false);
  assert.equal(applySelection(sources, { project: '/p', action: 'drop' }), false);
  assert.deepEqual(calls, [['select', { base: 'main', head: 'feature/x' }], ['build', 'head']]);
});

test('start diffs against cached base artifacts in git, accepts page actions with the token, and errors outside a repo', async (t) => {
  const dir = project(t);
  const home = tempDir(t);
  const sha = gitRepo(dir);
  writeFile(path.join(artifactsDir(path.join(home, 'base'), dir, sha), 'manifest.json'), fs.readFileSync(path.join(FIXTURE, 'base', 'manifest.json'), 'utf8'));
  const app = await start(options(dir, { diff: {} }), { env: { DBT_SUGAR_HOME: home }, log() {}, store: noStore });
  t.after(() => app.close());
  const ready = await waitForDiff(app.url, (d) => d?.status === 'ready' && d.git);
  assert.equal(ready.result.summary.modified, 3);
  assert.equal(ready.git.current, 'feature/x');
  const token = /name="sugar-token" content="([a-f0-9]+)"/.exec((await request(app.url)).text)[1];
  assert.equal((await request(`${app.url}api/diff`, { method: 'POST', token, body: JSON.stringify({ project: dir, action: 'build', side: 'base' }) })).status, 200);
  assert.equal((await request(`${app.url}api/diff`, { method: 'POST', token, body: JSON.stringify({ project: '/nope' }) })).status, 400);
  const outside = await start(options(tempDir(t), { diff: {} }), { env: { DBT_SUGAR_HOME: tempDir(t) }, log() {}, store: noStore });
  t.after(() => outside.close());
  const failed = await waitForDiff(outside.url, (d) => d?.status === 'error');
  assert.match(failed.error, /none of origin\/main/);
});
