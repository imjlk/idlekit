---
npm/@idlekit/core: patch
---

Reject nonfinite amounts and targets in shared money, net worth, and prestige goals.

- invalid inputs omit reached and method instead of claiming the goal was met
- absent net worth remains unsupported unless wallet fallback is requested
- existing custom met predicates continue to work
