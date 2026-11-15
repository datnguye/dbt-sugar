import { spawn as spawnProcess } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSnapshotBuilder } from '../core/builder.js';
import { sugarHome } from '../core/home.js';
import { REF } from '../dbt/base.js';
import { createDbtSource } from '../dbt/source.js';
import { createServer } from '../server/http.js';
import { createWatcher } from '../server/watch.js';
import { parseCli, USAGE } from './args.js';
import { openBrowser } from './browser.js';

const PORT_TRIES = 10;
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export async function openStore({ env, load = () => import('../history/store.js') }) {
  try {
    const { createStore } = await load();
    return createStore({ dir: sugarHome(env) });
  } catch {
    return null;
  }
}

async function listenWithFallback(server, options, port = options.port) {
  try {
    return await server.listen(port, options.host);
  } catch (error) {
    const last = options.portExplicit || options.port === 0 ? options.port : options.port + PORT_TRIES - 1;
    if (error.code !== 'EADDRINUSE' || port >= last) throw error;
    return listenWithFallback(server, options, port + 1);
  }
}

export function runDbt(command, { cwd, env, logDir, spawn = spawnProcess, now = Date.now, onExit }) {
  const logPath = env.DBT_LOG_PATH || path.join(logDir, `sugar-${now()}-${process.pid}`);
  const child = spawn(command[0], command.slice(1), { cwd, stdio: 'inherit', env: { ...env, DBT_LOG_PATH: logPath, DBT_OTEL_FILE_NAME: env.DBT_OTEL_FILE_NAME || 'otel.jsonl' } });
  let done = false;
  const finish = (code) => {
    if (done) return;
    done = true;
    onExit(code);
  };
  child.on('error', () => finish(127));
  child.on('exit', (code) => finish(code ?? 1));
  return child;
}

function validRef(ref) {
  return ref === null || (typeof ref === 'string' && REF.test(ref));
}

export function applySelection(sources, { project, action = 'select', side = null, base = null, head = null } = {}) {
  const source = sources.find((s) => s.dir === project);
  if (!source) return false;
  if (action === 'build') return source.buildDiff(side);
  if (action !== 'select' || !validRef(base) || !validRef(head)) return false;
  return source.selectDiff({ base, head });
}

export async function start(options, { env = process.env, log = console.log, open = openBrowser, spawn = spawnProcess, store = openStore, now = Date.now } = {}) {
  const diff = options.diff && { ...options.diff, cacheDir: path.join(sugarHome(env), 'base') };
  const sources = options.projectDirs.map((projectDir) => createDbtSource({ projectDir, env, diff, archiveRoot: path.join(sugarHome(env), 'runs'), onChange: () => refresh() }));
  const history = await store({ env });
  const builder = createSnapshotBuilder({ sources, store: history, now });
  const server = createServer({ publicDir: WEB_DIR, token: crypto.randomBytes(16).toString('hex'), onSelect: (body) => applySelection(sources, body) });
  let pending = null;
  let again = false;
  function refresh() {
    if (pending) {
      again = true;
      return pending;
    }
    pending = builder.build().then(server.publish).finally(() => {
      pending = null;
      if (again) {
        again = false;
        refresh();
      }
    });
    return pending;
  }
  await refresh();
  const port = await listenWithFallback(server, options);
  const watcher = createWatcher({
    dirs: () => sources.flatMap((s) => s.watchDirs()),
    onChange() {
      refresh();
      watcher.sync();
    }
  });
  const url = `http://${options.host === '::1' ? '[::1]' : options.host}:${port}/`;
  log(`🍬 dbt sugar is open at ${url}`);
  for (const source of sources) log(`   watching ${source.name}: ${source.logDir}`);
  log(history ? `   history: ${history.file}` : '   history: off (DuckDB unavailable)');
  if (options.open) open(url);
  const app = { url, port, exitCode: null, refresh };
  if (options.command.length) {
    app.child = runDbt(options.command, {
      cwd: sources[0].dir,
      logDir: sources[0].logDir,
      env,
      spawn,
      onExit(code) {
        app.exitCode = code;
        refresh();
        log(code === 127 ? `sugar: could not start "${options.command[0]}"` : `   ${options.command[0]} exited with ${code}; the page stays open, Ctrl-C to quit`);
      }
    });
  }
  app.close = async () => {
    watcher.close();
    await server.close();
  };
  return app;
}

export async function run(argv, { log = console.log, error = console.error, exit = process.exit, version = '0.0.0', ...deps } = {}) {
  let options;
  try {
    options = parseCli(argv);
  } catch (problem) {
    error(`sugar: ${problem.message}\n\n${USAGE}`);
    return exit(2);
  }
  if (options.help) return log(USAGE);
  if (options.version) return log(version);
  try {
    const app = await start(options, { log, ...deps });
    const stop = () => app.close().then(() => exit(app.exitCode ?? 0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return app;
  } catch (problem) {
    error(problem.code === 'EADDRINUSE' ? `sugar: port ${options.port} is busy; try --port 0` : `sugar: ${problem.message}`);
    return exit(1);
  }
}
