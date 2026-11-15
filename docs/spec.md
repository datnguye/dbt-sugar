# dbt sugar: product spec

A local CLI and library that watches dbt v2 (Fusion) runs and serves a live page: what is running, what runs next, what to fix. It reads dbt's own files and never writes to a dbt project; its only writes go to its home (`~/.dbt-sugar`, or `$DBT_SUGAR_HOME`).

- npm package `dbt-sugar`, binary `sugar`.
- Node.js ≥ 22, stdlib plus one pinned runtime dependency, `@duckdb/node-api` (history only).
- Verified against dbt 2.0.11.

## Data sources

| What | File | Used for |
|---|---|---|
| Live run events | `<log-path>/otel*.jsonl` and `<log-path>/*/otel*.jsonl` (written when `DBT_OTEL_FILE_NAME` or `--otel-file-name` is set) | runs, phases, nodes, warnings, errors |
| Raw log | `<log-path>/dbt.log` and `<log-path>/*/dbt.log` | the log panel: v2 lines (`HH:MM:SS.ffffff [level]: text`) split into invocations at each `==== <time> | <invocation_id> ====` header, with indented continuation lines and the untimestamped `Execution Summary` block kept and `[debug]` lines (and their continuations) dropped; read incrementally from a remembered offset (first read: the last 8 MB), last 10 invocations, 5,000 lines each |
| Project graph | `<target-path>/manifest.json` | parents and children, tests per model, descriptions, source freshness |

`<log-path>` and `<target-path>` are `$DBT_LOG_PATH` and `$DBT_TARGET_PATH` when set, else `logs/` and `target/` under the project.

### OTel records read (one JSON object per line, grouped by `trace_id`)

| `event_type` suffix | Record | Fields |
|---|---|---|
| `invocation.Invocation` | SpanStart | `attributes.eval_args.{command,target,num_threads,profiles_dir}`, `raw_command`, `invocation_id`, `process_info.version` |
| `invocation.Invocation` | SpanEnd | `status.code` (2 = executed with errors) |
| `phase.PhaseExecuted` | SpanStart / SpanEnd | `attributes.phase` (`EXECUTION_PHASE_*`) |
| `node.NodeProcessed` | SpanStart = running, SpanEnd = finished | `unique_id`, `name`, `node_type`, `materialization`, `node_index`, `node_count_total`, `node_outcome`, `duration_ms`, `rows_affected`, `node_evaluation_detail.node_warning_outcome` |
| `log.LogMessage` | LogRecord, `severity_text` WARN or ERROR | `body`, `attributes.code_name`, `attributes.unique_id` |

Everything else is ignored. Each file is read incrementally from its last byte offset up to the last complete line; a file that shrinks is re-read from the start and its runs are dropped. At most 50 runs are kept in memory (finished ones are pruned first).

## Snapshot

For each project: whether an OTel file exists, the newest `dbt.log` invocation that has no OTel run and is newer than every run (**untracked**, so the page can say dbt ran without OTel), the manifest's dbt version, up to 10 runs (running first, then newest), live ones from the OTel log merged with archived ones, and suggestions for the newest run. Each run carries its own `dbt.log` lines (matched by the invocation header), so the log panel follows the selected run. Each run has:

- **counts**: success, warn (success with a node warning), error, skipped, running, queued (`node_count_total` minus nodes seen, while running).
- **running**: open nodes, each with its last-run duration and outcome.
- **next** (while running): nodes of the previous run of the same command not started yet, or, with no history, manifest children of nodes already seen. Ready nodes first; each lists the parents it still waits on. At most 8.
- **atRisk**: running or queued nodes that errored last run, with how many queued descendants would skip.
- **finished**: the last 40 finished nodes (drives the mascot actions).
- **mood**: `waiting` (no node started), `running`, `worried` (a node warning or a logged warning), `alarmed` (an error while running), `success`, `failed` (error status, or any error or skip).

## Suggestions

In order: node errors (title from the error's second line, "unblocks N nodes" = skipped descendants), flaky tests (failed ≥ 2 of the last 10 runs but not all), slow table models (median ≥ 60 s, suggests incremental), logged warnings grouped by code, models without tests, models without descriptions, sources without freshness. "Copy as prompt" turns them into one request for a coding agent.

## Run archive

When a run ends it is saved under `~/.dbt-sugar/runs/<project>/<startedAt>-<invocation>/`: `run.json` (phases, nodes, warnings, errors), `manifest.json` and `run_results.json` when their `invocation_id` matches, and the run's `dbt.log` slice. The newest 10 per project are kept and reloaded on start ([decision 0003](decisions/0003-duckdb-history-and-run-archive.md)).

## History

`history.duckdb` with `runs` and `nodes` tables. A run is saved once it has finished (re-saving replaces it); only the newest 10 runs per project are kept. Opened per operation and retried on lock conflicts. If DuckDB cannot load, the page works without history.

## CLI

```
sugar [-d <project-dir>]... [-p 4322] [--host 127.0.0.1] [--no-open] [-- <dbt command>]
```

- Loopback only; requests whose `Host` is not loopback on the bound port get 403; only GET is served.
- Default port 4322, then the next 9 if busy; an explicit `--port` (or 0) does not fall back.
- With `-- <command>` (exactly one project): runs it in the project with `DBT_OTEL_FILE_NAME=otel.jsonl` and `DBT_LOG_PATH=<log-path>/sugar-<time>-<pid>` unless already set (so parallel processes never share a `dbt.log`), keeps serving after it exits, and exits with its code on Ctrl-C.
- Routes: `/` (page, with a per-launch token), `/api/state` (snapshot), `/events` (SSE: `state` on change, `beat` every 5 s), and `POST /api/diff` (needs the token in `x-sugar-token`): `{project, action: 'select', base, head}` picks branches (refs must match `^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$`), `{project, action: 'build', side}` generates a side's artifacts. Everything else is GET only.

## Page

Black and red terminal theme; the page fills the window and never scrolls, each widget scrolls inside and can open in a popup. Header: a project switcher (current project, its git branch, and a summary such as `12 projects · 3 running · 1 failed`) that opens a searchable list sorted running → failed → passed → idle, the Live/Diff tabs, dbt version and live dot. The selected project's runs are picked from a dropdown in the overview when there are several; the OTel hint shows when the selected project has no OTel log, or when its latest dbt run wrote none (untracked); overview (phases with running times, progress, tally, mascot; the count reads nodes done over total while running and nodes passed over total once ended, next to RUNNING, FINISHING (every node done, dbt still wrapping up), PASSED or FAILED; the run picker and project list add `done` or `ok` to the same number), then two panels: **Running now** and **Up next** while a run is live ("+N more queued" when the queue is longer than the list), **Failed** (error line, how many nodes it blocked) and **Skipped** once it has ended. A live run with no new events for 30 s says so instead of ticking. Suggestions, and the log (newest at the bottom, auto-tails unless scrolled up; dbt.log times are UTC) with All / Warn / Error filters. Truncated node names show in full on hover. At phone width the mascot shrinks into the overview corner and optional columns hide. `?mascot=<name>` forces a mascot pose for previews.

### Mascot

Dinor Sugar, a pixel dinosaur chasing a pixel dbt logo: a 24×24 sprite (plus headroom for the logo) built from layers (head, body, legs, arm, face, props) and played frame by frame. The logo floats just out of reach while a run goes on, escapes on errors, and ends up in the dino's mouth when the run is green. Moods loop while their state holds; actions play for 2.4 s when the snapshot changes: `peek` (a new run appears), `bite` (a model or seed finished), `cheer` (a test passed), `gasp` (a node errored, or the run ended with errors), `shrug` (a node skipped), `rush` (the run ended clean). `prefers-reduced-motion` stops all animation.

## Library

`src/index.js` exports `createDbtSource`, `createSnapshotBuilder`, `runView`, `countsOf`, `moodOf`, `suggest`, the readers (`createOtelReader`, `applyRecord`, `createManifestReader`, `parseManifest`, `createLogReader`, `parseLog`) and the store (`createStore`, `sugarHome`). `./mascot`, `./view` and `./style.css` are exported for hosts that render their own page. A source is `{ dir, name, logDir, targetDir, watchDirs(), read() }`; a store is anything with `saveRun(project, run)`, `previousRun(project, command, before)` and `stats(project)`.

## Diff tab

Compares a **base** manifest with the project's current `target/manifest.json`.

- Sides: **base** is a git ref (default: `origin/HEAD`'s branch, else the first of `origin/main`, `main`, `origin/master`, `master`); **compare** is the working tree's `target/manifest.json` (default) or another ref. Both are chosen on the page. Each ref resolves to a commit; its artifacts live at `~/.dbt-sugar/base/<sha>/<project>/manifest.json`. When they are missing the page shows `dbt parse --target-path <that folder>` and a Generate button, which checks the commit out with `git worktree add --detach` into a temp folder, links `dbt_packages` and `dbt_internal_packages` from the project, runs `dbt parse` there (`$DBT_BIN` or `dbt`) with `DBT_PROFILES_DIR` and `DBT_TARGET` taken from sugar's environment, else from the newest run's `profiles_dir` and `target`, and removes the worktree. The working-tree side uses `target/manifest.json` when it exists; when it does not, the page offers the same Generate for the working tree, which runs `dbt parse --project-dir <project> --target-path ~/.dbt-sugar/base/worktree/<project> --log-path <that>/logs` without `DBT_OTEL_FILE_NAME`, so nothing is written into the project and the parse never shows up as a run; a Regenerate button refreshes it after edits. Base problems are reported before compare-side ones. A parse that exits with errors but writes a manifest is used with a warning; a failed parse shows dbt's `[error]` lines, plus how to set `DBT_PROFILES_DIR` when the profile is missing. Refs and the branch list are re-read every 30 s. `--no-diff` turns the tab off.
- Compared: nodes of the project's own package of type model, snapshot, seed, source, exposure, analysis, test, unit test. A node is modified when any of these differ: checksum (or raw code), `materialized`, `unique_key`, `incremental_strategy`, `on_schema_change`, `contract.enforced`, columns (added, removed, `data_type`), parents, description, number of attached tests. Constraint-only changes are not compared yet.
- Breaking: removed node that base nodes depended on; removed or retyped columns on an enforced contract; removed columns with downstream nodes; incremental config changes (needs `--full-refresh`); a contract newly enforced.
- Also shown: a line diff of the SQL (LCS, 3 lines of context, skipped above 1500 lines), downstream unchanged nodes with the change they come via, a checklist (changed models without tests, new models without a description, full-refresh reminders) and `dbt build --select <changed>+`.

## Layering (enforced by `npm run check`)

`dbt`, `core`, `server` and `web` import nothing else in `src/`, `history` may import `core`; `cli` wires them; `bin` imports `cli`. Only `src/history/store.js` imports DuckDB. Every `src/**/*.js` has a mirrored `test/unit/**/*.test.js`.
