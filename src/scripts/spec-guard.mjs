#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BEHAVIOUR = /^src\/(?!scripts\/)/;
const CONTRACT = /^docs\/spec\.md$|^docs\/(decisions|proposals)\//;
const TESTS = /^test\//;

function git(args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

export function changedFiles(base) {
  if (base) return git(['diff', '--name-only', `${base}...HEAD`]);
  return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])];
}

export function specProblems(files) {
  const behaviour = files.filter((f) => BEHAVIOUR.test(f));
  if (!behaviour.length) return [];
  const problems = [];
  if (!files.some((f) => CONTRACT.test(f))) {
    problems.push(`src/ changed (${behaviour.slice(0, 3).join(', ')}${behaviour.length > 3 ? ', …' : ''}) but docs/spec.md, a decision or a proposal did not. Spec first: update the contract, or say why behaviour did not change.`);
  }
  if (!files.some((f) => TESTS.test(f))) problems.push('src/ changed but no test under test/ changed.');
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseFlag = process.argv.indexOf('--base');
  const problems = specProblems(changedFiles(baseFlag > -1 ? process.argv[baseFlag + 1] : null));
  if (problems.length) {
    console.error(`spec-guard:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('spec-guard: contract and tests move with the code');
}
