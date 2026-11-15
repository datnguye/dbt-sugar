import { diffManifests } from './diff.js';
import { runView } from './snapshot.js';
import { suggest } from './suggest.js';

const RECENT_RUNS = 10;

function byActivity(a, b) {
  const live = (r) => (r.status === 'running' ? 0 : 1);
  return live(a) - live(b) || b.startedAt - a.startedAt;
}

function safely(promise, fallback) {
  return promise.then(
    (value) => value,
    () => fallback
  );
}

function diffView({ base, head, git, manifest: worktree }, memo) {
  if (!base) return null;
  const { manifest: baseManifest, ...info } = base;
  const manifest = head ? head.manifest : worktree;
  const view = { ...info, side: 'base', head: head?.ref ? { ref: head.ref, sha: head.sha, status: head.status } : null, compareSource: head?.source ?? 'target', compareWarning: head?.warning ?? null, git, baseAt: baseManifest?.generatedAt ?? null, currentAt: manifest?.generatedAt ?? null, result: null };
  if (!baseManifest) return view;
  if (head && head.status !== 'ready') return { ...view, status: head.status, error: head.error, side: 'head', out: head.out, warning: head.warning };
  if (!manifest) return { ...view, status: 'error', error: 'no target/manifest.json yet: run dbt parse or dbt build' };
  if (memo.base !== baseManifest || memo.current !== manifest) Object.assign(memo, { base: baseManifest, current: manifest, result: diffManifests(baseManifest, manifest) });
  return { ...view, result: memo.result };
}

export function createSnapshotBuilder({ sources, store = null, now = Date.now }) {
  const saved = new Set();
  const memos = new Map(sources.map((source) => [source, {}]));

  async function project(source) {
    const data = source.read();
    for (const run of data.runs.filter((r) => r.status !== 'running' && !saved.has(r.id))) {
      saved.add(run.id);
      if (store) await safely(store.saveRun(source.dir, run), null);
    }
    const ordered = [...data.runs].sort(byActivity).slice(0, RECENT_RUNS);
    const runs = [];
    for (const run of ordered) {
      const previous = store ? await safely(store.previousRun(source.dir, run.command, run.startedAt), null) : null;
      runs.push({ ...runView(run, { manifest: data.manifest, previous }), log: run.log ?? data.log.get(run.invocationId) ?? [] });
    }
    const history = store ? await safely(store.stats(source.dir), {}) : {};
    return {
      name: source.name,
      dir: source.dir,
      otel: data.found,
      untracked: data.untracked ?? null,
      version: data.manifest?.version ?? null,
      runs,
      suggestions: suggest({ run: ordered[0] ?? null, manifest: data.manifest, history }),
      diff: diffView(data, memos.get(source))
    };
  }

  return {
    async build() {
      const projects = [];
      for (const source of sources) projects.push(await project(source));
      return { generatedAt: now(), history: Boolean(store), projects };
    }
  };
}
