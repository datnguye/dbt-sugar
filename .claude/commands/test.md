---
description: Run the node test suite with the 100% coverage gate and report pass/fail plus uncovered lines.
---

Run the gates:

```
npm run check && npm test
```

Report:

| Result | Coverage | Notes                         |
|--------|----------|-------------------------------|
| ...    | ...%     | failing tests / uncovered lines |

If coverage is < 100% (lines, branches or functions), list the uncovered `file:line` ranges. If tests fail,
show the failing test names and the assertion output. Do not attempt to fix
failures unless the user asks.
