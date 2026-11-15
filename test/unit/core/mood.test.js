import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOODS, moodOf } from '../../../src/core/mood.js';

const ZERO = { success: 0, warn: 0, error: 0, skipped: 0, running: 0, queued: 0 };

function mood(status, counts = {}, warnings = 0) {
  return moodOf({ status, counts: { ...ZERO, ...counts }, warnings });
}

test('live runs wait, run, worry or panic', () => {
  assert.equal(mood('running'), 'waiting');
  assert.equal(mood('running', { running: 1 }), 'running');
  assert.equal(mood('running', { success: 2 }, 1), 'worried');
  assert.equal(mood('running', { warn: 1 }), 'worried');
  assert.equal(mood('running', { error: 1, warn: 1 }), 'alarmed');
});

test('finished runs celebrate or crash', () => {
  assert.equal(mood('success', { success: 3 }), 'success');
  assert.equal(mood('error'), 'failed');
  assert.equal(mood('success', { error: 1 }), 'failed');
  assert.equal(mood('success', { skipped: 1 }), 'failed');
  assert.deepEqual(MOODS, ['waiting', 'running', 'worried', 'alarmed', 'success', 'failed']);
});
