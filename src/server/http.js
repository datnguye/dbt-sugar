import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const MAX_BODY = 4096;

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(size > MAX_BODY ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
  });
}

async function select(req, res, token, onSelect) {
  if (req.headers['x-sugar-token'] !== token) return send(res, 403, { error: 'bad token' });
  const body = await readJson(req);
  if (!body || !onSelect(body)) return send(res, 400, { error: 'invalid selection' });
  return send(res, 200, { ok: true });
}

function withoutClock(snapshot) {
  return JSON.stringify({ ...snapshot, generatedAt: 0 });
}

export function createServer({ publicDir, heartbeatMs = 5000, token = '', onSelect = () => false }) {
  const clients = new Set();
  let snapshot = { generatedAt: 0, history: false, projects: [] };
  let fingerprint = withoutClock(snapshot);
  let allowedHosts = new Set();

  function broadcast(event, data) {
    for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  function publish(next) {
    const print = withoutClock(next);
    snapshot = next;
    if (print === fingerprint) return false;
    fingerprint = print;
    broadcast('state', JSON.stringify(snapshot));
    return true;
  }

  function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const file = path.resolve(publicDir, rel);
    const type = TYPES[path.extname(file)];
    if (!type || !file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
    const body = fs.readFileSync(file);
    return send(res, 200, rel === 'index.html' ? body.toString('utf8').replaceAll('__SUGAR_TOKEN__', token) : body, type);
  }

  const server = http.createServer((req, res) => {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: 'forbidden host' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/diff') return select(req, res, token, onSelect);
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (url.pathname === '/api/state') return send(res, 200, snapshot);
    if (url.pathname === '/events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', connection: 'keep-alive' });
      res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    try {
      return serveStatic(res, decodeURIComponent(url.pathname));
    } catch {
      return send(res, 400, { error: 'bad path' });
    }
  });

  const beat = setInterval(() => broadcast('beat', String(Date.now())), heartbeatMs);
  beat.unref();

  return {
    publish,
    clientCount: () => clients.size,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const actual = server.address().port;
          allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`, `[::1]:${actual}`]);
          resolve(actual);
        });
      });
    },
    close() {
      clearInterval(beat);
      for (const res of clients) res.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
