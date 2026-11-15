#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let file;
  try {
    file = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file || !/\.m?js$/.test(file)) process.exit(0);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`Syntax error after editing ${file}:\n${result.stderr}`);
    process.exit(2);
  }
});
