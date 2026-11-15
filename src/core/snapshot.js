import { moodOf } from './mood.js';

const NEXT_LIMIT = 8;
const FINISHED_LIMIT = 40;
const RISK_LIMIT = 3;

function nameOf(manifest, id) {
  return manifest?.nodes.get(id)?.name ?? id.split('.').pop();
}

export function countDescendants(manifest, id, within) {
  if (!manifest) return 0;
  const seen = new Set();
  const queue = [...(manifest.nodes.get(id)?.children ?? [])];
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next) || !within.has(next)) continue;
    seen.add(next);
    queue.push(...(manifest.nodes.get(next)?.children ?? []));
  }
  return seen.size;
}

function candidates(run, manifest, previous) {
  if (previous) return previous.order.filter((id) => !run.nodes.has(id));
  const found = new Set();
  for (const id of run.nodes.keys()) {
    for (const child of manifest?.nodes.get(id)?.children ?? []) if (!run.nodes.has(child)) found.add(child);
  }
  return [...found];
}

function last(previous, id) {
  const node = previous?.nodes.get(id);
  return node ? { ms: node.ms, outcome: node.outcome } : null;
}

export function countsOf(run) {
  const counts = { success: 0, warn: 0, error: 0, skipped: 0, running: 0, queued: 0 };
  for (const node of run.nodes.values()) {
    if (node.outcome === 'running') counts.running += 1;
    else if (node.outcome === 'success') counts[node.warned ? 'warn' : 'success'] += 1;
    else if (node.outcome === 'error') counts.error += 1;
    else counts.skipped += 1;
  }
  counts.queued = run.status === 'running' ? Math.max(0, run.total - run.nodes.size) : 0;
  return counts;
}

export function runView(run, { manifest = null, previous = null } = {}) {
  const nodes = [...run.nodes.values()];
  const counts = countsOf(run);
  const warnings = run.messages.filter((m) => m.level === 'warn').length;
  const errors = run.messages.filter((m) => m.level === 'error').length;
  const done = new Set(nodes.filter((n) => n.endedAt !== null).map((n) => n.id));
  const pending = run.status === 'running' ? candidates(run, manifest, previous) : [];
  const pendingSet = new Set(pending);
  const waitingOn = (id) => (manifest?.nodes.get(id)?.parents ?? []).filter((p) => !done.has(p) && (run.nodes.has(p) || pendingSet.has(p)));
  const next = pending
    .map((id) => ({ id, name: nameOf(manifest, id), type: manifest?.nodes.get(id)?.type ?? null, waitingOn: waitingOn(id).map((p) => nameOf(manifest, p)), last: last(previous, id) }))
    .sort((a, b) => Math.sign(a.waitingOn.length) - Math.sign(b.waitingOn.length))
    .slice(0, NEXT_LIMIT);
  const running = nodes.filter((n) => n.outcome === 'running').map((n) => ({ id: n.id, name: n.name, type: n.type, materialization: n.materialization, startedAt: n.startedAt, last: last(previous, n.id) }));
  const within = new Set([...pending, ...running.map((n) => n.id)]);
  const atRisk = [...running, ...next]
    .filter((n) => n.last?.outcome === 'error')
    .slice(0, RISK_LIMIT)
    .map((n) => ({ name: n.name, count: countDescendants(manifest, n.id, within) }));
  const finished = nodes
    .filter((n) => n.endedAt !== null)
    .sort((a, b) => a.endedAt - b.endedAt)
    .slice(-FINISHED_LIMIT)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, outcome: n.outcome, warned: n.warned, endedAt: n.endedAt }));
  const errorText = new Map(run.messages.filter((m) => m.level === 'error' && m.nodeId).map((m) => [m.nodeId, m.text.split('\n').map((l) => l.trim()).filter(Boolean)]));
  const skippedIds = new Set(nodes.filter((x) => x.outcome === 'skipped').map((x) => x.id));
  const failed = nodes
    .filter((n) => n.outcome === 'error')
    .map((n) => {
      const lines = errorText.get(n.id) ?? [];
      return { id: n.id, name: n.name, type: n.type, durationMs: n.durationMs, error: lines[1] ?? lines[0] ?? null, blocked: countDescendants(manifest, n.id, skippedIds) };
    });
  const blockedBy = new Map();
  for (const f of failed) {
    const queue = [...(manifest?.nodes.get(f.id)?.children ?? [])];
    while (queue.length) {
      const id = queue.shift();
      if (blockedBy.has(id) || !skippedIds.has(id)) continue;
      blockedBy.set(id, f.name);
      queue.push(...manifest.nodes.get(id).children);
    }
  }
  const skipped = nodes.filter((n) => n.outcome === 'skipped').map((n) => ({ id: n.id, name: n.name, type: n.type, via: blockedBy.get(n.id) ?? null }));
  const lastEventAt = Math.max(run.startedAt, run.endedAt ?? 0, ...nodes.flatMap((n) => [n.startedAt, n.endedAt ?? 0]), ...run.phases.flatMap((p) => [p.startedAt, p.endedAt ?? 0]));
  return {
    key: run.id,
    invocationId: run.invocationId,
    command: run.command,
    rawCommand: run.rawCommand,
    target: run.target,
    threads: run.threads,
    version: run.version,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    phases: run.phases,
    total: run.total,
    counts,
    warnings,
    errors,
    running,
    next,
    atRisk,
    finished,
    failed,
    skipped,
    lastEventAt,
    mood: moodOf({ status: run.status, counts, warnings })
  };
}
