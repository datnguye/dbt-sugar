---
name: deliver
description: Implement an accepted proposal or spec change end to end - tests first, code, verify, reviews, commit. Use after /spec is accepted, or for a fix whose behaviour the spec already describes.
---

# Deliver

1. **Load the contract:** the proposal in `docs/proposals/` (if any) and the spec sections it changes. If the spec doesn't describe the behaviour yet, stop and run `spec-change` first.
2. **Tests first.** Write or extend the mirrored test (`test/unit/<same path as src>`) so it fails for the right reason. Page behaviour also gets a Playwright check in `test/ui/`. Parser changes get a fixture recorded from a real dbt v2 run, scrubbed of local paths.
3. **Implement** the smallest change that makes them pass, within the layering in `CLAUDE.md`.
4. Run `/verify` until green (check, 100% coverage, Playwright).
5. Run `/lazy:lazy-review` on the diff and apply what holds. Then `/verify` again.
6. Run the `spec-reviewer` and `code-reviewer` subagents **in parallel** on the diff. Fix every blocker and major; re-run the one that flagged.
7. If `src/web/` or the snapshot shape changed, run `/ux-review` until SHIP.
8. Run `npm run spec-guard`. Then commit with one conventional line (`feat(scope): …`). Push only when the user asks.

Report: what changed, the test names that prove it, and the three verify results.
