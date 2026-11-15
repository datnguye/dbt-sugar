# Contributing

dbt sugar is spec-driven: the contract moves first, the code follows, and the tests prove they agree. Change what the page does without touching `docs/spec.md` and a reviewer will ask why, politely and then less politely.

## The contract

| File | Holds |
|---|---|
| `docs/spec.md` | What the product does: data sources, snapshot, CLI, page, Diff tab, library. Behaviour only |
| `docs/decisions/` | Why it's built this way (OTel as the live source, read-only and local-only, the run archive, per-commit diff artifacts, …). Contradicting one needs a new record |
| `docs/proposals/` | Changes on their way in: problem, verified facts, spec delta, tests, out of scope |
| `docs/architecture.html` | The map: startup, live loop, keeping invocations and the Diff tab, animated. Update a flow when it moves |

## The loop

1. **Propose.** Write `docs/proposals/NNNN-<slug>.md` from the template and apply the spec delta to `docs/spec.md` in the same PR. A change that contradicts a decision record adds a new record. With Claude Code: `/spec <what should change>`.
2. **Verify facts.** Anything that reads dbt output cites a real dbt v2 run. Record new fixtures from a real build and scrub local paths.
3. **Tests first.** Every `src/` module has a mirrored test at `test/unit/<same path>`; page behaviour also gets a Playwright check in `test/ui/`.
4. **Implement** inside the layering: `dbt`, `core`, `server` and `web` import nothing else in `src/`, `history` may import `core`, `cli` wires them.
5. **Verify.** `npm run verify` (check, 100% coverage, Playwright) and `npm run spec-guard`. With Claude Code: `/build <proposal>` runs the whole loop, `/review` gets a second pair of eyes.
6. **Ship.** One-line conventional commits (`feat(web): add project switcher`), then a PR.

## Guards

| Guard | Where | Stops |
|---|---|---|
| `npm run check` | CI | Syntax errors, runtime deps other than `@duckdb/node-api`, outbound network, layering breaks, `src/` modules without a mirrored test |
| `npm test` | CI | Anything below 100% line, branch or function coverage |
| `npm run test:ui` | CI | Page regressions against a frozen replay of two real dbt projects |
| `npm run spec-guard` | CI on PRs, Claude Code Stop hook | `src/` changes with no contract or no test change |
| `dbt-compat` workflow | Monthly | dbt Fusion changing its OTel log |
| `.githooks/commit-msg` | Every `git commit` (installed by `npm install`) | Anything other than one conventional line |

## Setup

```sh
npm install            # also points git at .githooks
npx playwright install chromium
npm run playground     # two dbt projects replaying live, real page
npm run demo:gif       # re-record the README demo (needs ffmpeg)
```

Node 22 or newer. One runtime dependency, `@duckdb/node-api` for history ([decision 0003](docs/decisions/0003-duckdb-history-and-run-archive.md)), and we'd like to keep it at one.
