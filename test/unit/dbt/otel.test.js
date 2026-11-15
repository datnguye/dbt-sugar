import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { applyRecord, createOtelReader, OTEL_FILE, readNew } from '../../../src/dbt/otel.js';
import { FIXTURE, jsonl, log, span, tempDir, writeFile } from '../../helpers/fixture.js';

const INVOCATION = 'invocation.Invocation';
const PHASE = 'phase.PhaseExecuted';
const NODE = 'node.NodeProcessed';

function started(attributes = {}, options = {}) {
  return span(INVOCATION, 'SpanStart', attributes, options);
}

function apply(records) {
  const runs = new Map();
  for (const r of records) applyRecord(runs, r, 'f.jsonl');
  return runs;
}

test('OTEL_FILE matches one or many per-process files', () => {
  assert.ok(OTEL_FILE.test('otel.jsonl'));
  assert.ok(OTEL_FILE.test('otel-123.jsonl'));
  assert.ok(!OTEL_FILE.test('dbt.log'));
});

test('readNew reads complete lines from an offset and keeps the partial tail', (t) => {
  const file = writeFile(path.join(tempDir(t), 'otel.jsonl'), 'a\nb\npart');
  const first = readNew(file, 0);
  assert.deepEqual(first, { lines: ['a', 'b'], offset: 4, restart: false });
  fs.appendFileSync(file, 'ial\n');
  assert.deepEqual(readNew(file, first.offset), { lines: ['partial'], offset: 12, restart: false });
  assert.deepEqual(readNew(file, 12), { lines: [], offset: 12, restart: false });
});

test('readNew restarts when the file shrank or vanished', (t) => {
  const file = writeFile(path.join(tempDir(t), 'otel.jsonl'), 'x\n');
  assert.deepEqual(readNew(file, 50), { lines: ['x'], offset: 2, restart: true });
  assert.deepEqual(readNew(path.join(path.dirname(file), 'gone.jsonl'), 5), { lines: [], offset: 0, restart: true });
  assert.deepEqual(readNew(path.join(path.dirname(file), 'gone.jsonl'), 0), { lines: [], offset: 0, restart: false });
});

test('an invocation span opens a run and its end sets the status', () => {
  const runs = apply([
    started({ invocation_id: 'i1', raw_command: 'dbt build', eval_args: { command: 'build', target: 'dev', num_threads: '4' }, process_info: { version: '2.0.11' } }),
    span(INVOCATION, 'SpanEnd', {}, { end: 5000, status: { code: 2 } })
  ]);
  const run = runs.get('t1');
  assert.equal(run.file, 'f.jsonl');
  assert.deepEqual([run.invocationId, run.command, run.rawCommand, run.target, run.threads, run.version], ['i1', 'build', 'dbt build', 'dev', 4, '2.0.11']);
  assert.deepEqual([run.startedAt, run.endedAt, run.status], [1000, 5000, 'error']);
  const ok = apply([started(), span(INVOCATION, 'SpanEnd')]).get('t1');
  assert.deepEqual([ok.status, ok.command, ok.threads, ok.invocationId, ok.version], ['success', null, null, null, null]);
  assert.equal(apply([span(INVOCATION, 'SpanStart', null)]).get('t1').command, null);
});

test('records for unknown traces are ignored', () => {
  assert.equal(apply([span(NODE, 'SpanStart', { unique_id: 'x' })]).size, 0);
});

test('phases open on start and close on end, or arrive closed', () => {
  const run = apply([
    started(),
    span(PHASE, 'SpanStart', { phase: 'EXECUTION_PHASE_PARSE' }, { start: 1100 }),
    span(PHASE, 'SpanEnd', { phase: 'EXECUTION_PHASE_PARSE' }, { start: 1100, end: 1300 }),
    span(PHASE, 'SpanEnd', { phase: 'CUSTOM' }, { start: 1400, end: 1500 }),
    span(PHASE, 'SpanStart', {}, { start: 1600 })
  ]).get('t1');
  assert.deepEqual(run.phases, [
    { name: 'parse', startedAt: 1100, endedAt: 1300 },
    { name: 'custom', startedAt: 1400, endedAt: 1500 },
    { name: null, startedAt: 1600, endedAt: null }
  ]);
});

test('node spans track running, outcome, duration, rows and warnings', () => {
  const attrs = { unique_id: 'model.p.a', name: 'a', node_type: 'NODE_TYPE_MODEL', materialization: 'NODE_MATERIALIZATION_TABLE', node_index: 3, relative_path: 'models/a.sql', node_count_total: 9 };
  const runs = apply([started(), span(NODE, 'SpanStart', attrs, { start: 1200 })]);
  const running = runs.get('t1').nodes.get('model.p.a');
  assert.deepEqual([running.outcome, running.type, running.materialization, running.index, running.path, runs.get('t1').total], ['running', 'model', 'table', 3, 'models/a.sql', 9]);
  applyRecord(runs, span(NODE, 'SpanEnd', { ...attrs, node_outcome: 'NODE_OUTCOME_ERROR', duration_ms: '33', rows_affected: '5', node_evaluation_detail: { node_warning_outcome: 'NODE_WARNING_OUTCOME_WARNINGS' } }, { start: 1200, end: 1300 }));
  assert.deepEqual([running.outcome, running.durationMs, running.rows, running.warned, running.endedAt], ['error', 33, 5, true, 1300]);
});

test('node ends without a start default sensibly', () => {
  const runs = apply([
    started(),
    span(NODE, 'SpanEnd', { unique_id: 'x', name: 'x' }, { start: 1000, end: 1250 }),
    span(NODE, 'SpanEnd', { unique_id: 'y', name: 'y', node_outcome: 'NODE_OUTCOME_FUTURE', node_evaluation_detail: { node_warning_outcome: 'NODE_WARNING_OUTCOME_NO_WARNINGS' } })
  ]);
  const [x, y] = [...runs.get('t1').nodes.values()];
  assert.deepEqual([x.outcome, x.durationMs, x.rows, x.warned, x.type, x.index, x.path, runs.get('t1').total], ['success', 250, null, false, null, null, null, 0]);
  assert.deepEqual([y.outcome, y.warned], ['future', false]);
});

test('warn and error log records become messages, other logs are ignored', () => {
  const run = apply([
    started(),
    log('WARN', 'careful', { code_name: 'ColumnTypeMismatch' }),
    log('ERROR', 'boom', { code_name: 'DbDriverFailed', unique_id: 'model.p.a' }),
    log('INFO', 'chatter'),
    { record_type: 'LogRecord', trace_id: 't1', severity_text: 'ERROR' },
    span('query.QueryExecuted', 'SpanEnd')
  ]).get('t1');
  assert.deepEqual(run.messages, [
    { level: 'warn', code: 'ColumnTypeMismatch', nodeId: null, text: 'careful' },
    { level: 'error', code: 'DbDriverFailed', nodeId: 'model.p.a', text: 'boom' },
    { level: 'error', code: null, nodeId: null, text: '' }
  ]);
});

test('the reader parses the real dbt v2 build', () => {
  const { found, runs } = createOtelReader(path.join(FIXTURE, 'logs')).poll();
  assert.equal(found, true);
  assert.equal(runs.length, 1);
  const [run] = runs;
  const outcomes = [...run.nodes.values()].map((n) => n.outcome);
  assert.deepEqual([run.command, run.status, run.total, run.nodes.size, run.version], ['build', 'error', 53, 53, '2.0.11']);
  assert.deepEqual([outcomes.filter((o) => o === 'success').length, outcomes.filter((o) => o === 'error').length, outcomes.filter((o) => o === 'skipped').length], [36, 1, 16]);
  assert.equal(run.nodes.get('model.jaffle_shop.locations').outcome, 'error');
  assert.equal(run.messages.filter((m) => m.level === 'warn').length, 8);
});

test('the reader handles a missing folder, bad lines, appends and truncation', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(createOtelReader(path.join(dir, 'nope')).poll(), { found: false, runs: [] });
  const reader = createOtelReader(dir);
  const file = writeFile(path.join(dir, 'otel-b.jsonl'), `not json\n${jsonl([started({}, { trace: 'b' })])}`);
  writeFile(path.join(dir, 'otel-a.jsonl'), jsonl([started({}, { trace: 'a' })]));
  writeFile(path.join(dir, 'dbt.log'), 'ignored\n');
  assert.deepEqual(reader.poll().runs.map((r) => r.id), ['a', 'b']);
  fs.appendFileSync(file, jsonl([span(INVOCATION, 'SpanEnd', {}, { trace: 'b' })]));
  assert.equal(reader.poll().runs.find((r) => r.id === 'b').status, 'success');
  fs.writeFileSync(file, '');
  assert.deepEqual(reader.poll().runs.map((r) => r.id), ['a']);
});

test('the reader keeps the newest finished runs and every live one', (t) => {
  const dir = tempDir(t);
  const records = Array.from({ length: 52 }, (_, i) => [started({}, { trace: `r${i}`, start: 1000 + i }), span(INVOCATION, 'SpanEnd', {}, { trace: `r${i}` })]).flat();
  writeFile(path.join(dir, 'otel.jsonl'), jsonl([...records, started({}, { trace: 'live', start: 1 })]));
  const ids = createOtelReader(dir).poll().runs.map((r) => r.id);
  assert.equal(ids.length, 50);
  assert.ok(ids.includes('live'));
  assert.ok(!ids.includes('r0') && !ids.includes('r1') && !ids.includes('r2'));
  assert.ok(ids.includes('r3'));
});
