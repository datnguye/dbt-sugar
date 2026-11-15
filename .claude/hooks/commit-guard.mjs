#!/usr/bin/env node
import { commitProblem, messageFrom } from '../../src/scripts/commit-msg.mjs';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input).tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  const message = messageFrom(command);
  const problem = message === null ? null : commitProblem(message);
  if (problem) {
    process.stderr.write(`Blocked by commit-guard: ${problem}`);
    process.exit(2);
  }
});
