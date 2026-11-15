#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from '../../src/cli/start.js';
import { artifactsDir } from '../../src/dbt/base.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const { values } = parseArgs({
  allowNegative: true,
  options: {
    port: { type: 'string', default: '4377' },
    open: { type: 'boolean', default: true },
    slow: { type: 'string', default: '12' },
    frozen: { type: 'boolean', default: false },
    empty: { type: 'boolean', default: false },
    loop: { type: 'boolean', default: false }
  }
});
const SLOW = BigInt(values.slow);
const LOOP_PAUSE_MS = 8000;
const NEW_ON_BRANCH = ['models/agg_orders.sql', 'models/schema.yml'];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sugar-playground-'));
const home = path.join(root, 'home');
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

function stamp(r) {
  return BigInt(r.start_time_unix_nano ?? r.time_unix_nano ?? r.end_time_unix_nano);
}

function when(r) {
  return BigInt(r.end_time_unix_nano ?? r.time_unix_nano ?? r.start_time_unix_nano);
}

const HEADER = /^(=+ )(\S+)( \| )(\S+)( =+)$/;
const LINE = /^(\d\d):(\d\d):(\d\d)\.(\d+)( .*)$/;
const PAST_RUNS = 3;
const PAST_GAP_MS = 20 * 60 * 1000;

function recording(fixture) {
  const records = fs.readFileSync(path.join(FIXTURES, fixture, 'logs', 'otel.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const first = records.reduce((min, r) => (stamp(r) < min ? stamp(r) : min), when(records[0]));
  const invocation = records.find((r) => r.event_type?.endsWith('Invocation')).attributes.invocation_id;
  const firstMs = Number(first / 1000000n);
  const day = new Date(firstMs).toISOString().slice(0, 10);
  let at = 0;
  const log = fs.readFileSync(path.join(FIXTURES, fixture, 'logs', 'dbt.log'), 'utf8').split('\n').filter(Boolean).map((text) => {
    const m = LINE.exec(text);
    if (m) at = Date.parse(`${day}T${m[1]}:${m[2]}:${m[3]}.${m[4].slice(0, 3)}Z`) - firstMs;
    return { offset: Math.max(0, at), text };
  });
  return { records, first, firstMs, invocation, log };
}

function atOf(rec, r) {
  return Number(((when(r) - rec.first) * SLOW) / 1000000n);
}

function rekey(text, rec, n) {
  const id = `${rec.invocation.slice(0, -4)}${n.toString(16).padStart(4, '0')}`;
  return text.replaceAll(rec.invocation, id).replaceAll(rec.invocation.replaceAll('-', ''), id.replaceAll('-', ''));
}

function clock(ms) {
  return new Date(ms).toISOString().slice(11, 23);
}

function events(rec, n, originMs) {
  const origin = BigInt(originMs) * 1000000n;
  const fix = (v) => (v === undefined ? undefined : String(origin + (BigInt(v) - rec.first) * SLOW));
  const otel = rec.records.map((r) => ({ at: atOf(rec, r), file: 'otel.jsonl', text: rekey(JSON.stringify({ ...r, start_time_unix_nano: fix(r.start_time_unix_nano), end_time_unix_nano: fix(r.end_time_unix_nano), time_unix_nano: fix(r.time_unix_nano) }), rec, n) }));
  const log = rec.log.map((l) => {
    const at = l.offset * Number(SLOW);
    const header = HEADER.exec(l.text);
    const text = header ? `${header[1]}${new Date(originMs).toISOString()}${header[3]}${header[4]}${header[5]}` : l.text.replace(LINE, (_, h, m, sec, frac, rest) => `${clock(originMs + at)}000${rest}`);
    return { at, file: 'dbt.log', text: rekey(text, rec, n) };
  });
  return [...otel, ...log].sort((a, b) => a.at - b.at);
}

function write(dir, event) {
  fs.appendFileSync(path.join(dir, 'logs', event.file), `${event.text}\n`);
}

function seed(dir, rec) {
  for (const name of ['otel.jsonl', 'dbt.log']) fs.writeFileSync(path.join(dir, 'logs', name), '');
  for (let k = PAST_RUNS; k >= 1; k -= 1) for (const e of events(rec, k, Date.now() - k * PAST_GAP_MS)) write(dir, e);
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=sugar', '-c', 'user.email=sugar@example.test', '-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function artifacts(dir, fixture) {
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'target'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixture, 'target', 'manifest.json'), path.join(dir, 'target', 'manifest.json'));
}

function jaffle() {
  const dir = path.join(root, 'jaffle');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dbt_project.yml'), 'name: jaffle_shop\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'logs/\ntarget/\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  const cached = artifactsDir(path.join(home, 'base'), dir, git(dir, 'rev-parse', 'HEAD'));
  fs.mkdirSync(cached, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'jaffle', 'base', 'manifest.json'), path.join(cached, 'manifest.json'));
  git(dir, 'checkout', '-q', '-b', 'feature/numeric-types');
  artifacts(dir, 'jaffle');
  return dir;
}

function sugarFixture() {
  const dir = path.join(root, 'sugar_fixture');
  fs.cpSync(path.join(FIXTURES, 'project'), dir, { recursive: true, filter: (src) => !/[\\/](logs|target|dbt_internal_packages)$/.test(src) });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'logs/\ntarget/\n*.duckdb\n');
  const parked = NEW_ON_BRANCH.map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]);
  for (const [rel] of parked) fs.rmSync(path.join(dir, rel));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature/add-agg-orders');
  for (const [rel, text] of parked) fs.writeFileSync(path.join(dir, rel), text);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'add agg_orders and tests');
  artifacts(dir, 'sugar');
  return dir;
}

function replay(dir, rec, delayMs, n = PAST_RUNS + 1) {
  setTimeout(() => {
    const started = Date.now();
    const queue = events(rec, n, started);
    const tick = setInterval(() => {
      while (queue.length && queue[0].at <= Date.now() - started) write(dir, queue.shift());
      if (queue.length) return;
      clearInterval(tick);
      if (values.loop) replay(dir, rec, LOOP_PAUSE_MS, n + 1);
    }, 50);
  }, delayMs);
}

function freeze(dir, rec, cutAt) {
  for (const e of events(rec, PAST_RUNS + 1, Date.now() - cutAt).filter((x) => x.at <= cutAt)) write(dir, e);
}

const dirs = [];
if (values.empty) {
  const dir = path.join(root, 'jaffle');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  dirs.push(dir);
} else {
  const jaffleDir = jaffle();
  const sugarDir = sugarFixture();
  dirs.push(jaffleDir, sugarDir);
  const jaffleRec = recording('jaffle');
  const sugarRec = recording('sugar');
  seed(jaffleDir, jaffleRec);
  seed(sugarDir, sugarRec);
  if (values.frozen) {
    freeze(jaffleDir, jaffleRec, Math.max(...jaffleRec.records.filter((r) => r.attributes?.name === 'locations' && r.record_type === 'SpanStart').map((r) => atOf(jaffleRec, r))));
    freeze(sugarDir, sugarRec, Math.max(...sugarRec.records.map((r) => atOf(sugarRec, r))));
  } else {
    replay(jaffleDir, jaffleRec, 0);
    replay(sugarDir, sugarRec, 6000);
  }
}

const env = { ...process.env, DBT_SUGAR_HOME: home, DBT_PROFILES_DIR: dirs.at(-1), SUGAR_DUCKDB_PATH: path.join(root, 'sugar.duckdb') };
run([...dirs.flatMap((d) => ['-d', d]), '--port', values.port, values.open ? '--open' : '--no-open', ...(values.empty ? ['--no-diff'] : [])], { env });
