---
name: verify
description: Run every dbt sugar check (syntax, dependency, network and layering guard, unit and e2e tests with 100% coverage, Playwright UI tests) and fix failures until all pass. Use before declaring any change done.
---

# Verify

Run these in order and stop at the first failure:

1. `npm run check`: syntax of every JS file, one pinned runtime dependency, no outbound network calls, layering, every `src/` module has a mirrored test.
2. `npm test`: unit and e2e tests under `node:test`, with 100% line, branch and function coverage on `src/**` (bin, scripts and `web/app.js` excluded).
3. `npm run test:ui`: Playwright against a frozen playground (ports 4377 and 4378).

When something fails:

- Read the failure and fix the cause in the code. Change a test only when the test itself is wrong; never lower the coverage bar.
- For a coverage gap, first ask whether the branch can actually happen. Delete code that can't; test code that can.
- If a playground port is busy, find the stray `test/playground/run.js` process and stop it rather than changing ports.

Finally run `npm run spec-guard`: a `src/` change needs a contract change (`docs/spec.md`, `docs/decisions/` or `docs/proposals/`) and a test change.

Report the results in one short block. When all three are green, say so plainly.
