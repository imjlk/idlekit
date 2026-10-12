---
npm/@idlekit/money: minor
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Keep ETA validity and exactness aligned with engine comparison and wallet settlement.

- reject positive ETA ratios lost to zero during engine division
- reject income in a different wallet or target unit
- expose optional Engine comparisonIsExact metadata and keep tolerant or unknown comparisons analytic-local
- preserve legacy seconds while limiting exact labels and reach brackets to declared strict comparators
