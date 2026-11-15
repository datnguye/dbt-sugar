import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DuckDBInstance } from '@duckdb/node-api';
export { sugarHome } from '../core/home.js';

const OFFLINE = { autoinstall_known_extensions: 'false', autoload_known_extensions: 'false' };
const RECENT_RUNS = 10;
const CHUNK = 400;
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS runs (id VARCHAR PRIMARY KEY, project VARCHAR, command VARCHAR, raw_command VARCHAR, target VARCHAR, version VARCHAR, started_at BIGINT, ended_at BIGINT, status VARCHAR, total INTEGER)',
  'CREATE TABLE IF NOT EXISTS nodes (run_id VARCHAR, id VARCHAR, name VARCHAR, type VARCHAR, materialization VARCHAR, outcome VARCHAR, ms BIGINT, idx INTEGER, PRIMARY KEY (run_id, id))'
];

function isLock(error) {
  return /Could not set lock|Conflicting lock/.test(error.message);
}

export async function retry(work, { attempts = 5, waitMs = 100, wait = sleep } = {}) {
  try {
    return await work();
  } catch (error) {
    if (!isLock(error) || attempts <= 1) throw error;
    await wait(waitMs);
    return retry(work, { attempts: attempts - 1, waitMs, wait });
  }
}

function rows(reader) {
  return reader.getRowObjectsJson();
}

export function createStore({ dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'history.duckdb');
  let ready = false;

  function withDatabase(work) {
    return retry(async () => {
      const instance = await DuckDBInstance.create(file, OFFLINE);
      const connection = await instance.connect();
      try {
        if (!ready) for (const sql of SCHEMA) await connection.run(sql);
        ready = true;
        return await work(connection);
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });
  }

  return {
    file,
    saveRun(project, run) {
      return withDatabase(async (db) => {
        await db.run('BEGIN TRANSACTION');
        await db.run('INSERT OR REPLACE INTO runs VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
          run.id, project, run.command, run.rawCommand, run.target, run.version, run.startedAt, run.endedAt, run.status, run.total
        ]);
        await db.run('DELETE FROM nodes WHERE run_id = $1', [run.id]);
        const nodes = [...run.nodes.values()];
        for (let i = 0; i < nodes.length; i += CHUNK) {
          const chunk = nodes.slice(i, i + CHUNK);
          const values = chunk.map((_, r) => `(${Array.from({ length: 8 }, (_, c) => `$${r * 8 + c + 1}`).join(', ')})`).join(', ');
          const params = chunk.flatMap((n) => [run.id, n.id, n.name, n.type, n.materialization, n.outcome, n.durationMs, n.index]);
          await db.run(`INSERT INTO nodes VALUES ${values}`, params);
        }
        await db.run('COMMIT');
        await db.run(`DELETE FROM nodes WHERE run_id IN (SELECT id FROM runs WHERE project = $1 ORDER BY started_at DESC OFFSET ${RECENT_RUNS})`, [project]);
        await db.run(`DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE project = $1 ORDER BY started_at DESC OFFSET ${RECENT_RUNS})`, [project]);
      });
    },
    previousRun(project, command, before) {
      return withDatabase(async (db) => {
        const [prior] = rows(await db.runAndReadAll('SELECT id FROM runs WHERE project = $1 AND command IS NOT DISTINCT FROM $2 AND started_at < $3 ORDER BY started_at DESC LIMIT 1', [project, command, before]));
        if (!prior) return null;
        const list = rows(await db.runAndReadAll('SELECT id, outcome, ms FROM nodes WHERE run_id = $1 ORDER BY idx NULLS LAST, id', [prior.id]));
        return { id: prior.id, order: list.map((n) => n.id), nodes: new Map(list.map((n) => [n.id, { ms: n.ms === null ? null : Number(n.ms), outcome: n.outcome }])) };
      });
    },
    stats(project) {
      return withDatabase(async (db) => {
        const recent = `WITH recent AS (SELECT id FROM runs WHERE project = $1 ORDER BY started_at DESC LIMIT ${RECENT_RUNS})`;
        const flaky = rows(await db.runAndReadAll(`${recent}
          SELECT n.id, any_value(n.name) AS name, count(*) FILTER (WHERE n.outcome = 'error') AS fails, count(*) AS runs
          FROM nodes n JOIN recent r ON n.run_id = r.id WHERE n.type IN ('test', 'unit_test')
          GROUP BY n.id HAVING fails >= 2 AND fails < runs ORDER BY fails DESC, n.id`, [project]));
        const slow = rows(await db.runAndReadAll(`${recent}
          SELECT n.id, any_value(n.name) AS name, any_value(n.materialization) AS materialization, median(n.ms) AS ms
          FROM nodes n JOIN recent r ON n.run_id = r.id WHERE n.type = 'model' AND n.outcome = 'success'
          GROUP BY n.id ORDER BY ms DESC, n.id LIMIT 5`, [project]));
        return {
          flaky: flaky.map((t) => ({ id: t.id, name: t.name, fails: Number(t.fails), runs: Number(t.runs) })),
          slow: slow.map((s) => ({ id: s.id, name: s.name, materialization: s.materialization, ms: Number(s.ms) }))
        };
      });
    }
  };
}
