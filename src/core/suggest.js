import { countDescendants } from './snapshot.js';

const SLOW_MS = 60000;
const LIST = 6;

function listOf(names) {
  return names.length > LIST ? `${names.slice(0, LIST).join(', ')} and ${names.length - LIST} more` : names.join(', ');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function errorTips(run, manifest) {
  const skipped = new Set([...run.nodes.values()].filter((n) => n.outcome === 'skipped').map((n) => n.id));
  return run.messages
    .filter((m) => m.level === 'error' && m.nodeId)
    .map((m) => {
      const node = manifest?.nodes.get(m.nodeId);
      const lines = m.text.split('\n').map((l) => l.trim()).filter(Boolean);
      const blocked = countDescendants(manifest, m.nodeId, skipped);
      return {
        kind: 'ERROR',
        title: `${node?.name ?? m.nodeId.split('.').pop()}: ${lines[1] ?? lines[0] ?? m.code}`,
        gain: blocked ? `unblocks ${plural(blocked, 'node')}` : 'fixes the run',
        why: lines.join('\n'),
        fix: node?.file ? `Open ${node.file}` : ''
      };
    });
}

function warningTips(run) {
  const groups = new Map();
  for (const m of run.messages.filter((x) => x.level === 'warn')) {
    const key = m.code ?? 'Warning';
    groups.set(key, [...(groups.get(key) ?? []), m.text]);
  }
  return [...groups].map(([code, texts]) => ({
    kind: 'WARNING',
    title: `${texts.length}× ${code}: ${texts[0].split('\n')[0]}`,
    gain: `−${plural(texts.length, 'warning')}`,
    why: [...new Set(texts)].slice(0, 3).join('\n'),
    fix: ''
  }));
}

function projectTips(manifest) {
  if (!manifest) return [];
  const models = [...manifest.nodes.values()].filter((n) => n.type === 'model');
  const tips = [];
  const untested = models.filter((m) => !manifest.testsOf.get(m.id)).map((m) => m.name);
  if (untested.length) {
    tips.push({
      kind: 'TESTS',
      title: `${untested.length} of ${plural(models.length, 'model')} ${untested.length === 1 ? 'has' : 'have'} no tests`,
      gain: `coverage ${Math.round(((models.length - untested.length) / models.length) * 100)}% → 100%`,
      why: listOf(untested),
      fix: `models:\n  - name: ${untested[0]}\n    columns:\n      - name: <key column>\n        data_tests: [unique, not_null]`
    });
  }
  const undocumented = models.filter((m) => !m.description.trim()).map((m) => m.name);
  if (undocumented.length) {
    tips.push({ kind: 'DOCS', title: `${plural(undocumented.length, 'model')} without a description`, gain: 'clearer docs', why: listOf(undocumented), fix: `models:\n  - name: ${undocumented[0]}\n    description: <what one row means>` });
  }
  const stale = manifest.sources.filter((s) => !s.freshness).map((s) => s.name);
  if (stale.length) {
    tips.push({ kind: 'FRESHNESS', title: `${plural(stale.length, 'source')} without a freshness check`, gain: 'catch stale data', why: listOf(stale), fix: 'config:\n  freshness:\n    warn_after: {count: 24, period: hour}\n  loaded_at_field: <timestamp column>' });
  }
  return tips;
}

function historyTips({ flaky = [], slow = [] }) {
  return [
    ...flaky.map((t) => ({ kind: 'FLAKY', title: `${t.name} failed ${t.fails} of the last ${t.runs} runs`, gain: 'fewer reruns', why: 'Passes sometimes and fails sometimes: likely data timing or a non-deterministic test.', fix: 'data_tests:\n  - <test>:\n      config:\n        severity: warn' })),
    ...slow.filter((s) => s.ms >= SLOW_MS && s.materialization === 'table').map((s) => ({ kind: 'SPEED', title: `${s.name} takes ${Math.round(s.ms / 1000)}s as a table: consider incremental`, gain: 'faster builds', why: 'Median duration over recent successful runs.', fix: "{{ config(materialized='incremental', unique_key='<key>') }}" }))
  ];
}

export function suggest({ run = null, manifest = null, history = {} }) {
  const fromRun = run ? [...errorTips(run, manifest), ...warningTips(run)] : [];
  const fromHistory = historyTips(history);
  return [...fromRun.filter((t) => t.kind === 'ERROR'), ...fromHistory, ...fromRun.filter((t) => t.kind !== 'ERROR'), ...projectTips(manifest)];
}
