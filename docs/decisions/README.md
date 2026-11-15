# Decision records

Short, permanent notes on choices that are expensive to revisit. Each one says what was decided, why, and what would make us change our minds. They stay put, like a dbt test that has finally gone green.

| # | Decision | Status |
|---|---|---|
| [0001](0001-otel-log-as-live-source.md) | Read live runs from dbt's OTel log, not from inside dbt | Accepted |
| [0002](0002-read-only-local-only.md) | Read-only, loopback-only, no outbound network | Accepted |
| [0003](0003-duckdb-history-and-run-archive.md) | Keep the last 10 invocations per project: a file archive plus DuckDB | Accepted |
| [0004](0004-diff-artifacts-per-commit.md) | Diff branches from dbt artifacts built per commit, on request | Accepted |
| [0005](0005-original-pixel-mascot.md) | The mascot is an original pixel character | Accepted |
| [0006](0006-quality-gates.md) | 100% coverage, hermetic tests, enforced layering, real-data fixtures | Accepted |

New decision: copy [`0000-template.md`](0000-template.md), take the next number, and add a row here in the same pull request.
