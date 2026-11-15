# dbt sugar

A Node.js CLI (`sugar`, npm package `dbt-sugar`) that serves a local web page watching dbt v2 (Fusion) runs: what is running, what is next, what failed and how to fix it (**Live** tab), and what a branch changes compared with its base (**Diff** tab). Dinor Sugar, a pixel dinosaur chasing a pixel dbt logo, reacts to every run.

- **Contract:** `docs/spec.md` (behaviour), `docs/decisions/` (why), `docs/proposals/` (changes on the way in). The map (startup, live loop, keeping invocations, Diff tab): `docs/architecture.html` (animated, self-contained); update its flows when one of those flows changes.
- **Spec first.** A `src/` change comes with a contract change and a test change; `npm run spec-guard`, the Stop hook and CI enforce it. Contributor flow: `CONTRIBUTING.md`.

## Commands

| Command | What it does |
|---|---|
| `npm run playground` | Two git-backed dbt projects replaying real dbt v2 runs, with past invocations; opens the page. `--loop`, `--frozen`, `--empty`, `--port`, `--no-open` |
| `npm start -- -d <project>` | The real thing against a dbt project (`-- dbt build …` to run dbt through sugar) |
| `npm run check` | Syntax check, one-dependency guard, no-outbound-network guard, layering, mirrored tests |
| `npm test` | Unit and e2e tests (`node:test`), with 100% coverage enforced on `src/**` (bin, scripts and `web/app.js` excluded) |
| `npm run test:ui` | Playwright UI suite against a frozen playground |
| `npm run verify` | `check`, `test` and `test:ui` in a row |
| `npm run ux:shots` | Screenshots of every UI state into `ux-shots/` |
| `npm run demo:gif` | Re-records `docs/assets/img/demo.gif` from a live playground (needs `ffmpeg`) |
| `npm run spec-guard` | `src/` changed → contract and tests must change too (`-- --base <ref>` for a branch) |

## SDLC harness

| Kind | Name | Use |
|---|---|---|
| Command | `/spec <change>` | Proposal + spec delta, no code (skill `spec-change`) |
| Command | `/build <proposal>` | Tests first → code → verify → reviews → commit (skill `deliver`) |
| Command | `/review [base]` | `spec-reviewer` + `code-reviewer` in parallel, then `/lazy:lazy-review` |
| Command | `/ship [subject]` | Verify, spec-guard, conventional commit, ask before push |
| Command | `/test` | Check and unit tests with the coverage table |
| Skill | `/verify`, `/ux-review`, `/release` | All checks; UI loop until SHIP; cut a release: collapse the spec, version bump, release notes from commits (you push, then create the GitHub release, which makes the `X.Y.Z` tag) |
| Subagent | `spec-reviewer`, `code-reviewer`, `ux-reviewer`, `data-prober` | Read-only reviewers; `data-prober` measures real dbt output before a spec line depends on it |
| Hook | PreToolUse `block-secrets`, `commit-guard`; PostToolUse `check-js`; Stop `spec-guard` | No secret files; one-line conventional commits; syntax after edits; contract moves with code |

## Layout

```
src/
  bin/sugar.js       entry point
  index.js           the library: createDbtSource, createSnapshotBuilder, parsers, the store (for agent-cage and friends)
  cli/               args.js (flags, usage, validation), browser.js (opens the page), start.js (wires sources → builder → server, spawns dbt)
  dbt/               otel.js (OTel JSONL → runs), logtail.js (dbt.log split per invocation), manifest.js, archive.js (last 10 invocations),
                     base.js (git refs, worktrees, dbt parse for the Diff tab), source.js (one project: all of the above)
  core/              pure: snapshot.js (run view), mood.js, suggest.js, diff.js (manifest diff, breaking changes, impact), builder.js, home.js
  history/           store.js (the only @duckdb/node-api importer: runs, nodes, flaky and slow stats)
  server/            http.js (routes, SSE, Host guard, token), watch.js (fs watching that drives live updates)
  web/               the page: index.html, app.js, style.css, favicon.svg, lib/ (pure modules: mascot, view)
  scripts/           dev-only tools: check, commit-msg, spec-guard, ux-shots, demo-gif (excluded from the npm package)
test/
  unit/<area>/<module>.test.js   mirrors src/ one-to-one
  unit/scripts/guards.test.js    commit-msg and spec-guard
  e2e/sugar.test.js              spawns the real binary
  ui/*.spec.js                   Playwright against a frozen playground
  playground/                    two git-backed dbt projects, past invocations, a temp DBT_SUGAR_HOME (npm run playground)
  fixtures/                      real dbt v2 output (jaffle, sugar) and a tiny dbt project, scrubbed of local paths
  helpers/fixture.js             temp folders and files; reuse it
```

Dependencies point one way: `dbt`, `core`, `server` and `web` import nothing else in `src/`, `history` may import `core`, `cli` wires them, `bin` imports `cli`. `npm run check` enforces it.

## Rules

- **Read-only:** never write to a dbt project's files, `target/` included. Sugar writes only inside its own home (`$DBT_SUGAR_HOME`, default `~/.dbt-sugar`: `history.duckdb`, `runs/`, `base/`) and, when it runs dbt itself, points dbt's logs at `logs/sugar-<time>-<pid>/`. Git is only asked to resolve refs and to add or remove a detached worktree in a temp folder; dbt is only asked to `parse` (plus the command you give after `--`).
- **Local only:** bind loopback, keep the Host-header guard, keep the per-launch token on POST, and check every git ref from the page against `REF`. Make no outbound network calls; that includes web fonts.
- **One runtime dependency:** `@duckdb/node-api`, pinned exactly, imported only by `src/history/store.js`. Everything else is Node ≥ 22 stdlib. `@playwright/test` is the only dev dependency.
- **dbt v2 only, measured not remembered:** parsers read Fusion's OTel JSONL, the v2 `dbt.log` and manifest v12. A new field or line shape is verified against a real dbt v2 run (`data-prober`) and recorded as a scrubbed fixture before code depends on it.
- **ESM everywhere.** Inject side effects (`exec`, `spawn`, `watch`, `now`) as parameters so tests stay fast and deterministic.
- **Escape all dbt- and git-derived text** with `esc()` before it goes into HTML. Model names, SQL and log lines are untrusted.
- **The page updates in place:** `src/web/app.js` patches only what changed, so the mascot's CSS animations don't restart on every SSE snapshot. The page fits the window; widgets scroll inside and expand into a popup.
- **The mascot stays original.** Never draw look-alikes of existing characters.
- **Testing:** keep 100% coverage. For an uncovered branch, first ask whether it can happen; delete it if not. Keep tests DRY with the fixture helper.
- **Style:** no inline comments (a name should explain itself); small functions; no speculative options.

## Autonomous loop

1. Read the spec section you are changing. New behaviour, or a request that contradicts the spec: `/spec` first and get a yes.
2. Write the failing mirrored test, then implement. After every edit, the PostToolUse hook syntax-checks JS files.
3. Run `/verify` until green.
4. Run `/lazy:lazy-review` on the diff and apply what it finds: delete code that doesn't need to exist, reuse what's already here, swap hand-rolled code for stdlib. Then run `/verify` again. A finding that would break a spec requirement or this file's rules is dropped, with one line saying why.
5. Run `/review`; fix every blocker and major.
6. If anything under `src/web/` or the snapshot shape changed, run `/ux-review` until it says SHIP.
7. Commit with a one-line conventional message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`): summary starts lower-case, whole subject ≤ 72 chars, so `commit-guard` passes on the first try. Push only when asked.
