#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIRS = ['src', 'test', '.claude'];
const problems = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : walk(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

const files = DIRS.flatMap((dir) => walk(path.join(root, dir))).concat(path.join(root, 'playwright.config.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) problems.push(result.stderr.trim());
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const RUNTIME_DEPS = ['@duckdb/node-api'];
const extra = Object.keys(pkg.dependencies ?? {}).filter((dep) => !RUNTIME_DEPS.includes(dep));
if (extra.length) problems.push(`package.json: the only runtime dependency allowed is ${RUNTIME_DEPS.join(', ')} (found ${extra.join(', ')})`);
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.dependencies?.['@duckdb/node-api'] ?? '0.0.0')) problems.push('package.json: @duckdb/node-api must be pinned to an exact version');

const ALLOWED_IMPORTS = {
  dbt: [],
  core: [],
  history: ['core'],
  server: [],
  cli: ['core', 'dbt', 'history', 'server'],
  web: [],
  bin: ['cli']
};

for (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  if (/\bfetch\(['"`]https?:/.test(text) || /https:\/\/fonts\./.test(text)) problems.push(`${rel}: no network calls outside localhost`);
  if (/from '@duckdb\//.test(text) && rel !== path.join('src', 'history', 'store.js')) problems.push(`${rel}: only src/history/store.js may import @duckdb/node-api`);
  const area = rel.split(path.sep)[1];
  if (!(area in ALLOWED_IMPORTS)) continue;
  for (const [, spec] of text.matchAll(/from '(\.[^']+)'/g)) {
    const target = path.relative(path.join(root, 'src'), path.resolve(path.dirname(file), spec)).split(path.sep)[0];
    if (target !== area && !ALLOWED_IMPORTS[area].includes(target)) problems.push(`${rel}: src/${area} must not import src/${target} (${spec})`);
  }
}

const UNTESTED_BY_UNIT = [/^src\/bin\//, /^src\/scripts\//, /^src\/web\/app\.js$/];
for (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!rel.endsWith('.js') || UNTESTED_BY_UNIT.some((re) => re.test(rel))) continue;
  const mirror = rel.replace(/^src\//, 'test/unit/').replace(/\.js$/, '.test.js');
  if (!fs.existsSync(path.join(root, mirror))) problems.push(`${rel}: missing its mirrored test ${mirror}`);
}

if (problems.length) {
  console.error(problems.join('\n\n'));
  process.exit(1);
}
console.log(`check: ${files.length} files OK, one pinned runtime dependency, no outbound network, layering respected, tests mirror src`);
