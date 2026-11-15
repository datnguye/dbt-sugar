import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLogReader, parseLog } from '../../../src/dbt/logtail.js';
import { FIXTURE, tempDir, writeFile } from '../../helpers/fixture.js';

const TEXT = [
  '  orphan continuation',
  '==================== 2026-11-15T10:23:09Z | abc ====================',
  '10:23:09.358519 [warn ]: careful',
  '10:23:10.013053 [info ]: Started seed raw.raw_supplies',
  '10:23:10.020000 [debug]: hidden',
  '    drop table if exists x',
  '10:23:11.100927 [error]: Database Error in model locations',
  '  Catalog Error: nope',
  '10:23:11.200000 [info ]: ',
  '\u001b[0m21:25:43.227615 [info ] [MainThread]: dbt v1 line',
  '',
  '==================== Execution Summary =====================',
  "Finished 'build' with 1 error for target 'dev' [4.2s]",
  '',
  '==================== 2026-11-15T10:30:00Z | def ===================='
].join('\n');

function header(id) {
  return `==================== 2026-11-15T10:00:00Z | ${id} ====================`;
}

function line(text, level = 'info') {
  return `10:00:00.000000 [${level.padEnd(5)}]: ${text}`;
}

test('parseLog keeps v2 info, warn and error lines with their continuations and invocation', () => {
  assert.deepEqual(parseLog(TEXT, 10), [
    { t: '10:23:09.358', level: 'warn', text: 'careful', inv: 'abc' },
    { t: '10:23:10.013', level: 'info', text: 'Started seed raw.raw_supplies', inv: 'abc' },
    { t: '10:23:11.100', level: 'error', text: 'Database Error in model locations\n  Catalog Error: nope', inv: 'abc' },
    { t: '10:23:11.200', level: 'info', text: '==================== Execution Summary =====================', inv: 'abc' },
    { t: '10:23:11.200', level: 'info', text: "Finished 'build' with 1 error for target 'dev' [4.2s]", inv: 'abc' }
  ]);
  assert.deepEqual(parseLog(TEXT, 1).map((e) => e.inv), ['abc']);
  assert.equal(parseLog(line('before any header'), 5)[0].inv, null);
});

test('the reader groups the real log by invocation', () => {
  const log = createLogReader(path.join(FIXTURE, 'logs', 'dbt.log')).read();
  assert.deepEqual([...log.keys()], ['01a1debb-736e-7cc2-8cea-197f353bfa6b']);
  assert.ok(log.get('01a1debb-736e-7cc2-8cea-197f353bfa6b').some((e) => e.level === 'error' && e.text.includes('timestamp_ntz')));
});

test('the reader follows appends, keeps headers however long the run, and restarts on truncation', (t) => {
  const file = path.join(tempDir(t), 'dbt.log');
  const reader = createLogReader(file, { keep: 2, maxLines: 3 });
  assert.equal(reader.read().size, 0);
  writeFile(file, [line('orphan'), header('a'), line('a1'), '  more a1', line('a2', 'warn'), ''].join('\n'));
  assert.deepEqual(reader.read().get('a').map((e) => e.text), ['a1\n  more a1', 'a2']);
  fs.appendFileSync(file, `${line('a3')}\n${line('a4')}\n10:00:00.000000 [info ]: half`);
  assert.deepEqual(reader.read().get('a').map((e) => e.text), ['a2', 'a3', 'a4']);
  assert.equal(reader.read().get('a').length, 3);
  fs.appendFileSync(file, ` done\n${header('b')}\n  stray continuation\n${header('c')}\n${line('c1')}\n`);
  const after = reader.read();
  assert.deepEqual([...after.keys()], ['b', 'c']);
  assert.deepEqual(after.get('a'), undefined);
  assert.deepEqual(after.get('b'), []);
  fs.writeFileSync(file, `${header('d')}\n${line('d1')}\n`);
  assert.deepEqual([...reader.read().keys()], ['d']);
  fs.rmSync(file);
  assert.equal(reader.read().size, 0);
});

test('a first read of a huge log starts near the end and drops the cut line', (t) => {
  const file = path.join(tempDir(t), 'dbt.log');
  writeFile(file, [header('old'), line('x'.repeat(200)), header('new'), line('n1'), ''].join('\n'));
  const reader = createLogReader(file, { firstReadBytes: 160 });
  assert.deepEqual([...reader.read().keys()], ['new']);
  const cut = path.join(tempDir(t), 'cut.log');
  writeFile(cut, `${'y'.repeat(50)}`);
  const lonely = createLogReader(cut, { firstReadBytes: 10 });
  assert.equal(lonely.read().size, 0);
  fs.appendFileSync(cut, `\n${header('z')}\n${line('z1')}\n`);
  assert.deepEqual(lonely.read().get('z').map((e) => e.text), ['z1']);
});
