---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

`compareScenarios` without a `measuredDecision` now rejects NaN or infinite measured values instead of ranking them. `idk compare` checks that end money or net worth is finite only for the metrics that rank it, so an ETA or design comparison that reaches its target before a later overflow keeps its result. Pacing decimal bounds now require digits after a decimal point, the same rule scenario amounts use. Flow diagnosis converts edge ratios whose intermediate product overflows but whose result fits, treats an exact total loss as zero, and rejects sample windows whose length overflows. Tuning scores never rank zero money above a smaller positive amount. The integration-matrix hand answer follows the runner's stop tolerance on very long horizons and rejects horizons beyond the safe integer range; `linearCoveredSec` is new.
