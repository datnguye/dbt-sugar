import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from '../../../src/server/http.js';
import { tempDir, writeFile } from '../../helpers/fixture.js';

function get(port, urlPath, { host = `127.0.0.1:${port}`, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], csp: res.headers['content-security-policy'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...(token ? { 'x-sugar-token': token } : {}) };
    const req = http.request({ host: '127.0.0.1', port, path: '/api/diff', method: 'POST', headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function stream(port, until) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (until(body)) {
          req.destroy();
          resolve(body);
        }
      });
    });
    req.on('error', (error) => (error.code === 'ECONNRESET' ? null : reject(error)));
  });
}

async function serve(t, options = {}) {
  const dir = tempDir(t);
  writeFile(path.join(dir, 'index.html'), '<meta name="sugar-token" content="__SUGAR_TOKEN__"><h1>sugar</h1>');
  writeFile(path.join(dir, 'app.js'), 'export {};');
  writeFile(path.join(dir, 'notes.txt'), 'no');
  writeFile(path.join(dir, 'lib', 'x.css'), 'a{}');
  const server = createServer({ publicDir: dir, ...options });
  const port = await server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  return { server, port };
}

test('serves the page, static files and the snapshot with security headers', async (t) => {
  const { port } = await serve(t);
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.csp, /default-src 'self'/);
  assert.equal((await get(port, '/app.js')).status, 200);
  assert.equal((await get(port, '/lib/x.css')).body, 'a{}');
  assert.deepEqual(JSON.parse((await get(port, '/api/state')).body), { generatedAt: 0, history: false, projects: [] });
});

test('refuses foreign hosts, non-GET methods, unknown files, traversal and bad paths', async (t) => {
  const { port } = await serve(t);
  assert.equal((await get(port, '/', { host: 'evil.test' })).status, 403);
  assert.equal((await get(port, '/', { host: `localhost:${port}` })).status, 200);
  assert.equal((await get(port, '/api/state', { method: 'POST' })).status, 405);
  assert.equal((await get(port, '/missing.js')).status, 404);
  assert.equal((await get(port, '/notes.txt')).status, 404);
  assert.equal((await get(port, '/lib')).status, 404);
  assert.equal((await get(port, '/..%2f..%2fetc%2fpasswd.js')).status, 404);
  assert.equal((await get(port, '/%E0%A4%A.js')).status, 400);
});

test('publishes only real changes over server-sent events, with heartbeats', async (t) => {
  const { server, port } = await serve(t, { heartbeatMs: 20 });
  const first = stream(port, (body) => body.includes('"name":"jaffle"') && body.includes('event: beat'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(server.clientCount(), 1);
  assert.equal(server.publish({ generatedAt: 1, history: true, projects: [{ name: 'jaffle' }] }), true);
  assert.equal(server.publish({ generatedAt: 2, history: true, projects: [{ name: 'jaffle' }] }), false);
  const body = await first;
  assert.match(body, /^retry: 2000\nevent: state\n/);
  assert.equal(JSON.parse((await get(port, '/api/state')).body).generatedAt, 2);
});

test('close ends open streams; listen rejects a busy port', async (t) => {
  const { server, port } = await serve(t);
  const open = new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => res.on('end', resolve).resume()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const other = createServer({ publicDir: tempDir(t) });
  await assert.rejects(other.listen(port, '127.0.0.1'), { code: 'EADDRINUSE' });
  await other.close();
  await server.close();
  await open;
  assert.equal(server.clientCount(), 0);
});

test('the page carries the launch token, and POST /api/diff needs it plus a valid JSON body', async (t) => {
  const seen = [];
  const { port } = await serve(t, { token: 'tok123', onSelect: (body) => (seen.push(body), body.ok === true) });
  assert.match((await get(port, '/')).body, /content="tok123"/);
  assert.equal((await post(port, '{"ok":true}', 'wrong')).status, 403);
  assert.equal((await post(port, '{"ok":true}')).status, 403);
  assert.equal((await post(port, 'not json', 'tok123')).status, 400);
  assert.equal((await post(port, JSON.stringify({ ok: true, pad: 'x'.repeat(5000) }), 'tok123')).status, 400);
  assert.deepEqual(await post(port, '{"ok":false}', 'tok123'), { status: 400, body: { error: 'invalid selection' } });
  assert.deepEqual(await post(port, '{"ok":true}', 'tok123'), { status: 200, body: { ok: true } });
  assert.deepEqual(seen, [{ ok: false }, { ok: true }]);
  assert.equal((await get(port, '/api/diff', { method: 'PUT' })).status, 405);
});

test('without an onSelect handler every selection is rejected', async (t) => {
  const { port } = await serve(t);
  assert.equal((await post(port, '{}', '')).status, 403);
  const { port: other } = await serve(t, { token: 't' });
  assert.equal((await post(other, '{}', 't')).status, 400);
});
