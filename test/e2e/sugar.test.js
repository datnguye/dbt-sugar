import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { FIXTURE, tempDir } from '../helpers/fixture.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'bin', 'sugar.js');

function waitFor(child, pattern) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}: ${out}`)), 15000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = pattern.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

test('the sugar binary serves a dbt v2 project and saves its runs to history', async (t) => {
  const dir = tempDir(t);
  const project = path.join(dir, 'jaffle');
  fs.cpSync(FIXTURE, project, { recursive: true });
  const child = spawn(process.execPath, [BIN, '-d', project, '--no-open', '--port', '0'], { env: { ...process.env, DBT_SUGAR_HOME: path.join(dir, 'home') } });
  t.after(() => child.kill('SIGTERM'));
  const [, url] = await waitFor(child, /(http:\/\/127\.0\.0\.1:\d+\/)/);
  const state = await getJson(`${url}api/state`);
  assert.equal(state.history, true);
  assert.equal(state.projects[0].runs[0].total, 53);
  assert.equal(state.projects[0].suggestions[0].kind, 'ERROR');
  assert.ok(fs.existsSync(path.join(dir, 'home', 'history.duckdb')));
});
