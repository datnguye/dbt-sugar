# 0002. Read-only, loopback-only, no outbound network

- Status: Accepted
- Date: 2026-11-15

## Context

The page shows project paths, SQL, error messages and branch names. It runs next to dbt, often on a laptop with warehouse credentials in a profile. It must never be the thing that leaks a project or breaks a run.

## Decision

- **Never write to a dbt project.** Only read `logs/`, `target/` and git metadata. The one exception is a temporary `git worktree` for parsing a branch ([0004](0004-diff-artifacts-per-commit.md)), created outside the project and always removed.
- **Writes go only to the sugar home** (`~/.dbt-sugar`, or `$DBT_SUGAR_HOME`).
- **Local only:** bind loopback, reject a foreign `Host` header, and require the per-launch token on the only POST route (`/api/diff`). Refs from the page must match a strict pattern before they reach git.
- **No outbound requests,** web fonts and CDNs included. One runtime dependency, `@duckdb/node-api` ([0003](0003-duckdb-history-and-run-archive.md)).
- Strict CSP; every project-derived string goes through `esc()`.

## Consequences

- **Easier:** safe to leave running; the security review is short.
- **Harder:** system fonts only; no remote viewing.
- **Forbidden:** `fetch` to non-local URLs, analytics, writes outside the sugar home and test temp folders.

## Revisit when

Someone needs to watch a CI or remote machine. That would be a new decision with authentication designed in, not a flag.
