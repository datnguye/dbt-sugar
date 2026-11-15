# 0004. Diff branches from dbt artifacts built per commit, on request

- Status: Accepted
- Date: 2026-11-15

## Context

Reviewers of big PRs need "what changed in the dbt project", not a line diff. dbt's own manifest has what is needed (checksum, raw code, typed columns, contract, incremental config, parents). Verified with jaffle-shop: parsing `HEAD~2` in a temporary worktree took 3.7 s and found the real `numeric` → `numeric(16, 2)` contract change. An earlier `--state`/`--base` CLI design pushed branch choice to start-up time; picking branches on the page is what reviewers actually do.

## Decision

- The Diff tab compares two manifests: a **base** ref (default: the repo's default branch) and a **compare** side (default: the working tree's `target/manifest.json`), both chosen on the page.
- Each ref's artifacts live at `~/.dbt-sugar/base/<sha>/<project>/`. When missing, the page shows the exact `dbt parse --target-path …` command and a Generate button that runs it in a temporary `git worktree` of that commit, linking the project's installed packages, then removes the worktree. Nothing is parsed automatically.
- Compare only the project's own package. Flag breaking changes (removed nodes still used, contract column changes, incremental config changes). No warehouse queries.

## Consequences

- **Easier:** no flags, no CI, no warehouse; artifacts are reused across restarts and branch switches.
- **Harder:** the base needs a working `dbt parse` (a profile); constraint-only and macro changes are not compared yet.
- **Forbidden:** running anything other than `git` read commands, `git worktree add/remove` and `dbt parse` from the page.

## Revisit when

Reviewers need data diffs (row counts, value diffs). That touches the warehouse and needs its own opt-in decision.
