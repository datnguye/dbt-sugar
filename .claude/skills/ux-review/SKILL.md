---
name: ux-review
description: Screenshot the dbt sugar page in every state with Playwright, review it against the spec, fix what is wrong, and repeat until the review says SHIP. Use after UI changes or before a release.
---

# UX review loop

1. Make sure `npm run test:ui` passes first. A broken page makes for a short review.
2. Delegate the review to the `ux-reviewer` subagent, so the reviewer has fresh eyes instead of the author's. Pass no conclusions of your own; it runs `npm run ux:shots` and reads `docs/spec.md` itself.
3. For every blocker and major it reports:
   - fix it, usually in `src/web/style.css`, `src/web/app.js` or `src/web/lib/view.js`
   - add or extend a Playwright assertion in `test/ui/` when the problem is checkable, so it stays fixed
4. Run `/verify`, then go back to step 2. Stop when the verdict is `SHIP`, or after five rounds; at that point, list what is left and why.
5. Look at the final screenshots yourself (live, a popup, the Diff tab and the phone view at least) before reporting. Trust the reviewer, but check.

Minor findings are optional: fix the cheap ones and list the rest.
