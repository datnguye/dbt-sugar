import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as view from '../../../../src/web/lib/view.js';

const counts = (extra = {}) => ({ success: 0, warn: 0, error: 0, skipped: 0, running: 0, queued: 0, ...extra });

function run(extra = {}) {
  return { key: 'r1', command: 'build', status: 'running', total: 10, counts: counts({ success: 3, running: 2, queued: 5 }), warnings: 0, phases: [], running: [], next: [], atRisk: [], finished: [], failed: [], skipped: [], lastEventAt: 0, mood: 'running', ...extra };
}

function snapshot(...projects) {
  return { projects };
}

test('esc and fmtMs', () => {
  assert.equal(view.esc(`<a href="x">'&`), '&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  assert.equal(view.esc(null), '');
  assert.equal(view.fmtMs(null), '—');
  assert.equal(view.fmtMs(undefined), '—');
  assert.equal(view.fmtMs(12.4), '12 ms');
  assert.equal(view.fmtMs(1500), '1.50s');
  assert.equal(view.fmtMs(15000), '15.0s');
  assert.equal(view.fmtMs(125000), '2m 5s');
});

function project(name, runs, branch = null) {
  return { name, dir: `/w/${name}`, runs, diff: branch ? { git: { current: branch } } : null };
}

const LIVE = run({ key: 'live' });
const DONE = run({ key: 'done', status: 'success', counts: counts({ success: 10 }) });
const BAD = run({ key: 'bad', status: 'error', counts: counts({ success: 9, error: 1 }) });

test('projectState: running, passed, failed or idle', () => {
  assert.equal(view.projectState(project('a', [LIVE])), 'running');
  assert.equal(view.projectState(project('a', [DONE])), 'passed');
  assert.equal(view.projectState(project('a', [BAD])), 'failed');
  assert.equal(view.projectState(project('a', [run({ status: 'success', counts: counts({ error: 1 }) })])), 'failed');
  assert.equal(view.projectState(project('a', [])), 'idle');
});

test('pick follows the chosen project and run, else the most active project and its latest run', () => {
  const s = snapshot(project('zeta', [DONE]), project('alpha', [BAD]), project('mid', [LIVE, DONE]), project('idle', []));
  assert.equal(view.pick(s, null, null).project.name, 'mid');
  assert.equal(view.pick(s, null, null).run, LIVE);
  assert.equal(view.pick(s, '/w/zeta', null).run, DONE);
  assert.equal(view.pick(s, '/w/mid', 'done').run, DONE);
  assert.equal(view.pick(s, '/w/mid', 'gone').run, LIVE);
  assert.equal(view.pick(s, '/w/idle', null).run, null);
  assert.equal(view.pick(snapshot(project('b', [DONE]), project('a', [DONE])), null, null).project.name, 'a');
  assert.equal(view.pick(snapshot(), null, null), null);
  assert.equal(view.pick(null, null, null), null);
});

test('the switcher and its summary stay one line however many projects there are', () => {
  const many = Array.from({ length: 100 }, (_, i) => project(`p${i}`, i < 3 ? [LIVE] : i < 4 ? [BAD] : [DONE], i === 0 ? 'feature/x' : null));
  assert.equal(view.projectSummary(many), '100 projects · 3 running · 1 failed');
  assert.equal(view.projectSummary([project('solo', [DONE])]), '1 project');
  const html = view.switcherHtml(many[0], many);
  assert.match(html, /<b>p0<\/b><span class="branch"> @feature\/x<\/span><span class="muted"> ▾ 100 projects · 3 running · 1 failed/);
  assert.doesNotMatch(view.switcherHtml(many[5], [many[5]]), /▾|branch/);
  assert.match(view.switcherHtml(null, []), /no project/);
});

test('the project list sorts by status, filters by name, branch or path, and marks the current one', () => {
  const list = [project('zeta', [DONE]), project('alpha', [BAD], 'fix/y'), project('mid', [LIVE]), project('idle', [])];
  const html = view.projectListHtml(list, '/w/alpha', '');
  assert.deepEqual([...html.matchAll(/data-project="\/w\/(\w+)"/g)].map((m) => m[1]), ['mid', 'alpha', 'zeta', 'idle']);
  assert.match(html, /4 of 4/);
  assert.match(html, /data-project="\/w\/alpha" aria-pressed="true">.*@fix\/y.*build · 9\/10 ok · failed/);
  assert.match(html, /build · 3\/10 done · running/);
  assert.match(html, /build · 10\/10 ok · passed/);
  assert.match(html, /no run yet/);
  assert.match(view.projectListHtml(list, null, ' FIX/'), /1 of 4.*alpha/);
  assert.match(view.projectListHtml(list, null, '/w/ze'), /1 of 4.*zeta/);
  assert.match(view.projectListHtml(list, null, 'nothing'), /No project matches/);
});

test('runOptions lists a project’s runs with the selected one marked', () => {
  const html = view.runOptions(project('p', [LIVE, run({ key: 'old', command: null, status: 'success', counts: counts({ success: 10 }) })]), 'old');
  assert.match(html, /<option value="live">build · 3\/10 done · running · /);
  assert.match(html, /<option value="old" selected>dbt · 10\/10 ok · passed · /);
  assert.equal(view.runOptions(null, null), '');
});

test('phases, bar and tally', () => {
  const phases = [{ name: 'parse', startedAt: 0, endedAt: 200 }, { name: 'run', startedAt: 100, endedAt: null }, { name: 'mystery', startedAt: 0, endedAt: 5 }];
  const html = view.phasesHtml(run({ phases }), 1000);
  assert.match(html, /Parse<span class="mono">200 ms/);
  assert.match(html, /phase live.*Run<span class="mono">900 ms/);
  assert.match(html, /mystery/);
  assert.equal(view.doneOf(run({ counts: counts({ success: 1, warn: 2, error: 3, skipped: 4 }) })), 10);
  assert.equal(view.countHtml(run({ counts: counts({ success: 1, warn: 2, error: 3, skipped: 4 }) })), '10<span class="muted">/10</span>');
  assert.equal(view.countHtml(run({ status: 'error', counts: counts({ success: 1, warn: 2, error: 3, skipped: 4 }) })), '3<span class="muted">/10</span>');
  assert.match(view.barHtml(run()), /class="success" style="width:30\.00%;background:var\(--pass\)/);
  assert.match(view.barHtml(run({ total: 0 })), /width:300\.00%/);
  assert.doesNotMatch(view.tallyHtml(run()), /log warnings/);
  assert.match(view.tallyHtml(run({ warnings: 8 })), /log warnings<b>8/);
});

test('running rows flag slow nodes and describe the last run', () => {
  assert.match(view.runningHtml(run(), 0), /Nothing running/);
  assert.match(view.runningHtml(run({ status: 'success' }), 0), /Nothing failed/);
  const failed = view.runningHtml(run({ status: 'error', failed: [{ name: 'locations', type: 'model', error: 'Catalog Error', blocked: 16 }, { name: 'x', type: 'test', error: null, blocked: 1 }, { name: 'y', type: 'seed', error: 'e', blocked: 0 }] }), 0);
  assert.match(failed, /title="locations">locations/);
  assert.match(failed, /Catalog Error · blocked 16 nodes/);
  assert.match(failed, /failed · blocked 1 node</);
  assert.match(failed, />e<\/td>/);
  const rows = view.runningHtml(run({
    running: [
      { name: 'a', type: 'model', materialization: 'table', startedAt: 0, last: { ms: 1000, outcome: 'success' } },
      { name: 'b', type: 'unit_test', materialization: 'unit', startedAt: 0, last: { ms: 10, outcome: 'error' } },
      { name: 'c', type: 'seed', materialization: 'table', startedAt: 0, last: null },
      { name: 'd', type: 'test', materialization: null, startedAt: 0, last: { ms: 5, outcome: 'skipped' } },
      { name: 'e', type: 'model', materialization: 'model', startedAt: 0, last: { ms: 5000, outcome: 'success' } },
      { name: 'f', type: null, materialization: null, startedAt: 0, last: { ms: 1, outcome: 'success' } }
    ]
  }), 2000);
  assert.match(rows, /model · table/);
  assert.match(rows, /unit test/);
  assert.match(rows, /mono slow">2\.00s/);
  assert.match(rows, /failed after 10 ms/);
  assert.match(rows, /first run/);
  assert.match(rows, /muted">skipped/);
  assert.match(rows, /<td class="mono">2\.00s<\/td><td class="col-opt"><span class="mono">5\.00s/);
});

test('next rows, risk and tips', () => {
  assert.match(view.nextHtml(run()), /Queue unknown/);
  assert.match(view.nextHtml(run({ counts: counts({ queued: 0 }) })), /Nothing queued/);
  assert.match(view.nextHtml(run({ status: 'success' })), /Nothing was skipped/);
  const skipped = view.nextHtml(run({ status: 'error', skipped: [{ name: 'orders', type: 'model', via: 'locations' }, { name: 'odd', type: 'unit_test', via: null }] }));
  assert.match(skipped, /title="orders">orders<\/td><td class="col-opt"><span class="tag">model<\/span><\/td><td class="err">blocked by locations/);
  assert.match(skipped, /unit test.*>skipped</);
  const next = view.nextHtml(run({ next: [{ name: 'o', waitingOn: ['l', 'i'], last: null }, { name: 'r', waitingOn: [], last: null }] }));
  assert.match(next, /l, i/);
  assert.match(next, /ready/);
  assert.match(next, /\+3 more queued/);
  assert.doesNotMatch(view.nextHtml(run({ counts: counts({ queued: 1 }), next: [{ name: 'o', waitingOn: [], last: null }] })), /more queued/);
  assert.equal(view.riskHtml(run({ atRisk: [{ name: 'l', count: 1 }, { name: 'm', count: 2 }] })), 'At risk: <span class="mono">l</span> failed last run. If it fails again, 1 queued node skip.<br>At risk: <span class="mono">m</span> failed last run. If it fails again, 2 queued nodes skip.');
  assert.match(view.tipsHtml([]), /Suspiciously sweet/);
  const tips = [{ kind: 'ERROR', title: 't<', gain: 'g', why: 'w', fix: 'f' }, { kind: 'DOCS', title: 'd', gain: 'g', why: 'w', fix: '' }];
  const html = view.tipsHtml(tips);
  assert.match(html, /k-error/);
  assert.match(html, /t&#60;/);
  assert.equal((html.match(/data-expand="tips"/g) ?? []).length, 2);
  assert.match(html, /data-tip="1"/);
  assert.doesNotMatch(html, /<pre>/);
  const full = view.tipsHtml(tips, true);
  assert.match(full, /<details open id="tip-0">/);
  assert.equal((full.match(/<pre>/g) ?? []).length, 1);
  assert.match(view.tipsHtml([], true), /Suspiciously sweet/);
  assert.equal(view.tableHtml('<th>A</th>', '<tr><td>1</td></tr>'), '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
  const prompt = view.promptText({ dir: '/p' }, tips);
  assert.match(prompt, /^In the dbt project at \/p/);
  assert.match(prompt, /1\. \[ERROR\] t<\nw\nSuggested change:\nf/);
  assert.match(prompt, /2\. \[DOCS\] d\nw$/);
});

test('log lines filter by level', () => {
  const lines = [{ t: '1', level: 'info', text: 'a' }, { t: '2', level: 'warn', text: 'b' }];
  assert.equal((view.logHtml(lines, 'all').match(/<div>/g) ?? []).length, 2);
  assert.match(view.logHtml(lines, 'warn'), /class="warn">b/);
  assert.match(view.logHtml(lines, 'error'), /No log lines/);
});

test('pickAction turns snapshot changes into one mascot action', () => {
  const done = (id, outcome, type = 'model') => ({ id, outcome, type });
  const base = run({ finished: [done('a', 'success')] });
  assert.equal(view.pickAction(base, null), null);
  assert.equal(view.pickAction(null, base), null);
  assert.equal(view.pickAction(run({ key: 'old', status: 'success' }), base), 'peek');
  assert.equal(view.pickAction(run({ key: 'x' }), run({ status: 'success' })), null);
  assert.equal(view.pickAction(base, run({ status: 'success', mood: 'success', finished: [] })), 'rush');
  assert.equal(view.pickAction(base, run({ status: 'error', mood: 'failed', finished: [] })), 'gasp');
  assert.equal(view.pickAction(base, run({ finished: [done('a', 'success'), done('b', 'error')] })), 'gasp');
  assert.equal(view.pickAction(base, run({ finished: [done('c', 'skipped')] })), 'shrug');
  assert.equal(view.pickAction(base, run({ finished: [done('d', 'success', 'test')] })), 'cheer');
  assert.equal(view.pickAction(base, run({ finished: [done('d', 'success', 'unit_test')] })), 'cheer');
  assert.equal(view.pickAction(base, run({ finished: [done('e', 'success')] })), 'bite');
  assert.equal(view.pickAction(base, base), null);
});

test('panels switch to failed and skipped once a run ends; stale runs are flagged', () => {
  assert.equal(view.panels(null).first, 'Running now');
  assert.equal(view.panels(run()).second, 'Up next');
  assert.match(view.panels(run()).firstHead, /ELAPSED/);
  const done = view.panels(run({ status: 'error' }));
  assert.deepEqual([done.first, done.second], ['Failed', 'Skipped']);
  assert.match(done.firstHead, /ERROR/);
  assert.match(done.secondHead, /BLOCKED BY/);
  assert.deepEqual(view.statusWord(null), ['', '']);
  assert.deepEqual(view.statusWord(run()), ['RUNNING', 'var(--run)']);
  assert.deepEqual(view.statusWord(run({ counts: counts({ success: 9, skipped: 1 }) })), ['FINISHING', 'var(--run)']);
  assert.deepEqual(view.statusWord(run({ status: 'success' })), ['PASSED', 'var(--pass)']);
  assert.deepEqual(view.statusWord(run({ status: 'success', counts: counts({ error: 1 }) })), ['FAILED', 'var(--error)']);
  assert.deepEqual(view.statusWord(run({ status: 'error' })), ['FAILED', 'var(--error)']);
  assert.equal(view.staleFor(run({ lastEventAt: 0 }), 40000), 40000);
  assert.equal(view.staleFor(run({ lastEventAt: 0 }), 1000), 0);
  assert.equal(view.staleFor(run({ status: 'success' }), 99999), 0);
  assert.equal(view.staleFor(null, 99999), 0);
});

function change(extra = {}) {
  return { id: 'model.p.orders', name: 'orders', type: 'model', file: 'models/orders.sql', change: 'modified', reasons: [], config: [], columns: { added: [], removed: [], typed: [] }, deps: { added: [], removed: [] }, tests: null, code: null, downstream: 0, breaking: [], ...extra };
}

function diff(extra = {}) {
  return { status: 'ready', side: 'base', ref: 'origin/main', sha: 'abcdef1234', out: '/cache/abcdef1234/p', head: null, git: null, warning: null, currentAt: '2026-11-15T10:51:44.123Z', ...extra };
}

test('diffStatusHtml describes both sides and what each needs', () => {
  assert.match(view.diffStatusHtml(null), /--no-diff/);
  const ready = view.diffStatusHtml(diff());
  assert.match(ready, /origin\/main@abcdef1<\/span> <span class="muted">→<\/span> <span class="mono">working tree/);
  assert.match(ready, /target\/manifest\.json · 2026-11-15 10:51:44 UTC/);
  assert.doesNotMatch(ready, /hint/);
  assert.match(view.diffStatusHtml(diff({ warning: 'partial' })), /hint">partial/);
  assert.match(view.diffStatusHtml(diff({ status: 'resolving', sha: null, currentAt: null })), /Looking up the base branch <span class="mono">origin\/main<\/span> in git/);
  const missing = view.diffStatusHtml(diff({ status: 'missing' }));
  assert.match(missing, /No dbt artifacts for the base branch/);
  assert.match(missing, /id="diff-build-cmd">dbt parse --target-path \/cache\/abcdef1234\/p</);
  assert.match(missing, /data-build="base">Generate</);
  assert.match(view.diffStatusHtml(diff({ status: 'parsing' })), /Running <code>dbt parse<\/code> for the base branch/);
  const head = { ref: 'feature/x', sha: 'bbbb2222cc', status: 'missing' };
  const headMissing = view.diffStatusHtml(diff({ status: 'missing', side: 'head', head, out: '/cache/bbbb/p' }));
  assert.match(headMissing, /<span class="mono">feature\/x@bbbb222<\/span> <span class="muted">\(parsed/);
  assert.match(headMissing, /compare branch <span class="mono">feature\/x@bbbb222/);
  assert.match(headMissing, /data-build="head">Generate/);
  const error = view.diffStatusHtml(diff({ status: 'error', error: 'no <manifest>' }));
  assert.match(error, /hint err">no &#60;manifest&#62;/);
  assert.match(error, /data-build="base">Retry/);
  assert.doesNotMatch(view.diffStatusHtml(diff({ status: 'error', error: 'x', out: null })), /Retry/);
  assert.doesNotMatch(view.diffStatusHtml(diff({ currentAt: null })), /UTC/);
});

test('diffCommand and branchOptions', () => {
  assert.equal(view.diffCommand(null), null);
  assert.equal(view.diffCommand(diff({ out: null })), null);
  assert.equal(view.diffCommand(diff()), 'dbt parse --target-path /cache/abcdef1234/p');
  assert.deepEqual(view.branchOptions(null), { base: '', head: '', baseDisabled: true, headDisabled: true });
  const none = view.branchOptions(diff({ ref: 'main' }));
  assert.equal(none.base, '<option value="main" selected>main</option>');
  assert.equal(none.head, '<option value="worktree" selected>current · working tree</option>');
  assert.deepEqual([none.baseDisabled, none.headDisabled], [true, true]);
  const git = { current: 'feature/x', branches: ['feature/x', 'main'] };
  const opts = view.branchOptions(diff({ ref: 'main', git, head: { ref: 'feature/y', sha: 'c', status: 'ready' } }));
  assert.match(opts.base, /<option value="main" selected>main<\/option><option value="feature\/x">/);
  assert.match(opts.head, /^<option value="worktree">feature\/x · working tree<\/option><option value="feature\/y" selected>/);
  assert.deepEqual([opts.baseDisabled, opts.headDisabled], [false, false]);
  assert.equal(view.branchOptions(diff({ ref: null, git })).base.includes('selected'), false);
});

test('diffCountsHtml, filterChanges and changeListHtml', () => {
  assert.match(view.diffCountsHtml({ added: 1, modified: 2, removed: 3, breaking: 4, impacted: 5 }), /~ modified<b>2<\/b>.*↳ downstream<b>5/);
  const list = [change(), change({ id: 's', name: 'raw', type: 'seed', change: 'added', reasons: ['code'], downstream: 2 }), change({ id: 'b', name: 'gone', change: 'removed', breaking: ['x'] })];
  assert.equal(view.filterChanges(list, 'all').length, 3);
  assert.equal(view.filterChanges(list, 'models').length, 2);
  assert.deepEqual(view.filterChanges(list, 'breaking').map((c) => c.name), ['gone']);
  assert.match(view.changeListHtml([], null, 'all'), /Nothing differs/);
  assert.match(view.changeListHtml([change()], null, 'breaking'), /Nothing matches/);
  const html = view.changeListHtml(list, 's', 'all');
  assert.match(html, /c-added" data-change="s" aria-pressed="true"><span class="sign" aria-hidden="true">\+<\/span><span class="sr">added: <\/span>/);
  assert.match(html, /code · 2 downstream/);
  assert.match(html, /<span class="sr">removed, breaking: <\/span>/);
  assert.match(html, /class="bad" aria-hidden="true"/);
  assert.equal((html.match(/class="bad"/g) ?? []).length, 1);
});

test('codeHtml marks added, removed, skipped and context lines', () => {
  const html = view.codeHtml([{ op: ' ', text: 'a' }, { op: '+', text: 'b<' }, { op: '-', text: 'c' }, { op: '…', text: '3 unchanged lines' }]);
  assert.match(html, /<span class="ln">  a<\/span>/);
  assert.match(html, /ln add">\+ b&#60;/);
  assert.match(html, /ln del">- c/);
  assert.match(html, /ln gap">… 3 unchanged lines/);
});

test('changeDetailHtml shows every reason a reviewer needs', () => {
  assert.match(view.changeDetailHtml(null), /Pick a change/);
  assert.match(view.changeDetailHtml(change({ change: 'removed', file: null })), /Removed in the working tree/);
  assert.match(view.changeDetailHtml(change({ downstream: 1 })), /↳ 1 downstream node</);
  const full = view.changeDetailHtml(change({
    reasons: ['code', 'config', 'columns', 'deps', 'tests', 'description'],
    breaking: ['enforced contract changes'],
    downstream: 2,
    config: [{ field: 'materialized', from: 'table', to: 'incremental' }],
    columns: { added: ['fresh'], removed: ['old'], typed: [{ name: 'id', from: null, to: 'int' }, { name: 'gone_type', from: 'int', to: null }] },
    deps: { added: ['model.p.a'], removed: ['model.p.b'] },
    tests: { from: 1, to: 2 },
    code: [{ op: '+', text: 'select 2' }]
  }));
  for (const part of [/bad-line">! enforced contract changes/, /↳ 2 downstream nodes/, /materialized<\/span> <span class="del">table<\/span> → <span class="add">incremental/, /add">\+ fresh/, /del">- old/, /id<\/span> <span class="del">∅<\/span> → <span class="add">int/, /gone_type<\/span> <span class="del">int<\/span> → <span class="add">∅/, /add">\+ model\.p\.a/, /del">- model\.p\.b/, /# tests|<h3>tests<\/h3><div><span class="del">1/, /<h3>description<\/h3>/, /<h3>sql<\/h3><pre class="code">/]) assert.match(full, part);
  assert.match(view.changeDetailHtml(change({ reasons: ['code'], type: 'seed' })), /file checksum changed/);
  assert.doesNotMatch(view.changeDetailHtml(change({ reasons: ['columns'] })), /<h3>/);
});

test('impactHtml lists downstream nodes and the checklist, or says there are none', () => {
  const html = view.impactHtml({ impacted: [{ name: 'customers', type: 'unit_test', via: 'orders' }], checklist: ['orders has no tests'] });
  assert.match(html, /customers.*unit test.*via orders/);
  assert.match(html, /\[ \] orders has no tests/);
  const empty = view.impactHtml({ impacted: [], checklist: [] });
  assert.match(empty, /No unchanged node sits downstream/);
  assert.match(empty, /Nothing to check/);
});

test('the working-tree side explains itself: Generate into the sugar cache, then Regenerate after edits', () => {
  const base = { status: 'ready', ref: 'main', sha: 'abcdef1234', side: 'head', head: null, out: '/home/.dbt-sugar/base/worktree/p', currentAt: null };
  const missing = view.diffStatusHtml({ ...base, status: 'missing' });
  assert.match(missing, /No dbt artifacts for the working tree yet \(no <code>target\/manifest\.json<\/code>\)/);
  assert.match(missing, /in your project folder; dbt writes to sugar's cache, never to <code>target\/<\/code>/);
  assert.match(missing, /data-build="head">Generate/);
  assert.match(missing, /dbt parse --target-path \/home\/\.dbt-sugar\/base\/worktree\/p/);
  assert.match(view.diffStatusHtml({ ...base, status: 'parsing' }), /Running <code>dbt parse<\/code> for the working tree in your project folder/);
  const sugar = view.diffStatusHtml({ ...base, side: 'base', compareSource: 'sugar', currentAt: '2026-11-15T12:00:00.000Z' });
  assert.match(sugar, /\(sugar's parse · 2026-11-15 12:00:00 UTC\)/);
  assert.match(sugar, /Comparing against sugar's parse of the working tree.*data-build="head">Regenerate/);
  assert.doesNotMatch(sugar, /class="muted">dbt parse reported/);
  assert.match(view.diffStatusHtml({ ...base, side: 'base', compareSource: 'sugar', compareWarning: 'dbt parse reported errors at the working tree' }), /<span class="muted">dbt parse reported errors at the working tree<\/span>/);
  assert.doesNotMatch(view.diffStatusHtml({ ...base, side: 'base', compareSource: 'target' }), /Regenerate/);
});

test('the OTel hint covers a project without OTel and a latest run dbt wrote without it', () => {
  assert.equal(view.otelHintHtml(null), '');
  assert.match(view.otelHintHtml({ ...project('a&b', []), otel: false }), /No OTel log in <code>a&#38;b\/logs<\/code>.*export DBT_OTEL_FILE_NAME=otel\.jsonl/);
  assert.match(view.otelHintHtml({ ...project('p', []), otel: true, untracked: { invocationId: 'x', at: 0 } }), /latest dbt run \(.+\) wrote no OTel log/);
  assert.equal(view.otelHintHtml({ ...project('p', []), otel: true, untracked: null }), '');
});
