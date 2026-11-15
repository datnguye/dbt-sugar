import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli, USAGE } from '../../../src/cli/args.js';

test('defaults: watch the current folder on 4322 and open the browser', () => {
  assert.deepEqual(parseCli([]), { host: '127.0.0.1', open: true, help: false, version: false, port: 4322, portExplicit: false, projectDirs: ['.'], command: [], diff: {} });
});

test('repeatable project dirs, explicit port, no-open, help and version', () => {
  const options = parseCli(['-d', 'a', '--project-dir', 'b', '-p', '0', '--no-open', '--host', '::1', '-h', '-v']);
  assert.deepEqual(options.projectDirs, ['a', 'b']);
  assert.equal(options.port, 0);
  assert.equal(options.portExplicit, true);
  assert.equal(options.open, false);
  assert.equal(options.host, '::1');
  assert.equal(options.help, true);
  assert.equal(options.version, true);
});

test('the Diff tab is on by default and --no-diff turns it off; branch flags are gone', () => {
  assert.deepEqual(parseCli([]).diff, {});
  assert.equal(parseCli(['--no-diff']).diff, null);
  assert.throws(() => parseCli(['--base', 'main']), /Unknown option/);
  assert.throws(() => parseCli(['--state', 'x']), /Unknown option/);
});

test('everything after -- is the dbt command, untouched', () => {
  assert.deepEqual(parseCli(['-d', 'p', '--', 'dbt', 'build', '--select', '+orders', '-p', '9']).command, ['dbt', 'build', '--select', '+orders', '-p', '9']);
});

test('rejects bad ports, non-loopback hosts, empty commands and a command with several projects', () => {
  assert.throws(() => parseCli(['--port', 'x']), /--port must be 0-65535/);
  assert.throws(() => parseCli(['--port', '70000']), /--port/);
  assert.throws(() => parseCli(['--host', '0.0.0.0']), /loopback/);
  assert.throws(() => parseCli(['--']), /nothing to run/);
  assert.throws(() => parseCli(['-d', 'a', '-d', 'b', '--', 'dbt', 'run']), /exactly one --project-dir/);
  assert.throws(() => parseCli(['--nope']), /Unknown option/);
  assert.match(USAGE, /sugar -- dbt build/);
});
