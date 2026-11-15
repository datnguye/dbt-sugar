#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'chore', 'ci', 'build', 'revert'];
const PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?!?: [^A-Z\\s].{0,71}$`);

export function messageFrom(command) {
  const commit = /\bgit\b[^\n|;&]*\bcommit\b/.exec(command);
  if (!commit) return null;
  const rest = command.slice(commit.index);
  const quoted = rest.match(/-m\s+(["'])([\s\S]*?)\1/);
  if (quoted) return quoted[2];
  const heredoc = rest.match(/<<\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1/);
  return heredoc ? heredoc[2] : null;
}

export function commitProblem(message) {
  const subject = String(message).split('\n').find((line) => line.trim() && !line.startsWith('#')) ?? '';
  if (/^(Merge|Revert) /.test(subject)) return null;
  if (!PATTERN.test(subject)) {
    return `"${subject}" is not a one-line conventional commit: <type>(<scope>)?: <lower-case summary, ≤ 72 chars>, type one of ${TYPES.join(', ')}`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problem = commitProblem(fs.readFileSync(process.argv[2], 'utf8'));
  if (problem) {
    console.error(`commit-msg: ${problem}`);
    process.exit(1);
  }
}
