import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { artifactsDir, createBaseResolver, createWorktreeResolver, defaultRefs, gitInfo, parseAt, REF, resolveRef } from '../../../src/dbt/base.js';
import { parseManifest } from '../../../src/dbt/manifest.js';
import { FIXTURE, tempDir, writeFile } from '../../helpers/fixture.js';

const MANIFEST = fs.readFileSync(path.join(FIXTURE, 'base', 'manifest.json'), 'utf8');

function failure(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function fakeGit({ root, refs = { main: 'abc123' }, originHead = null, parse = 'ok', removeFails = false, calls = [] }) {
  return async (cmd, args, options) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git' && args.includes('symbolic-ref')) {
      if (originHead) return { stdout: `${originHead}\n` };
      throw failure('no origin head');
    }
    if (cmd === 'git' && args.includes('--verify')) {
      const ref = args.at(-1).replace('^{commit}', '');
      if (refs[ref]) return { stdout: `${refs[ref]}\n` };
      throw failure('missing');
    }
    if (cmd === 'git' && args.includes('--show-toplevel')) return { stdout: `${root}\n` };
    if (cmd === 'git' && args.includes('add')) {
      fs.mkdirSync(path.join(args.at(-2), 'proj'), { recursive: true });
      return { stdout: '' };
    }
    if (cmd === 'git' && args.includes('remove')) {
      if (removeFails) throw failure('locked');
      return { stdout: '' };
    }
    if (cmd === 'git') throw failure(`unhandled git ${args.join(' ')}`);
    const out = args[args.indexOf('--target-path') + 1];
    if (parse === 'ok' || parse === 'partial') writeFile(path.join(out, 'manifest.json'), MANIFEST);
    if (parse === 'ok') return { stdout: '', options };
    throw failure('exit 1', { stderr: 'Error: one\nError: two\n', stdout: '' });
  };
}

function project(t) {
  const root = tempDir(t);
  const dir = path.join(root, 'proj');
  fs.mkdirSync(path.join(dir, 'dbt_packages'), { recursive: true });
  return { root, dir };
}

function realGit(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-C', dir, ...args], { encoding: 'utf8' }).trim();
}

test('REF accepts branch names and rejects options or odd characters', () => {
  for (const ok of ['main', 'origin/main', 'feature/x-1.2', 'v1_0']) assert.ok(REF.test(ok), ok);
  for (const bad of ['-x', '--upload-pack=x', 'a b', '', 'a;b']) assert.ok(!REF.test(bad), bad);
});

test('resolveRef tries origin/HEAD then the usual base branches, or the one asked for', async () => {
  const exec = fakeGit({ root: '/r', refs: { main: 'abc', 'origin/develop': 'dev1' } });
  assert.deepEqual(await resolveRef('/r', null, exec), { ref: 'main', sha: 'abc' });
  assert.deepEqual(await resolveRef('/r', null, fakeGit({ root: '/r', refs: { main: 'abc', 'origin/develop': 'dev1' }, originHead: 'origin/develop' })), { ref: 'origin/develop', sha: 'dev1' });
  await assert.rejects(resolveRef('/r', 'dev', exec), /git ref "dev" not found/);
  await assert.rejects(resolveRef('/r', null, fakeGit({ root: '/r', refs: {} })), /pick a base branch/);
});

test('real git: defaultRefs, gitInfo and resolveRef on a temp repo', async (t) => {
  const dir = tempDir(t);
  await assert.rejects(resolveRef(dir, null), /none of origin\/main/);
  await assert.rejects(gitInfo(dir));
  realGit(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  realGit(dir, 'add', '.');
  realGit(dir, 'commit', '-q', '-m', 'a');
  realGit(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  realGit(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  realGit(dir, 'checkout', '-q', '-b', 'feature/x');
  assert.deepEqual(await defaultRefs(dir), ['origin/main', 'main', 'origin/master', 'master']);
  const info = await gitInfo(dir);
  assert.equal(info.current, 'feature/x');
  assert.deepEqual(info.branches.sort(), ['feature/x', 'main', 'origin/main']);
  assert.equal(info.base, 'origin/main');
  const sha = realGit(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(await resolveRef(dir, 'main'), { ref: 'main', sha });
});

test('gitInfo reports no base when none of the usual branches exist', async () => {
  const exec = async (cmd, args) => {
    if (args.includes('--abbrev-ref')) return { stdout: 'solo\n' };
    if (args.includes('for-each-ref')) return { stdout: 'refs/heads/solo\nrefs/remotes/origin/HEAD\nrefs/heads/bad name\n\n' };
    throw failure('nope');
  };
  assert.deepEqual(await gitInfo('/r', exec), { current: 'solo', branches: ['solo'], base: null });
});

test('parseAt parses a commit in a throwaway worktree, links packages, and always removes the worktree', async (t) => {
  const { root, dir } = project(t);
  const calls = [];
  const out = path.join(tempDir(t), 'out');
  assert.equal(await parseAt({ dir, sha: 'abc1234', out, env: { A: '1' }, exec: fakeGit({ root, calls }) }), null);
  assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
  const parse = calls.find((c) => c[0] === 'dbt');
  assert.deepEqual(parse.slice(0, 2), ['dbt', 'parse']);
  assert.ok(calls.some((c) => c.includes('remove')));
  const partial = await parseAt({ dir, sha: 'abc1234', out: path.join(tempDir(t), 'p'), env: {}, exec: fakeGit({ root, parse: 'partial' }), dbt: 'dbtf' });
  assert.match(partial, /errors at abc1234; the diff may be partial:\nError: one\nError: two/);
  await assert.rejects(parseAt({ dir, sha: 'abc1234', out: path.join(tempDir(t), 'f'), env: {}, exec: fakeGit({ root, parse: 'fail', removeFails: true }) }), /dbt parse failed at abc1234:\nError: one/);
  const noProfile = failure('exit 1', { stderr: "[error] [IoError (dbt1001)]: Profile 'shop' not found in profiles.yml\n  --> dbt_project.yml:10:10\n\n==== Execution Summary ====\nFinished 'parse' with 1 error\n", stdout: 'dbt 2.0.11\n' });
  const profileless = async (cmd, args) => (cmd === 'dbt' ? Promise.reject(noProfile) : fakeGit({ root })(cmd, args));
  await assert.rejects(parseAt({ dir, sha: 'abc1234', out: path.join(tempDir(t), 'h'), env: {}, exec: profileless }), (error) => {
    assert.equal(error.message, "dbt parse failed at abc1234:\n[error] [IoError (dbt1001)]: Profile 'shop' not found in profiles.yml\n  --> dbt_project.yml:10:10\nStart sugar with DBT_PROFILES_DIR set to the folder holding that profile; sugar runs dbt parse with its own environment, not your --profiles-dir flag.");
    return true;
  });
  noProfile.stderr = "[error] last one\n";
  await assert.rejects(parseAt({ dir, sha: 'abc1234', out: path.join(tempDir(t), 'i'), env: {}, exec: profileless }), /failed at abc1234:\n\[error\] last one$/);
  const bare = async (cmd, args) => (cmd === 'dbt' ? Promise.reject(failure('spawn dbt ENOENT')) : fakeGit({ root })(cmd, args));
  await assert.rejects(parseAt({ dir, sha: 'abc1234', out: path.join(tempDir(t), 'g'), env: {}, exec: bare }), /spawn dbt ENOENT/);
});

test('artifactsDir keys the cache by commit and project path', () => {
  assert.equal(artifactsDir('/c', '/a/b c', 'sha'), path.join('/c', 'sha', '_a_b_c'));
});

test('a base starts missing, builds on request, caches by commit, and rechecks every 30s', async (t) => {
  const { root, dir } = project(t);
  const cacheDir = tempDir(t);
  let clock = 0;
  let changes = 0;
  const refs = { main: 'sha1aaaa' };
  const calls = [];
  const resolver = createBaseResolver({ dir, cacheDir, env: { DBT_BIN: 'dbtf' }, exec: fakeGit({ root, refs, calls }), now: () => clock, onChange: () => (changes += 1) });
  assert.equal(resolver.read().status, 'resolving');
  assert.equal(resolver.read().status, 'resolving');
  await resolver.refresh();
  const missing = resolver.read();
  assert.deepEqual([missing.status, missing.ref, missing.sha, missing.manifest], ['missing', 'main', 'sha1aaaa', null]);
  assert.equal(missing.out, artifactsDir(cacheDir, dir, 'sha1aaaa'));
  const parses = () => calls.filter((c) => c[0] === 'dbtf').length;
  assert.equal(parses(), 0);
  const building = resolver.build();
  assert.equal(resolver.build(), building);
  await building;
  const ready = resolver.read();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.warning, null);
  assert.ok(ready.manifest.nodes.size > 0);
  assert.equal(parses(), 1);
  await resolver.build();
  assert.equal(parses(), 1);
  assert.ok(changes >= 4);
  clock = 30000;
  resolver.read();
  await resolver.refresh();
  refs.main = undefined;
  await resolver.refresh();
  assert.equal(resolver.read().status, 'error');
  assert.match(resolver.read().error, /none of/);
  await resolver.build();
  assert.equal(resolver.read().status, 'error');
  refs.main = 'sha1aaaa';
  await resolver.refresh();
  assert.equal(resolver.read().status, 'ready');
  const other = createBaseResolver({ dir, cacheDir, ref: 'main', exec: fakeGit({ root, refs }) });
  await other.refresh();
  assert.deepEqual([other.read().status, other.read().ref], ['ready', 'main']);
});

test('a partial parse keeps its warning across rechecks; a failed parse is an error', async (t) => {
  const { root, dir } = project(t);
  const partial = createBaseResolver({ dir, cacheDir: tempDir(t), env: {}, exec: fakeGit({ root, parse: 'partial' }) });
  await partial.build();
  assert.equal(partial.read().status, 'ready');
  assert.match(partial.read().warning, /may be partial/);
  await partial.refresh();
  assert.match(partial.read().warning, /may be partial/);
  const failing = createBaseResolver({ dir, cacheDir: tempDir(t), env: {}, exec: fakeGit({ root, parse: 'fail' }) });
  await failing.build();
  assert.equal(failing.read().status, 'error');
  assert.match(failing.read().error, /dbt parse failed at abc123/);
});

test('defaults: process env, real git and the clock', (t) => {
  const resolver = createBaseResolver({ dir: tempDir(t), cacheDir: tempDir(t) });
  assert.equal(resolver.read().status, 'resolving');
});

test('the working tree uses target/manifest.json, else parses into the sugar cache on request, never into the project', async (t) => {
  const dir = tempDir(t);
  const cacheDir = tempDir(t);
  const calls = [];
  let changes = 0;
  const resolver = createWorktreeResolver({ dir, env: { DBT_OTEL_FILE_NAME: 'otel.jsonl', KEEP: '1' }, cacheDir, exec: fakeGit({ root: dir, calls }), onChange: () => (changes += 1) });
  const target = parseManifest(JSON.parse(MANIFEST));
  const fromTarget = resolver.read(target);
  assert.deepEqual([fromTarget.status, fromTarget.source, fromTarget.ref, fromTarget.manifest], ['ready', 'target', null, target]);
  const missing = resolver.read(null);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.out, path.join(cacheDir, 'worktree', path.resolve(dir).replace(/[^A-Za-z0-9]+/g, '_')));
  const building = resolver.build();
  assert.equal(resolver.build(), building);
  assert.equal(resolver.read(null).status, 'parsing');
  await building;
  const parsed = resolver.read(null);
  assert.deepEqual([parsed.status, parsed.source, parsed.warning], ['ready', 'sugar', null]);
  const [cmd, ...args] = calls.at(-1);
  assert.equal(cmd, 'dbt');
  assert.deepEqual(args.slice(0, 7), ['parse', '--project-dir', dir, '--target-path', missing.out, '--log-path', path.join(missing.out, 'logs')]);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.ok(changes >= 2);
  const partial = createWorktreeResolver({ dir, env: {}, cacheDir: tempDir(t), exec: fakeGit({ root: dir, parse: 'partial' }) });
  await partial.build();
  assert.match(partial.read(null).warning, /errors at the working tree; the diff may be partial/);
  const broken = createWorktreeResolver({ dir, cacheDir: tempDir(t), exec: fakeGit({ root: dir, parse: 'fail' }) });
  await broken.build();
  assert.match(broken.read(null).error, /dbt parse failed at the working tree:\nError: one/);
});

test('a re-parse that fails does not reuse the previous manifest', async (t) => {
  const dir = tempDir(t);
  const cacheDir = tempDir(t);
  let mode = 'ok';
  const exec = (cmd, args) => fakeGit({ root: dir, parse: mode })(cmd, args);
  const resolver = createWorktreeResolver({ dir, env: {}, cacheDir, exec });
  await resolver.build();
  assert.equal(resolver.read(null).status, 'ready');
  mode = 'fail';
  await resolver.build();
  assert.equal(resolver.read(null).status, 'error');
});
