export const PHASES = { load_project: 'Load', parse: 'Parse', schedule: 'Schedule', task_graph_build: 'Graph', render: 'Render', analyze: 'Analyze', run: 'Run' };
const TALLY = [
  ['success', 'pass', 'var(--pass)'],
  ['running', 'running', 'var(--run)'],
  ['queued', 'queued', 'var(--queued)'],
  ['warn', 'warn', 'var(--warn)'],
  ['error', 'error', 'var(--error)'],
  ['skipped', 'skip', 'var(--skip)']
];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const STATE_RANK = { running: 0, failed: 1, passed: 2, idle: 3 };
const STATE_COLOR = { running: 'var(--run)', failed: 'var(--error)', passed: 'var(--pass)', idle: 'var(--muted)' };

export function projectState(project) {
  const run = project.runs[0];
  if (!run) return 'idle';
  if (run.status === 'running') return 'running';
  return run.status === 'success' && !run.counts.error ? 'passed' : 'failed';
}

function byState(a, b) {
  return STATE_RANK[projectState(a)] - STATE_RANK[projectState(b)] || a.name.localeCompare(b.name);
}

export function pick(snapshot, projectDir, runKey) {
  const projects = snapshot?.projects ?? [];
  const project = projects.find((p) => p.dir === projectDir) ?? [...projects].sort(byState)[0];
  if (!project) return null;
  return { project, run: project.runs.find((r) => r.key === runKey) ?? project.runs[0] ?? null };
}

function dot(state) {
  return `<span class="dot" style="background:${STATE_COLOR[state]}"></span>`;
}

function branchOf(project) {
  return project.diff?.git?.current ?? null;
}

export function projectSummary(projects) {
  const states = projects.map(projectState);
  const count = (s) => states.filter((x) => x === s).length;
  return [`${projects.length} project${projects.length === 1 ? '' : 's'}`, count('running') && `${count('running')} running`, count('failed') && `${count('failed')} failed`].filter(Boolean).join(' · ');
}

export function switcherHtml(project, projects) {
  if (!project) return '<span class="muted">no project</span>';
  const branch = branchOf(project);
  return `${dot(projectState(project))}<b>${esc(project.name)}</b>${branch ? `<span class="branch"> @${esc(branch)}</span>` : ''}${projects.length > 1 ? `<span class="muted"> ▾ ${esc(projectSummary(projects))}</span>` : ''}`;
}

function runLine(run) {
  if (!run) return 'no run yet';
  const [n, label] = progressOf(run);
  return `${run.command ?? 'dbt'} · ${n}/${run.total} ${label} · ${run.status === 'running' ? 'running' : run.status === 'success' && !run.counts.error ? 'passed' : 'failed'}`;
}

export function projectListHtml(projects, selectedDir, query) {
  const q = query.trim().toLowerCase();
  const shown = [...projects].sort(byState).filter((p) => !q || [p.name, p.dir, branchOf(p) ?? ''].some((v) => v.toLowerCase().includes(q)));
  if (!shown.length) return '<div class="empty">No project matches.</div>';
  return `<div class="muted proj-count">${shown.length} of ${projects.length}</div>${shown
    .map((p) => `<button type="button" class="proj-row" data-project="${esc(p.dir)}" aria-pressed="${p.dir === selectedDir}">${dot(projectState(p))}<b>${esc(p.name)}</b><span class="branch">${branchOf(p) ? `@${esc(branchOf(p))}` : ''}</span><span>${esc(runLine(p.runs[0]))}</span><span class="muted path">${esc(p.dir)}</span></button>`)
    .join('')}`;
}

export function runOptions(project, runKey) {
  return (project?.runs ?? []).map((r) => `<option value="${esc(r.key)}"${r.key === runKey ? ' selected' : ''}>${esc(runLine(r))} · ${esc(new Date(r.startedAt).toLocaleTimeString())}</option>`).join('');
}

export function phasesHtml(run, now) {
  return run.phases
    .map((p) => {
      const live = p.endedAt === null;
      const ms = (live ? now : p.endedAt) - p.startedAt;
      return `<span class="phase${live ? ' live' : ''}"><span class="dot" style="background:${live ? 'var(--run)' : 'var(--pass)'}"></span>${esc(PHASES[p.name] ?? p.name)}<span class="mono">${fmtMs(ms)}</span></span>`;
    })
    .join('');
}

export function doneOf(run) {
  const c = run.counts;
  return c.success + c.warn + c.error + c.skipped;
}

function progressOf(run) {
  return run.status === 'running' ? [doneOf(run), 'done'] : [run.counts.success + run.counts.warn, 'ok'];
}

export function otelHintHtml(project) {
  const fix = 'Start dbt with <code>sugar -- dbt build</code>, or <code>export DBT_OTEL_FILE_NAME=otel.jsonl</code> in your shell (one <code>otel-*.jsonl</code> per process when several run at once).';
  if (!project) return '';
  if (!project.otel) return `No OTel log in <code>${esc(project.name)}/logs</code> yet. ${fix}`;
  if (project.untracked) return `The latest dbt run (${esc(new Date(project.untracked.at).toLocaleTimeString())}) wrote no OTel log, so sugar could not follow it. ${fix}`;
  return '';
}

export function countHtml(run) {
  return `${progressOf(run)[0]}<span class="muted">/${run.total}</span>`;
}

export function barHtml(run) {
  const total = Math.max(run.total, 1);
  const pct = (n) => `${((n / total) * 100).toFixed(2)}%`;
  const c = run.counts;
  return [
    ['success', 'var(--pass)'],
    ['warn', 'var(--warn)'],
    ['error', 'var(--error)'],
    ['skipped', 'var(--skip)']
  ]
    .map(([k, color]) => `<span class="${k}" style="width:${pct(c[k])};background:${color}"></span>`)
    .concat(`<span class="running" style="width:${pct(c.running)}"></span>`)
    .join('');
}

export function tallyHtml(run) {
  const rows = TALLY.map(([k, label, color]) => `<div><span class="swatch" style="background:${color}"></span>${label}<b>${run.counts[k]}</b></div>`);
  if (run.warnings) rows.push(`<div><span class="swatch" style="background:var(--warn)"></span>log warnings<b>${run.warnings}</b></div>`);
  return rows.join('');
}

function lastCell(last) {
  if (!last) return '<span class="muted">first run</span>';
  if (last.outcome === 'error') return `<span class="slow">failed after ${fmtMs(last.ms)}</span>`;
  if (last.outcome === 'skipped') return '<span class="muted">skipped</span>';
  return `<span class="mono">${fmtMs(last.ms)}</span>`;
}

function typeLabel(type, materialization) {
  return [type?.replace('_', ' '), materialization && materialization !== type && type === 'model' ? materialization : null].filter(Boolean).join(' · ');
}

function nameCell(name) {
  return `<td class="mono" title="${esc(name)}">${esc(name)}</td>`;
}

function failedHtml(run) {
  if (!run.failed.length) return '<tr><td colspan="4" class="empty">Run finished. Nothing failed.</td></tr>';
  return run.failed
    .map((n) => `<tr>${nameCell(n.name)}<td class="col-opt"><span class="tag">${esc(typeLabel(n.type, null))}</span></td><td class="err" colspan="2">${esc(n.error ?? 'failed')}${n.blocked ? ` · blocked ${n.blocked} node${n.blocked === 1 ? '' : 's'}` : ''}</td></tr>`)
    .join('');
}

export function runningHtml(run, now) {
  if (run.status !== 'running') return failedHtml(run);
  if (!run.running.length) return '<tr><td colspan="4" class="empty">Nothing running this instant.</td></tr>';
  return run.running
    .map((n) => {
      const elapsed = now - n.startedAt;
      const late = n.last && n.last.outcome === 'success' && elapsed > n.last.ms * 1.5 && elapsed > 1000;
      return `<tr>${nameCell(n.name)}<td class="col-opt"><span class="tag">${esc(typeLabel(n.type, n.materialization))}</span></td><td class="mono${late ? ' slow' : ''}">${fmtMs(elapsed)}</td><td class="col-opt">${lastCell(n.last)}</td></tr>`;
    })
    .join('');
}

export function nextHtml(run) {
  if (run.status !== 'running') {
    if (!run.skipped.length) return '<tr><td colspan="3" class="empty">Nothing was skipped.</td></tr>';
    return run.skipped.map((n) => `<tr>${nameCell(n.name)}<td class="col-opt"><span class="tag">${esc(typeLabel(n.type))}</span></td><td class="err">${n.via ? `blocked by ${esc(n.via)}` : 'skipped'}</td></tr>`).join('');
  }
  if (!run.counts.queued) return '<tr><td colspan="3" class="empty">Nothing queued.</td></tr>';
  if (!run.next.length) return '<tr><td colspan="3" class="empty">Queue unknown until a previous run of this command is in history.</td></tr>';
  const more = run.counts.queued - run.next.length;
  return run.next
    .map((n) => `<tr>${nameCell(n.name)}<td class="muted" title="${esc(n.waitingOn.join(', '))}">${n.waitingOn.length ? esc(n.waitingOn.join(', ')) : 'ready'}</td><td class="col-opt">${lastCell(n.last)}</td></tr>`)
    .concat(more > 0 ? [`<tr class="more"><td colspan="3">+${more} more queued</td></tr>`] : [])
    .join('');
}

export function statusWord(run) {
  if (!run) return ['', ''];
  if (run.status === 'running') return [run.total && doneOf(run) === run.total ? 'FINISHING' : 'RUNNING', 'var(--run)'];
  return run.status === 'success' && !run.counts.error ? ['PASSED', 'var(--pass)'] : ['FAILED', 'var(--error)'];
}

export function panels(run) {
  if (!run || run.status === 'running') {
    return { first: 'Running now', second: 'Up next', firstHead: '<th>NODE</th><th class="col-opt">TYPE</th><th>ELAPSED</th><th class="col-opt">LAST RUN</th>', secondHead: '<th>NODE</th><th>WAITING ON</th><th class="col-opt">LAST RUN</th>' };
  }
  return { first: 'Failed', second: 'Skipped', firstHead: '<th>NODE</th><th class="col-opt">TYPE</th><th colspan="2">ERROR</th>', secondHead: '<th>NODE</th><th class="col-opt">TYPE</th><th>BLOCKED BY</th>' };
}

export function staleFor(run, now, limit = 30000) {
  return run?.status === 'running' && now - run.lastEventAt > limit ? now - run.lastEventAt : 0;
}

export function riskHtml(run) {
  return run.atRisk.map((r) => `At risk: <span class="mono">${esc(r.name)}</span> failed last run. If it fails again, ${r.count} queued node${r.count === 1 ? '' : 's'} skip.`).join('<br>');
}

export function tipsHtml(tips, full = false) {
  if (!tips.length) return '<div class="empty">Nothing to suggest. Suspiciously sweet.</div>';
  const kind = (t) => `<span class="kind k-${t.kind.toLowerCase()}">${esc(t.kind)}</span>`;
  if (!full) {
    return tips.map((t, i) => `<button type="button" class="tip" data-expand="tips" data-tip="${i}">${kind(t)}<span class="title">${esc(t.title)}</span><span class="gain">${esc(t.gain)}</span></button>`).join('');
  }
  return `<div class="tips tips-full">${tips
    .map((t, i) => `<details open id="tip-${i}"><summary>${kind(t)}<span class="title">${esc(t.title)}</span><span class="gain">${esc(t.gain)}</span></summary><div class="body"><span>${esc(t.why)}</span>${t.fix ? `<pre>${esc(t.fix)}</pre>` : ''}</div></details>`)
    .join('')}</div>`;
}

export function tableHtml(head, body) {
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function promptText(project, tips) {
  const items = tips.map((t, i) => `${i + 1}. [${t.kind}] ${t.title}\n${t.why}${t.fix ? `\nSuggested change:\n${t.fix}` : ''}`);
  return `In the dbt project at ${project.dir}, please address these findings from the last dbt run:\n\n${items.join('\n\n')}`;
}

export function logHtml(lines, filter) {
  const shown = lines.filter((l) => filter === 'all' || l.level === filter);
  if (!shown.length) return '<div class="muted">No log lines yet.</div>';
  return shown.map((l) => `<div><span class="t">${esc(l.t)}</span><span class="${l.level}">${esc(l.text)}</span></div>`).join('');
}

export function pickAction(prev, next) {
  if (!next) return null;
  if (!prev) return null;
  if (prev.key !== next.key) return next.status === 'running' ? 'peek' : null;
  if (prev.status === 'running' && next.status !== 'running') return next.mood === 'success' ? 'rush' : 'gasp';
  const seen = new Set(prev.finished.map((n) => n.id));
  const fresh = next.finished.filter((n) => !seen.has(n.id));
  if (fresh.some((n) => n.outcome === 'error')) return 'gasp';
  if (fresh.some((n) => n.outcome === 'skipped')) return 'shrug';
  if (fresh.some((n) => n.type === 'test' || n.type === 'unit_test')) return 'cheer';
  return fresh.length ? 'bite' : null;
}

const SIGN = { added: '+', modified: '~', removed: '-' };

function option(value, label, selected) {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

function refLabel(ref, sha) {
  return `${esc(ref)}${sha ? `@${esc(sha.slice(0, 7))}` : ''}`;
}

export function branchOptions(diff) {
  if (!diff) return { base: '', head: '', baseDisabled: true, headDisabled: true };
  const branches = diff.git?.branches ?? [];
  const baseList = [...new Set([diff.ref, ...branches].filter(Boolean))];
  const headRef = diff.head?.ref ?? null;
  const headList = [...new Set([headRef, ...branches].filter(Boolean))];
  return {
    base: baseList.map((b) => option(b, b, b === diff.ref)).join(''),
    head: [option('worktree', `${diff.git?.current ?? 'current'} · working tree`, !headRef), ...headList.map((b) => option(b, b, b === headRef))].join(''),
    baseDisabled: !branches.length,
    headDisabled: !branches.length
  };
}

function buildButton(side, label) {
  return `<button type="button" class="btn primary" data-build="${side}">${label}</button>`;
}

export function diffCommand(diff) {
  return diff?.out ? `dbt parse --target-path ${diff.out}` : null;
}

function cmdline(diff, label) {
  return `<div class="cmdline"><code class="cmd mono" id="diff-build-cmd">${esc(diffCommand(diff))}</code><button type="button" class="btn" data-copy="diff-build-cmd" aria-label="Copy the dbt command">Copy</button>${buildButton(diff.side, label)}</div>`;
}

export function diffStatusHtml(diff) {
  if (!diff) return '<div class="empty">The Diff tab is off (--no-diff).</div>';
  const fromSugar = !diff.head && diff.compareSource === 'sugar';
  const compare = diff.head ? refLabel(diff.head.ref, diff.head.sha) : 'working tree';
  const origin = diff.head ? 'parsed' : fromSugar ? "sugar's parse" : 'target/manifest.json';
  const head = `<span class="mono">${refLabel(diff.ref, diff.sha)}</span> <span class="muted">→</span> <span class="mono">${compare}</span> <span class="muted">(${origin}${diff.currentAt ? ` · ${esc(diff.currentAt.slice(0, 19).replace('T', ' '))} UTC` : ''})</span>`;
  const worktree = diff.side === 'head' && !diff.head;
  const which = worktree ? 'the working tree' : `the ${diff.side === 'head' ? 'compare' : 'base'} branch <span class="mono">${refLabel((diff.side === 'head' ? diff.head : diff).ref, (diff.side === 'head' ? diff.head : diff).sha)}</span>`;
  const where = worktree ? "in your project folder; dbt writes to sugar's cache, never to <code>target/</code>" : 'in a temporary git worktree of that commit';
  if (diff.status === 'resolving') return `${head}<div class="hint">Looking up ${which} in git…</div>`;
  if (diff.status === 'missing') return `${head}<div class="hint">No dbt artifacts for ${which} yet${worktree ? ' (no <code>target/manifest.json</code>)' : ''}. Sugar runs this ${where}:${cmdline(diff, 'Generate')}</div>`;
  if (diff.status === 'parsing') return `${head}<div class="hint">Running <code>dbt parse</code> for ${which} ${where}…</div>`;
  if (diff.status === 'error') return `${head}<div class="hint err">${esc(diff.error)}${diff.out ? `<div class="cmdline">${buildButton(diff.side, 'Retry')}</div>` : ''}</div>`;
  const notes = diff.warning ? `<div class="hint">${esc(diff.warning)}</div>` : '';
  const regen = fromSugar ? `<div class="hint">Comparing against sugar's parse of the working tree. After editing, run <code>dbt parse</code> or regenerate:<div class="cmdline">${diff.compareWarning ? `<span class="muted">${esc(diff.compareWarning)}</span>` : ''}${buildButton('head', 'Regenerate')}</div></div>` : '';
  return `${head}${notes}${regen}`;
}

export function diffCountsHtml(summary) {
  const items = [
    ['added', '+ added', 'var(--pass)'],
    ['modified', '~ modified', 'var(--warn)'],
    ['removed', '- removed', 'var(--skip)'],
    ['breaking', '! breaking', 'var(--error)'],
    ['impacted', '↳ downstream', 'var(--info)']
  ];
  return items.map(([k, label, color]) => `<div><span class="swatch" style="background:${color}"></span>${label}<b>${summary[k]}</b></div>`).join('');
}

export function filterChanges(changes, filter) {
  if (filter === 'models') return changes.filter((c) => c.type === 'model');
  if (filter === 'breaking') return changes.filter((c) => c.breaking.length);
  return changes;
}

export function changeListHtml(changes, selected, filter) {
  const shown = filterChanges(changes, filter);
  if (!changes.length) return '<div class="empty">Nothing differs from the base. Sweet.</div>';
  if (!shown.length) return '<div class="empty">Nothing matches this filter.</div>';
  return shown
    .map((c) => `<button type="button" class="change c-${c.change}" data-change="${esc(c.id)}" aria-pressed="${c.id === selected}"><span class="sign" aria-hidden="true">${SIGN[c.change]}</span><span class="sr">${c.change}${c.breaking.length ? ', breaking' : ''}: </span><span class="title" title="${esc(c.name)}">${esc(c.name)}</span><span class="tag">${esc(typeLabel(c.type))}</span>${c.breaking.length ? '<span class="bad" aria-hidden="true">!</span>' : ''}<span class="muted">${esc(c.reasons.join(' · '))}${c.downstream ? ` · ${c.downstream} downstream` : ''}</span></button>`)
    .join('');
}

export function codeHtml(lines) {
  return `<pre class="code">${lines.map((l) => `<span class="ln${l.op === '+' ? ' add' : l.op === '-' ? ' del' : l.op === '…' ? ' gap' : ''}">${esc(l.op === '…' ? `… ${l.text}` : `${l.op} ${l.text}`)}</span>`).join('\n')}</pre>`;
}

function fromTo(from, to) {
  return `<span class="del">${esc(String(from ?? '∅'))}</span> → <span class="add">${esc(String(to ?? '∅'))}</span>`;
}

export function changeDetailHtml(change) {
  if (!change) return '<div class="empty">Pick a change on the left.</div>';
  const parts = [`<div class="dhead"><span class="sign c-${change.change}">${SIGN[change.change]}</span> <b>${esc(change.name)}</b> <span class="tag">${esc(typeLabel(change.type))}</span> <span class="muted">${esc(change.file ?? '')}</span></div>`];
  for (const note of change.breaking) parts.push(`<div class="bad-line">! ${esc(note)}</div>`);
  if (change.change === 'removed') parts.push('<div class="muted">Removed in the working tree.</div>');
  if (change.downstream) parts.push(`<div class="muted">↳ ${change.downstream} downstream node${change.downstream === 1 ? '' : 's'}</div>`);
  if (change.config.length) parts.push(`<h3>config</h3>${change.config.map((c) => `<div><span class="mono">${esc(c.field)}</span> ${fromTo(c.from, c.to)}</div>`).join('')}`);
  const cols = change.columns;
  if (cols.added.length || cols.removed.length || cols.typed.length) {
    parts.push(`<h3>columns</h3>${[
      ...cols.added.map((c) => `<div class="add">+ ${esc(c)}</div>`),
      ...cols.removed.map((c) => `<div class="del">- ${esc(c)}</div>`),
      ...cols.typed.map((c) => `<div>~ <span class="mono">${esc(c.name)}</span> ${fromTo(c.from, c.to)}</div>`)
    ].join('')}`);
  }
  if (change.deps.added.length || change.deps.removed.length) {
    parts.push(`<h3>depends on</h3>${[...change.deps.added.map((d) => `<div class="add">+ ${esc(d)}</div>`), ...change.deps.removed.map((d) => `<div class="del">- ${esc(d)}</div>`)].join('')}`);
  }
  if (change.reasons.includes('tests')) parts.push(`<h3>tests</h3><div>${fromTo(change.tests.from, change.tests.to)}</div>`);
  if (change.reasons.includes('description')) parts.push('<h3>description</h3><div class="muted">changed</div>');
  if (change.code) parts.push(`<h3>sql</h3>${codeHtml(change.code)}`);
  else if (change.reasons.includes('code')) parts.push('<h3>content</h3><div class="muted">file checksum changed (no SQL to show)</div>');
  return parts.join('');
}

export function impactHtml(diff) {
  const impacted = diff.impacted.length
    ? diff.impacted.map((n) => `<div class="imp"><span class="mono" title="${esc(n.name)}">${esc(n.name)}</span><span class="tag">${esc(typeLabel(n.type))}</span><span class="muted">via ${esc(n.via)}</span></div>`).join('')
    : '<div class="empty">No unchanged node sits downstream.</div>';
  const checklist = diff.checklist.length ? diff.checklist.map((c) => `<div class="check">[ ] ${esc(c)}</div>`).join('') : '<div class="empty">Nothing to check.</div>';
  return `<h3>downstream, unchanged</h3>${impacted}<h3>review checklist</h3>${checklist}`;
}
