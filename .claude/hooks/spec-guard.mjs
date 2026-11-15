#!/usr/bin/env node
import { changedFiles, specProblems } from '../../src/scripts/spec-guard.mjs';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let event = {};
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  if (event.stop_hook_active) process.exit(0);
  let problems = [];
  try {
    problems = specProblems(changedFiles(null));
  } catch {
    process.exit(0);
  }
  if (problems.length) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `Spec-driven check before stopping:\n- ${problems.join('\n- ')}\nUpdate the contract and tests, or reply with one line explaining why this change needs neither.`
    }));
  }
});
