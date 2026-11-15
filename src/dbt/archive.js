import fs from 'node:fs';
import path from 'node:path';
import { HEADER, parseLog } from './logtail.js';

export const KEEP_RUNS = 10;
const ARTIFACTS = ['manifest.json', 'run_results.json'];

export function serializeRun(run) {
  return { ...run, nodes: [...run.nodes.values()] };
}

export function deserializeRun(data) {
  return { ...data, nodes: new Map(data.nodes.map((n) => [n.id, n])) };
}

export function logSlice(text, invocationId) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => HEADER.exec(l)?.[1] === invocationId);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && HEADER.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function readIfMatches(file, invocationId) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text).metadata?.invocation_id === invocationId ? text : null;
  } catch {
    return null;
  }
}

function folders(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /^\d+-/.test(name))
      .sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]));
  } catch {
    return [];
  }
}

export function createArchive({ root, project, keep = KEEP_RUNS }) {
  const dir = path.join(root, path.resolve(project).replace(/[^A-Za-z0-9]+/g, '_'));
  const saved = new Set();

  function prune() {
    for (const name of folders(dir).slice(keep)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }

  return {
    dir,
    load() {
      const runs = [];
      for (const name of folders(dir).slice(0, keep)) {
        try {
          const run = deserializeRun(JSON.parse(fs.readFileSync(path.join(dir, name, 'run.json'), 'utf8')));
          const log = path.join(dir, name, 'dbt.log');
          run.log = fs.existsSync(log) ? parseLog(fs.readFileSync(log, 'utf8'), Infinity) : [];
          saved.add(run.id);
          runs.push(run);
        } catch {
          continue;
        }
      }
      return runs;
    },
    save(run, { targetDir, logFile }) {
      if (saved.has(run.id) || run.status === 'running') return false;
      saved.add(run.id);
      const folder = path.join(dir, `${run.startedAt}-${run.id}`);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'run.json'), JSON.stringify(serializeRun(run)));
      for (const name of ARTIFACTS) {
        const text = readIfMatches(path.join(targetDir, name), run.invocationId);
        if (text) fs.writeFileSync(path.join(folder, name), text);
      }
      const log = fs.existsSync(logFile) ? logSlice(fs.readFileSync(logFile, 'utf8'), run.invocationId) : null;
      if (log) fs.writeFileSync(path.join(folder, 'dbt.log'), log);
      run.log = log ? parseLog(log, Infinity) : [];
      prune();
      return true;
    }
  };
}
