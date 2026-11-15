import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sugar from '../../src/index.js';

test('exports the library surface agent-cage and other hosts plug into', () => {
  for (const name of ['createSnapshotBuilder', 'moodOf', 'runView', 'countsOf', 'suggest', 'createDbtSource', 'createManifestReader', 'parseManifest', 'createOtelReader', 'applyRecord', 'createLogReader', 'parseLog', 'createStore', 'sugarHome']) {
    assert.equal(typeof sugar[name], 'function', name);
  }
  assert.deepEqual(sugar.MOODS, ['waiting', 'running', 'worried', 'alarmed', 'success', 'failed']);
  assert.ok(sugar.OTEL_FILE.test('otel-42.jsonl'));
});
