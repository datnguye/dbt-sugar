import fs from 'node:fs';
import path from 'node:path';
import { createArchive, KEEP_RUNS } from './archive.js';
import { createBaseResolver, createWorktreeResolver, gitInfo } from './base.js';
import { createManifestReader } from './manifest.js';
import { createLogReader } from './logtail.js';
import { createOtelReader, filesIn, logDirs } from './otel.js';

const GIT_RECHECK_MS = 30000;

export function createDbtSource({ projectDir, env = process.env, diff = null, archiveRoot = null, onChange = () => {}, now = Date.now }) {
  const dir = path.resolve(projectDir);
  const logDir = path.resolve(dir, env.DBT_LOG_PATH || 'logs');
  const targetDir = path.resolve(dir, env.DBT_TARGET_PATH || 'target');
  const logReaders = new Map();
  const otel = createOtelReader(logDir);
  const archive = archiveRoot ? createArchive({ root: archiveRoot, project: dir }) : null;
  const archived = archive?.load() ?? [];
  const manifest = createManifestReader(path.join(targetDir, 'manifest.json'));
  const parseEnv = { ...env };
  let base = diff ? createBaseResolver({ dir, env: parseEnv, ...diff, onChange }) : null;
  let head = null;
  const worktree = diff ? createWorktreeResolver({ dir, env: parseEnv, ...diff, onChange }) : null;
  let git = null;
  let gitAt = -Infinity;
  let gitBusy = false;

  function readLogs() {
    const merged = new Map();
    const latest = [];
    for (const file of logDirs(logDir).flatMap((d) => filesIn(d, /^dbt\.log$/))) {
      if (!logReaders.has(file)) logReaders.set(file, createLogReader(file));
      const byInvocation = logReaders.get(file).read();
      for (const [inv, lines] of byInvocation) merged.set(inv, lines);
      const last = [...byInvocation.keys()].at(-1);
      if (last) latest.push({ invocationId: last, at: fs.statSync(file).mtimeMs });
    }
    return { merged, latest };
  }

  function followRun(run) {
    if (run?.profilesDir && !env.DBT_PROFILES_DIR) parseEnv.DBT_PROFILES_DIR = run.profilesDir;
    if (run?.target && !env.DBT_TARGET) parseEnv.DBT_TARGET = run.target;
  }

  function untrackedRun(runs, latest, newest) {
    const tracked = new Set(runs.map((r) => r.invocationId));
    return latest.filter((l) => !tracked.has(l.invocationId) && l.at > newest).sort((a, b) => a.at - b.at).at(-1) ?? null;
  }

  function refreshGit() {
    gitBusy = true;
    gitAt = now();
    return gitInfo(dir, diff.exec)
      .then(
        (info) => (git = info),
        () => (git = null)
      )
      .finally(() => {
        gitBusy = false;
        onChange();
      });
  }

  return {
    dir,
    name: path.basename(dir),
    logDir,
    targetDir,
    watchDirs: () => [dir, ...logDirs(logDir), targetDir],
    refreshGit,
    selectDiff({ base: baseRef = null, head: headRef = null }) {
      if (!diff) return false;
      base = createBaseResolver({ dir, env: parseEnv, ...diff, ref: baseRef, onChange });
      head = headRef ? createBaseResolver({ dir, env: parseEnv, ...diff, ref: headRef, onChange }) : null;
      onChange();
      return true;
    },
    buildDiff(side) {
      const resolver = side === 'head' ? (head ?? worktree) : side === 'base' ? base : null;
      if (!resolver) return false;
      resolver.build();
      return true;
    },
    read() {
      const { found, runs: live } = otel.poll();
      if (diff && !gitBusy && now() - gitAt >= GIT_RECHECK_MS) refreshGit();
      for (const run of live) if (archive?.save(run, { targetDir, logFile: path.join(path.dirname(run.file), 'dbt.log') })) archived.unshift(run);
      archived.splice(KEEP_RUNS);
      const ids = new Set(live.map((r) => r.id));
      const runs = [...live, ...archived.filter((r) => !ids.has(r.id))];
      const current = manifest.read();
      const { merged, latest } = readLogs();
      const newest = Math.max(-Infinity, ...runs.map((r) => r.startedAt));
      followRun(runs.find((r) => r.startedAt === newest));
      return { found, runs, manifest: current, log: merged, untracked: untrackedRun(runs, latest, newest), base: base?.read() ?? null, head: head?.read() ?? worktree?.read(current) ?? null, git };
    }
  };
}
