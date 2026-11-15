import { LINES, mascotSvg, roamOf } from './lib/mascot.js';
import { barHtml, branchOptions, changeDetailHtml, changeListHtml, diffCountsHtml, countHtml, diffStatusHtml, doneOf, esc, filterChanges, fmtMs, impactHtml, logHtml, nextHtml, otelHintHtml, panels, phasesHtml, pick, pickAction, projectListHtml, promptText, riskHtml, runningHtml, runOptions, switcherHtml, staleFor, statusWord, tableHtml, tallyHtml, tipsHtml } from './lib/view.js';

const ACTION_MS = 2400;
const $ = (id) => document.getElementById(id);
const ui = { snapshot: null, projectDir: null, projectQuery: '', runKey: null, filter: 'all', action: null, actionTimer: null, prevRun: null, shown: null, connected: false, popup: null, tab: location.hash === '#diff' ? 'diff' : 'live', dfilter: 'all', change: null };
const FILTERS = [['all', 'All'], ['warn', 'Warn'], ['error', 'Error']];
const NO_RUN = '<div class="empty">No dbt run seen yet.</div>';

function setText(id, text) {
  const el = $(id);
  el.hidden = !text;
  el.textContent = text ?? '';
}

function setCommand(id, text) {
  $(`${id}-row`).hidden = !text;
  $(id).textContent = text ?? '';
  $(id).title = text ?? '';
}

function setHtml(id, html) {
  const el = $(id);
  if (el.innerHTML !== html) el.innerHTML = html;
}

const forced = new URLSearchParams(location.search).get('mascot');

function renderMascot(mood) {
  const name = forced && LINES[forced] ? forced : mood;
  if (ui.shown === name) return;
  ui.shown = name;
  const walker = $('walker');
  walker.className = `walker ${roamOf(name)}`;
  walker.style.setProperty('--track', `${$('track').clientWidth}px`);
  walker.innerHTML = mascotSvg(name);
  $('mood').innerHTML = `Dinor Sugar is <b>${esc(name)}</b>: ${esc(LINES[name])}`;
}

function play(action) {
  if (!action) return;
  clearTimeout(ui.actionTimer);
  ui.action = action;
  ui.actionTimer = setTimeout(() => {
    ui.action = null;
    render();
  }, ACTION_MS);
}

function renderLive() {
  const live = $('live');
  live.className = `live${ui.connected ? '' : ' off'}`;
  live.lastElementChild.textContent = ui.connected ? 'LIVE' : 'offline';
}

function popupView(kind, project, run, p, now) {
  if (kind === 'running') return [p.first, run ? tableHtml(p.firstHead, runningHtml(run, now)) : NO_RUN];
  if (kind === 'next') return [p.second, run ? `${tableHtml(p.secondHead, nextHtml(run))}<div class="risk">${riskHtml(run)}</div>` : NO_RUN];
  if (kind === 'tips') return ['Suggestions', tipsHtml(project?.suggestions ?? [], true)];
  if (kind === 'projects') return [`Projects (${ui.snapshot.projects.length})`, projectListHtml(ui.snapshot.projects, project?.dir, ui.projectQuery)];
  if (kind === 'change') return ['Diff detail', `<div class="detail">${changeDetailHtml(selectedChange(project))}</div>`];
  if (kind === 'impact') return ['Impact', project?.diff?.result ? `<div class="detail">${impactHtml(project.diff.result)}</div>` : '<div class="empty">No diff yet.</div>'];
  return ['dbt log · UTC', `<div class="log">${logHtml(run?.log ?? [], ui.filter)}</div>`];
}

function selectedChange(project) {
  const changes = project?.diff?.result?.changes ?? [];
  const shown = filterChanges(changes, ui.dfilter);
  return shown.find((c) => c.id === ui.change) ?? shown[0] ?? null;
}

function renderTabs(project) {
  for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === ui.tab));
  $('live-view').hidden = ui.tab !== 'live';
  $('diff-view').hidden = ui.tab !== 'diff';
  $('reading').hidden = ui.tab !== 'live';
  $('reading-diff').hidden = ui.tab !== 'diff';
  const result = project?.diff?.result;
  $('diff-count').textContent = result ? String(result.changes.length) : '';
}

function renderDiff(project) {
  const diff = project?.diff ?? null;
  setHtml('diff-status', diffStatusHtml(diff));
  const options = branchOptions(diff);
  setHtml('diff-base', options.base);
  setHtml('diff-head', options.head);
  $('diff-base').disabled = options.baseDisabled;
  $('diff-head').disabled = options.headDisabled;
  const result = diff?.result;
  setHtml('diff-counts', result ? diffCountsHtml(result.summary) : '');
  setCommand('diff-cmd', result?.command);
  const change = selectedChange(project);
  setHtml('diff-list', result ? changeListHtml(result.changes, change?.id, ui.dfilter) : '');
  setHtml('diff-detail', result ? changeDetailHtml(change) : '');
  setHtml('diff-impact', result ? impactHtml(result) : '');
}

function renderPopup(project, run, p, now) {
  if (!ui.popup) return;
  const [title, body] = popupView(ui.popup, project, run, p, now);
  $('pop-title').textContent = title;
  setHtml('pop-body', body);
}

function openPopup(kind, tip) {
  ui.popup = kind;
  $('pop-tools').innerHTML = kind === 'log'
    ? FILTERS.map(([id, label]) => `<button type="button" class="btn" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`).join('')
    : kind === 'projects'
      ? `<input type="search" id="pop-search" class="search" placeholder="filter by name, branch or path" aria-label="Filter projects" value="${esc(ui.projectQuery)}">`
      : '';
  $('pop-body').innerHTML = '';
  $('pop').showModal();
  render();
  const body = $('pop-body');
  if (kind === 'log') body.scrollTop = body.scrollHeight;
  else if (kind === 'projects') $('pop-search').focus();
  else if (tip !== undefined) document.getElementById(`tip-${tip}`)?.scrollIntoView();
  else body.scrollTop = 0;
}

function render() {
  renderLive();
  const snapshot = ui.snapshot;
  if (!snapshot) return;
  const now = Date.now();
  const picked = pick(snapshot, ui.projectDir, ui.runKey);
  document.body.classList.toggle('busy', snapshot.projects.some((p) => p.runs.some((r) => r.status === 'running')));
  const project = picked?.project ?? null;
  setHtml('where', switcherHtml(project, snapshot.projects));
  $('where').title = project?.dir ?? '';
  setHtml('run-select', runOptions(project, picked?.run?.key));
  $('run-pick').hidden = (project?.runs.length ?? 0) < 2;
  const hint = otelHintHtml(project);
  $('hint').hidden = !hint;
  setHtml('hint', hint);
  setHtml('tips', tipsHtml(project?.suggestions ?? []));
  const log = $('log');
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  setHtml('log', logHtml(picked?.run?.log ?? [], ui.filter));
  if (pinned) log.scrollTop = log.scrollHeight;
  const run = picked?.run;
  const p = panels(run);
  renderTabs(project);
  renderDiff(project);
  renderPopup(project, run, p, now);
  $('rn').textContent = p.first;
  $('nx').textContent = p.second;
  setHtml('running-head', p.firstHead);
  setHtml('next-head', p.secondHead);
  if (!run) {
    renderMascot(ui.action ?? 'waiting');
    setCommand('command', null);
    for (const id of ['target', 'version']) setText(id, '');
    for (const id of ['phases', 'bar', 'tally', 'running', 'next', 'risk', 'status']) setHtml(id, '');
    $('when').textContent = 'no dbt run seen yet';
    return;
  }
  setCommand('command', run.rawCommand ?? `dbt ${run.command}`);
  setText('target', [run.target && `target ${run.target}`, run.threads && `${run.threads} threads`].filter(Boolean).join(' · '));
  setText('version', run.version && `dbt ${run.version}`);
  const end = run.endedAt ?? now;
  const stale = staleFor(run, now);
  $('when').className = stale ? 'stale' : 'muted';
  $('when').textContent = stale
    ? `no new events for ${fmtMs(stale)}: dbt may have been stopped`
    : `${run.status === 'running' ? 'started' : run.status === 'success' ? 'finished' : 'failed'} · ${new Date(run.startedAt).toLocaleTimeString()} · ${run.status === 'running' ? 'elapsed' : 'took'} ${fmtMs(end - run.startedAt)}`;
  setHtml('phases', phasesHtml(run, now));
  setHtml('bar', barHtml(run));
  $('bar').setAttribute('aria-valuemax', String(run.total));
  $('bar').setAttribute('aria-valuenow', String(doneOf(run)));
  $('count').innerHTML = countHtml(run);
  const [word, color] = statusWord(run);
  $('status').textContent = word;
  $('status').style.color = color;
  setHtml('tally', tallyHtml(run));
  setHtml('running', runningHtml(run, now));
  setHtml('next', nextHtml(run));
  setHtml('risk', riskHtml(run));
  $('running-count').textContent = run.status === 'running' ? (run.running.length ? `${run.running.length} open` : '') : run.failed.length ? `${run.failed.length} failed` : '';
  $('queued-count').textContent = run.counts.queued ? `${run.counts.queued} queued` : '';
  renderMascot(ui.action ?? run.mood);
}

function onState(snapshot) {
  ui.snapshot = snapshot;
  const run = pick(snapshot, ui.projectDir, ui.runKey)?.run ?? null;
  play(pickAction(ui.prevRun, run));
  ui.prevRun = run;
  render();
}

function copyTo(button, text, label) {
  navigator.clipboard?.writeText(text).then(
    () => (button.textContent = 'Copied'),
    () => (button.textContent = 'Copy failed')
  );
  setTimeout(() => (button.textContent = label), 1600);
}

document.addEventListener('click', (event) => {
  const expand = event.target.closest('[data-expand]');
  if (expand) {
    openPopup(expand.dataset.expand, expand.dataset.tip);
    return;
  }
  if (event.target.closest('#pop-close') || event.target === $('pop')) {
    $('pop').close();
    return;
  }
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    ui.tab = tab.dataset.tab;
    history.replaceState(null, '', ui.tab === 'diff' ? '#diff' : location.pathname + location.search);
    render();
    return;
  }
  const change = event.target.closest('[data-change]');
  if (change) {
    ui.change = change.dataset.change;
    render();
    $('diff-detail').scrollTop = 0;
    document.querySelector(`[data-change="${CSS.escape(ui.change)}"]`)?.focus();
    return;
  }
  const dfilter = event.target.closest('[data-dfilter]');
  if (dfilter) {
    ui.dfilter = dfilter.dataset.dfilter;
    for (const b of document.querySelectorAll('[data-dfilter]')) b.setAttribute('aria-pressed', String(b === dfilter));
    render();
    return;
  }
  const build = event.target.closest('[data-build]');
  if (build) {
    build.disabled = true;
    post({ action: 'build', side: build.dataset.build });
    return;
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    copyTo(copy, $(copy.dataset.copy).textContent, 'Copy');
    return;
  }
  const row = event.target.closest('[data-project]');
  if (row) {
    ui.projectDir = row.dataset.project;
    ui.runKey = null;
    ui.prevRun = pick(ui.snapshot, ui.projectDir, null)?.run ?? null;
    $('pop').close();
    render();
    return;
  }
  const runButton = event.target.closest('[data-run]');
  if (runButton) {
    ui.runKey = runButton.dataset.run;
    ui.prevRun = pick(ui.snapshot, ui.projectDir, ui.runKey)?.run ?? null;
    render();
    return;
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    ui.filter = filter.dataset.filter;
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b === filter));
    render();
    return;
  }
  if (event.target.closest('#copy')) {
    const picked = pick(ui.snapshot, ui.projectDir, ui.runKey);
    const project = picked?.project ?? ui.snapshot?.projects[0];
    if (!project) return;
    copyTo($('copy'), promptText(project, project.suggestions), 'Copy as prompt');
  }
});

const TOKEN = document.querySelector('meta[name="sugar-token"]').content;

function post(body) {
  const project = pick(ui.snapshot, ui.projectDir, ui.runKey)?.project ?? ui.snapshot.projects[0];
  return fetch('/api/diff', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sugar-token': TOKEN }, body: JSON.stringify({ project: project.dir, ...body }) });
}

document.addEventListener('input', (event) => {
  if (event.target.id !== 'pop-search') return;
  ui.projectQuery = event.target.value;
  render();
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'run-select') {
    ui.runKey = event.target.value;
    ui.prevRun = pick(ui.snapshot, ui.projectDir, ui.runKey)?.run ?? null;
    render();
    return;
  }
  if (!event.target.matches('#diff-base, #diff-head')) return;
  const head = $('diff-head').value;
  post({ action: 'select', base: $('diff-base').value || null, head: head === 'worktree' ? null : head });
});

$('pop').addEventListener('close', () => {
  ui.popup = null;
});

window.addEventListener('hashchange', () => {
  ui.tab = location.hash === '#diff' ? 'diff' : 'live';
  render();
});

window.addEventListener('resize', () => $('walker').style.setProperty('--track', `${$('track').clientWidth}px`));

const events = new EventSource('/events');
events.addEventListener('open', () => {
  ui.connected = true;
  renderLive();
});
events.addEventListener('error', () => {
  ui.connected = false;
  renderLive();
});
events.addEventListener('state', (e) => onState(JSON.parse(e.data)));
setInterval(() => {
  if (pick(ui.snapshot, ui.projectDir, ui.runKey)?.run.status === 'running') render();
}, 1000);
