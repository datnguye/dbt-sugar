---
description: Final gate - verify, spec-guard, one-line conventional commit; push only on a yes
argument-hint: [commit subject]
---
1. Run `/verify`. Stop on red.
2. Run `npm run spec-guard`. If it lists problems, fix them or tell me why the change needs no spec update.
3. Stage the change and commit with one conventional line (use "$ARGUMENTS" if given, else write one). The commit-guard hook rejects anything else.
4. Show `git log --oneline -3` and ask whether to push. Push only on an explicit yes.
