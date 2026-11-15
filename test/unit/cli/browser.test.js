import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { openBrowser } from '../../../src/cli/browser.js';

function fakeSpawn(record) {
  return (command, args) => {
    record.push([command, ...args]);
    return Object.assign(new EventEmitter(), { unref() {} });
  };
}

test('uses the platform opener', () => {
  const calls = [];
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal(openBrowser('http://x/', platform, fakeSpawn(calls)), true);
  assert.deepEqual(calls.map((c) => c[0]), ['open', 'cmd', 'xdg-open']);
});

test('swallows spawn failures', () => {
  assert.equal(openBrowser('http://x/', 'linux', () => { throw new Error('no'); }), false);
  const child = Object.assign(new EventEmitter(), { unref() {} });
  openBrowser('http://x/', 'linux', () => child);
  child.emit('error', new Error('ENOENT'));
});
