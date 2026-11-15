# 0003. Keep the last 10 invocations per project: a file archive plus DuckDB

- Status: Accepted
- Date: 2026-11-15

## Context

`target/` and `logs/otel.jsonl` are overwritten by the next dbt run, so a page restart or a new build wipes what was just watched. "Slower than usual", "flaky" and a queue of what runs next all need a previous run of the same command.

## Decision

- **Archive per invocation:** when a run ends, save `run.json` (every phase, node, warning and error), plus `manifest.json` and `run_results.json` only if their `invocation_id` matches, plus the run's `dbt.log` slice, under `~/.dbt-sugar/runs/<project>/<startedAt>-<invocation>/`. Keep the newest 10 per project and reload them on start.
- **DuckDB history:** `runs` and `nodes` tables in `~/.dbt-sugar/history.duckdb`, trimmed to the same 10 per project, opened per operation. Only `src/history/store.js` imports DuckDB. If DuckDB cannot load, the page works without history.

## Consequences

- **Easier:** past invocations survive restarts and overwritten artifacts; the queue, "last run" and flaky tests work offline.
- **Harder:** two places to keep in step (both trim to 10).
- **Forbidden:** storing data rows, profiles or credentials; growing past 10 invocations per project.

## Revisit when

Someone needs longer history or cross-machine history; then raise the limit behind a setting or merge per-machine files, as Agent Cage does.
