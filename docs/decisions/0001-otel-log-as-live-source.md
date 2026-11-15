# 0001. Read live runs from dbt's OTel log, not from inside dbt

- Status: Accepted
- Date: 2026-11-15

## Context

The first version of dbt-baby-sugar was a Python plugin on dbt-core's event bus. dbt v2 (Fusion, a Rust binary) has no Python event bus, so that approach is gone. Verified on dbt 2.0.11 with a real jaffle-shop build on DuckDB: with `--otel-file-name` (or `DBT_OTEL_FILE_NAME`), dbt writes `logs/otel*.jsonl` with `Invocation`, `PhaseExecuted` and `NodeProcessed` spans (SpanStart = running, SpanEnd = outcome, duration, rows, `node_index` of `node_count_total`) and WARN/ERROR `LogMessage` records with codes and `unique_id`. `dbt.log` mixes v1 and v2 line formats, and `run_results.json` lists 14 thread ids for a 4-thread run, so neither is a reliable live source.

## Decision

- The live view is built only from `logs/otel*.jsonl`, read incrementally by byte offset and grouped by `trace_id`.
- `dbt.log` is only shown as text, split per invocation by its `==== <time> | <invocation_id> ====` headers.
- `sugar -- dbt …` sets `DBT_OTEL_FILE_NAME=otel.jsonl` when unset; parallel processes use one `otel-*.jsonl` each.
- No thread lanes: v2 does not report which thread ran a node.

## Consequences

- **Easier:** works with any dbt v2 command and any number of processes, and needs no dbt plugin or adapter code.
- **Harder:** runs started without the env var or flag don't show up live; the page says how to turn it on.
- **Forbidden:** parsing dbt's terminal output, or importing dbt.

## Revisit when

dbt stops writing the OTel file, renames these event types (the monthly `dbt-compat` workflow fails), or ships a stable live API.
