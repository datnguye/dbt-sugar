import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '../../src/dbt/manifest.js';

export const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'jaffle');

export function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sugar-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function nanos(ms) {
  return String(BigInt(ms) * 1000000n);
}

export function span(kind, recordType, attributes = {}, { trace = 't1', start = 1000, end = 2000, ...rest } = {}) {
  const record = { record_type: recordType, trace_id: trace, event_type: `v1.public.events.fusion.${kind}`, start_time_unix_nano: nanos(start), attributes, ...rest };
  if (recordType === 'SpanEnd') record.end_time_unix_nano = nanos(end);
  return record;
}

export function log(severity, body, attributes = {}, { trace = 't1' } = {}) {
  return { record_type: 'LogRecord', trace_id: trace, event_type: 'v1.public.events.fusion.log.LogMessage', severity_text: severity, body, attributes };
}

export function jsonl(records) {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

export function node(id, outcome = 'success', extra = {}) {
  const done = outcome !== 'running';
  return { id, name: id.split('.').pop(), type: 'model', materialization: 'table', index: null, path: null, startedAt: 100, endedAt: done ? 200 : null, outcome, durationMs: done ? 100 : null, rows: null, warned: false, ...extra };
}

export function makeRun({ nodes = [], messages = [], ...fields } = {}) {
  return {
    id: 'run-1',
    file: null,
    invocationId: 'inv-1',
    command: 'build',
    rawCommand: 'dbt build',
    target: 'dev',
    threads: 4,
    version: '2.0.11',
    startedAt: 0,
    endedAt: null,
    status: 'running',
    total: nodes.length,
    phases: [],
    nodes: new Map(nodes.map((n) => [n.id, n])),
    messages,
    ...fields
  };
}

export function manifestOf(edges, { types = {}, sources = {} } = {}) {
  const ids = [...new Set(Object.entries(edges).flatMap(([id, children]) => [id, ...children]))];
  const parentMap = Object.fromEntries(ids.map((id) => [id, ids.filter((p) => (edges[p] ?? []).includes(id))]));
  const nodes = Object.fromEntries(ids.map((id) => [id, { unique_id: id, name: id.split('.').pop(), resource_type: types[id] ?? 'model', description: 'documented' }]));
  return parseManifest({ nodes, sources, parent_map: parentMap, child_map: Object.fromEntries(ids.map((id) => [id, edges[id] ?? []])) });
}

export function previousOf(entries) {
  return { id: 'prev', order: entries.map(([id]) => id), nodes: new Map(entries.map(([id, outcome, ms = 10]) => [id, { outcome, ms }])) };
}
