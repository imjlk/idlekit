---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Correct ETA goal meaning without replacing the legacy seconds field.

- large ratios are divided in the Engine before a finite seconds number
- exact is not implied by a constant-income hint when a boundary exists
- a missed horizon is censored on the new estimate and still numeric on the legacy field
