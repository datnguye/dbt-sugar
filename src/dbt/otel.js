import fs from 'node:fs';
import path from 'node:path';

export const OTEL_FILE = /^otel.*\.jsonl$/;
const KEEP_RUNS = 50;
const OUTCOMES = {
  NODE_OUTCOME_SUCCESS: 'success',
  NODE_OUTCOME_ERROR: 'error',
  NODE_OUTCOME_SKIPPED: 'skipped',
  NODE_OUTCOME_CANCELED: 'canceled'
};

export function readNew(file, offset) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { lines: [], offset: 0, restart: offset > 0 };
  }
  const start = size < offset ? 0 : offset;
  const restart = start !== offset;
  if (size === start) return { lines: [], offset: start, restart };
  const buffer = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(fd);
  }
  const end = buffer.lastIndexOf(10) + 1;
  const lines = buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean);
  return { lines, offset: start + end, restart };
}

function millis(nanos) {
  return Number(BigInt(nanos) / 1000000n);
}

function trimPrefix(value, prefix) {
  if (!value) return null;
  return (value.startsWith(prefix) ? value.slice(prefix.length) : value).toLowerCase();
}

function newRun(record, file) {
  const a = record.attributes ?? {};
  const args = a.eval_args ?? {};
  return {
    id: record.trace_id,
    file,
    invocationId: a.invocation_id ?? null,
    command: args.command ?? null,
    rawCommand: a.raw_command ?? null,
    target: args.target ?? null,
    profilesDir: args.profiles_dir ?? null,
    threads: args.num_threads ? Number(args.num_threads) : null,
    version: a.process_info?.version ?? null,
    startedAt: millis(record.start_time_unix_nano),
    endedAt: null,
    status: 'running',
    total: 0,
    phases: [],
    nodes: new Map(),
    messages: []
  };
}

function applyPhase(run, record) {
  const name = trimPrefix(record.attributes?.phase, 'EXECUTION_PHASE_');
  if (record.record_type === 'SpanStart') {
    run.phases.push({ name, startedAt: millis(record.start_time_unix_nano), endedAt: null });
    return;
  }
  const open = run.phases.find((p) => p.name === name && p.endedAt === null);
  const endedAt = millis(record.end_time_unix_nano);
  if (open) open.endedAt = endedAt;
  else run.phases.push({ name, startedAt: millis(record.start_time_unix_nano), endedAt });
}

function applyNode(run, record) {
  const a = record.attributes;
  const node = run.nodes.get(a.unique_id) ?? {
    id: a.unique_id,
    name: a.name,
    type: trimPrefix(a.node_type, 'NODE_TYPE_'),
    materialization: trimPrefix(a.materialization, 'NODE_MATERIALIZATION_'),
    index: a.node_index ?? null,
    path: a.relative_path ?? null,
    startedAt: millis(record.start_time_unix_nano),
    endedAt: null,
    outcome: 'running',
    durationMs: null,
    rows: null,
    warned: false
  };
  run.nodes.set(node.id, node);
  run.total = Math.max(run.total, a.node_count_total ?? 0);
  if (record.record_type !== 'SpanEnd') return;
  node.endedAt = millis(record.end_time_unix_nano);
  node.outcome = OUTCOMES[a.node_outcome] ?? trimPrefix(a.node_outcome, 'NODE_OUTCOME_') ?? 'success';
  node.durationMs = a.duration_ms === undefined ? node.endedAt - node.startedAt : Number(a.duration_ms);
  node.rows = a.rows_affected === undefined ? null : Number(a.rows_affected);
  const warning = a.node_evaluation_detail?.node_warning_outcome ?? '';
  node.warned = /WARN/.test(warning) && !/NO_WARNINGS/.test(warning);
}

export function applyRecord(runs, record, file = null) {
  const kind = record.event_type?.split('.').pop();
  if (kind === 'Invocation' && record.record_type === 'SpanStart') {
    runs.set(record.trace_id, newRun(record, file));
    return;
  }
  const run = runs.get(record.trace_id);
  if (!run) return;
  if (kind === 'Invocation') {
    run.endedAt = millis(record.end_time_unix_nano);
    run.status = record.status?.code === 2 ? 'error' : 'success';
  } else if (kind === 'PhaseExecuted') {
    applyPhase(run, record);
  } else if (kind === 'NodeProcessed') {
    applyNode(run, record);
  } else if (record.record_type === 'LogRecord' && ['WARN', 'ERROR'].includes(record.severity_text)) {
    const a = record.attributes ?? {};
    run.messages.push({ level: record.severity_text.toLowerCase(), code: a.code_name ?? null, nodeId: a.unique_id ?? null, text: record.body ?? '' });
  }
}

function prune(runs) {
  const finished = [...runs.values()].filter((r) => r.status !== 'running').sort((a, b) => a.startedAt - b.startedAt);
  for (const run of finished.slice(0, Math.max(0, runs.size - KEEP_RUNS))) runs.delete(run.id);
}

export function logDirs(logDir) {
  try {
    return [logDir, ...fs.readdirSync(logDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(logDir, e.name)).sort()];
  } catch {
    return [logDir];
  }
}

export function filesIn(dir, pattern) {
  try {
    return fs.readdirSync(dir).filter((name) => pattern.test(name)).sort().map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export function createOtelReader(logDir) {
  const offsets = new Map();
  const runs = new Map();
  return {
    poll() {
      const files = logDirs(logDir).flatMap((d) => filesIn(d, OTEL_FILE));
      for (const file of files) {
        const { lines, offset, restart } = readNew(file, offsets.get(file) ?? 0);
        if (restart) for (const run of [...runs.values()]) if (run.file === file) runs.delete(run.id);
        offsets.set(file, offset);
        for (const line of lines) {
          try {
            applyRecord(runs, JSON.parse(line), file);
          } catch {
            continue;
          }
        }
      }
      prune(runs);
      return { found: files.length > 0, runs: [...runs.values()] };
    }
  };
}
