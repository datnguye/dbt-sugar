---
description: Review the current change against the contract and for code quality
argument-hint: [base ref, default HEAD]
---
Review the change against base `$ARGUMENTS` (`HEAD` when empty):

1. Run the `spec-reviewer` and `code-reviewer` subagents in parallel, passing them the base.
2. Run `/lazy:lazy-review` on the same diff.
3. Merge the findings into one list ranked blocker / major / minor, deduplicated, each with `path:line` and the fix. End with the two verdicts (ALIGNED/DRIFT, APPROVE/CHANGES). Don't apply anything.
