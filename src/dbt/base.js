import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createManifestReader } from './manifest.js';

const DEFAULT_REFS = ['origin/main', 'main', 'origin/master', 'master'];
const RECHECK_MS = 30000;
const LINKED = ['dbt_packages', 'dbt_internal_packages'];

const run = promisify(execFile);

function tail(error) {
  const text = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim() || error.message;
  const lines = text.split('\n').filter((l) => l.trim());
  const first = lines.findIndex((l) => l.startsWith('[error]'));
  const end = lines.findIndex((l, i) => i > first && /^\S/.test(l) && !l.startsWith('[error]'));
  const picked = first < 0 ? lines.slice(-4) : lines.slice(first, end < 0 ? undefined : end).slice(0, 6);
  const hint = /Profile '.+' not found/.test(text) ? ['Start sugar with DBT_PROFILES_DIR set to the folder holding that profile; sugar runs dbt parse with its own environment, not your --profiles-dir flag.'] : [];
  return [...picked, ...hint].join('\n');
}

export const REF = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/;

async function git(exec, dir, args) {
  const { stdout } = await exec('git', ['-C', dir, ...args]);
  return stdout.trim();
}

export async function defaultRefs(dir, exec = run) {
  const head = await git(exec, dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  return [...new Set([head, ...DEFAULT_REFS].filter(Boolean))];
}

export async function gitInfo(dir, exec = run) {
  const current = await git(exec, dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const listed = await git(exec, dir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  const branches = listed.split('\n').filter((r) => !r.endsWith('/HEAD')).map((r) => r.replace(/^refs\/(heads|remotes)\//, '')).filter((b) => REF.test(b));
  return { current, branches, base: (await resolveRef(dir, null, exec).catch(() => null))?.ref ?? null };
}

export async function resolveRef(dir, ref, exec = run) {
  for (const candidate of ref ? [ref] : await defaultRefs(dir, exec)) {
    try {
      const { stdout } = await exec('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
      return { ref: candidate, sha: stdout.trim() };
    } catch {
      continue;
    }
  }
  throw new Error(ref ? `git ref "${ref}" not found` : `none of ${DEFAULT_REFS.join(', ')} exists; pick a base branch`);
}

export async function runParse({ project, out, env, label, exec = run, dbt = 'dbt' }) {
  fs.rmSync(path.join(out, 'manifest.json'), { force: true });
  try {
    const { DBT_OTEL_FILE_NAME: _otel, ...rest } = env;
    await exec(dbt, ['parse', '--project-dir', project, '--target-path', out, '--log-path', path.join(out, 'logs')], { env: rest, cwd: project, maxBuffer: 16 * 1024 * 1024 });
    return null;
  } catch (error) {
    if (!fs.existsSync(path.join(out, 'manifest.json'))) throw new Error(`dbt parse failed at ${label}:\n${tail(error)}`);
    return `dbt parse reported errors at ${label}; the diff may be partial:\n${tail(error)}`;
  }
}

export async function parseAt({ dir, sha, out, env, exec = run, dbt = 'dbt' }) {
  const { stdout } = await exec('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  const root = stdout.trim();
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'sugar-base-'));
  await exec('git', ['-C', root, 'worktree', 'add', '--detach', '--force', tree, sha]);
  try {
    const project = path.join(tree, path.relative(root, fs.realpathSync(dir)));
    for (const name of LINKED) {
      if (fs.existsSync(path.join(dir, name)) && !fs.existsSync(path.join(project, name))) fs.symlinkSync(path.join(dir, name), path.join(project, name));
    }
    return await runParse({ project, out, env, label: sha.slice(0, 7), exec, dbt });
  } finally {
    await exec('git', ['-C', root, 'worktree', 'remove', '--force', tree]).catch(() => fs.rmSync(tree, { recursive: true, force: true }));
  }
}

function slug(dir) {
  return path.resolve(dir).replace(/[^A-Za-z0-9]+/g, '_');
}

export function artifactsDir(cacheDir, dir, sha) {
  return path.join(cacheDir, sha, slug(dir));
}

export function createWorktreeResolver({ dir, env = process.env, cacheDir, exec = run, onChange = () => {} }) {
  const out = path.join(cacheDir, 'worktree', slug(dir));
  const reader = createManifestReader(path.join(out, 'manifest.json'));
  const where = { ref: null, sha: null, out };
  let state = { status: 'idle', warning: null };
  let pending = null;

  async function build() {
    state = { status: 'parsing', warning: null };
    onChange();
    try {
      state = { status: 'idle', warning: await runParse({ project: dir, out, env, label: 'the working tree', exec, dbt: env.DBT_BIN || 'dbt' }) };
    } catch (error) {
      state = { status: 'error', error: error.message };
    }
    onChange();
  }

  return {
    build() {
      pending ??= build().finally(() => {
        pending = null;
      });
      return pending;
    },
    read(target) {
      if (state.status !== 'idle') return { ...where, ...state, manifest: null };
      if (target) return { ...where, status: 'ready', source: 'target', manifest: target, warning: null };
      const parsed = reader.read();
      return parsed ? { ...where, status: 'ready', source: 'sugar', manifest: parsed, warning: state.warning } : { ...where, status: 'missing', manifest: null };
    }
  };
}

export function createBaseResolver({ dir, env = process.env, ref = null, cacheDir, exec = run, now = Date.now, onChange = () => {} }) {
  let state = { status: 'resolving', ref: ref ?? 'main', sha: null, out: null };
  let checkedAt = -Infinity;
  let pending = null;
  let reader = null;

  async function check() {
    try {
      const target = await resolveRef(dir, ref, exec);
      const out = artifactsDir(cacheDir, dir, target.sha);
      const has = fs.existsSync(path.join(out, 'manifest.json'));
      reader = has ? createManifestReader(path.join(out, 'manifest.json')) : null;
      const warning = target.sha === state.sha ? (state.warning ?? null) : null;
      state = { status: has ? 'ready' : 'missing', ...target, out, warning };
    } catch (error) {
      state = { ...state, status: 'error', error: error.message };
    }
    onChange();
  }

  async function build() {
    await check();
    if (state.status !== 'missing') return;
    state = { ...state, status: 'parsing' };
    onChange();
    try {
      const warning = await parseAt({ dir, sha: state.sha, out: state.out, env, exec, dbt: env.DBT_BIN || 'dbt' });
      reader = createManifestReader(path.join(state.out, 'manifest.json'));
      state = { ...state, status: 'ready', warning };
    } catch (error) {
      state = { ...state, status: 'error', error: error.message };
    }
    onChange();
  }

  function once(work) {
    pending ??= work().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    refresh: () => once(check),
    build: () => once(build),
    read() {
      if (!pending && now() - checkedAt >= RECHECK_MS) {
        checkedAt = now();
        once(check);
      }
      if (state.status !== 'ready') return { ...state, manifest: null };
      return { ...state, manifest: reader.read() };
    }
  };
}
