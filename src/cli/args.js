import { parseArgs } from 'node:util';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export const USAGE = `Usage: sugar [options] [-- <dbt command>]

Watch dbt v2 runs live in the browser: what's running, what's next, what to fix.

Options:
  -d, --project-dir <dir>  dbt project to watch (repeatable; default .)
      --no-diff            turn off the Diff tab (pick branches and build their artifacts on the page)
  -p, --port <n>           port to listen on (default 4322, 0 = any free port)
      --host <h>           loopback address to bind (default 127.0.0.1)
      --no-open            do not open the browser
  -h, --help               show this help
  -v, --version            print the version

Examples:
  sugar -- dbt build --select +orders   run dbt and watch it (sets DBT_OTEL_FILE_NAME)
  sugar                                 watch dbt runs started elsewhere

Runs started elsewhere need DBT_OTEL_FILE_NAME=otel.jsonl (or any otel*.jsonl name,
one per process when several dbt processes run at once).`;

export function parseCli(argv) {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  const { values } = parseArgs({
    args: own,
    allowNegative: true,
    options: {
      'project-dir': { type: 'string', short: 'd', multiple: true },
      diff: { type: 'boolean', default: true },
      port: { type: 'string', short: 'p' },
      host: { type: 'string', default: '127.0.0.1' },
      open: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false }
    }
  });
  const port = values.port === undefined ? 4322 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be 0-65535, got "${values.port}"`);
  if (!LOOPBACK.has(values.host)) throw new Error(`--host must be a loopback address (${[...LOOPBACK].join(', ')})`);
  const projectDirs = values['project-dir'] ?? ['.'];
  if (command.length && projectDirs.length > 1) throw new Error('running a dbt command needs exactly one --project-dir');
  if (dash !== -1 && !command.length) throw new Error('nothing to run after --');
  const diff = values.diff ? {} : null;
  return { host: values.host, open: values.open, help: values.help, version: values.version, port, portExplicit: values.port !== undefined, projectDirs, command, diff };
}
