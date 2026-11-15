# 0006. 100% coverage, hermetic tests, enforced layering, real-data fixtures

- Status: Accepted
- Date: 2026-11-15

## Context

The tool parses formats it does not own (dbt's OTel log, `dbt.log`, the manifest) and runs `git` and `dbt` on request. Regressions show up as a wrong number on a dashboard, which nobody notices until it matters.

## Decision

- `npm test` fails below 100% lines, branches and functions. Every `src/**/*.js` has a mirrored `test/unit/**/*.test.js`.
- `npm run check` enforces syntax, one pinned runtime dependency, no outbound network, and the layering (`dbt`, `core`, `server`, `web` import nothing else in `src/`; `history` may import `core`; `cli` wires them).
- Fixtures are scrubbed recordings of real dbt v2 builds (`test/fixtures/jaffle`, `test/fixtures/sugar`), not hand-written events. Tests write only to temp folders.
- Playwright checks the page against a frozen replay; UI changes also get a fresh-eyes UX review.
- A monthly workflow builds a fixture project with the latest dbt Fusion and fails if the OTel format drifts.

## Consequences

- **Easier:** refactors are safe; format drift is caught within a month.
- **Harder:** every branch needs a test, including error paths.
- **Forbidden:** lowering the coverage gate, or tests that touch the real home folder or network.

## Revisit when

The gates slow work without catching anything for several releases.
