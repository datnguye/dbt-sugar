import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitProblem, messageFrom } from '../../../src/scripts/commit-msg.mjs';
import { specProblems } from '../../../src/scripts/spec-guard.mjs';

test('commitProblem accepts one-line conventional subjects', () => {
  for (const ok of ['feat: add diff tab', 'fix(web)!: drop old chip', 'Merge branch main', 'Revert "feat: x"']) {
    assert.equal(commitProblem(ok), null, ok);
  }
});

test('commitProblem rejects everything else', () => {
  for (const bad of ['Added stuff', 'feat: Capitalised', 'feat:missing space', `feat: ${'x'.repeat(80)}`]) {
    assert.ok(commitProblem(bad), bad);
  }
});

test('messageFrom reads the message of a git commit, never an earlier heredoc', () => {
  assert.equal(messageFrom('git status'), null);
  assert.equal(messageFrom('git commit -m "feat: x"'), 'feat: x');
  assert.equal(messageFrom("git commit -F - <<'MSG'\nfix: y\nMSG"), 'fix: y');
  assert.equal(messageFrom("python3 - <<'PY'\nprint(1)\nPY\ngit commit --amend --no-edit"), null);
  assert.equal(messageFrom('git commit --amend --no-edit'), null);
});

test('specProblems ignores changes outside src or in scripts', () => {
  assert.deepEqual(specProblems(['README.md', 'src/scripts/check.mjs']), []);
});

test('specProblems wants a contract and a test with every src change', () => {
  assert.equal(specProblems(['src/core/snapshot.js']).length, 2);
  assert.deepEqual(specProblems(['src/core/snapshot.js', 'docs/spec.md', 'test/unit/core/snapshot.test.js']), []);
  assert.deepEqual(specProblems(['src/dbt/otel.js', 'docs/proposals/0001-x.md', 'test/unit/dbt/otel.test.js']), []);
});
