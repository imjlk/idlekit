# Growth classification

Korean version: [growth-classification_ko.md](./growth-classification_ko.md)

`analyzeGrowth` still returns the legacy speed buckets `stall`, `softcap`, `exp`, and `super-exp`. Those names are log10-slope thresholds. They are not a growth shape, and a near-zero bucket is not a resource bottleneck. `idk growth` and the experience snapshot still emit that report so existing KPI output stays put.

`fitGrowth` is the separate artifact. It requires a sampling contract: budget, method `growth-fit-v1`, method version 1, and `windowSec`. `windowSec` is the time window. The sample count does not switch that meaning, including below 1024 points. Shape and speed are different fields. The shapes are candidates on the observed window: `constant`, `polynomial`, `exponential`, `accelerating-log`, `saturating`, or `unknown`. A candidate is not a proof of the asymptotic regime.

Amounts stay in the Engine. `absLog10` is used for positive finite values. A value is narrowed with `toNumber` only when its absolute log10 is inside the safe number range, and only for a value-domain residual. Zero and negative samples are a separate domain. They are not passed through `abs`. A purchase, reset, sign change, or tenfold drop starts a new window. A configured `analytic.softcap` is recorded beside the shape and does not select it.

Breaks are found on every sample before the sampling budget applies, and both sides of each break are kept, so downsampling cannot hide a zero or a drop. Fits use time since the window start, so a large absolute `t` does not change the slope. Value-space fits run in units of the series magnitude, not floored at 1, so a unit change does not change shape. Saturation reads gap-normalized growth rates, so an evenly downsampled trace with uneven gaps is still saturating. An exact tenfold drop is a drop. Coarse cadence keeps a non-positive or nonfinite domain `invalid`. An exact value-space line or parabola is `polynomial` whatever its intercept. From a run, an action opens its window at the first trace state after the action. A trace that retention emptied stays empty. Without a complete action history, windows withhold shape claims.

A later Analyzer adapter should pass `GrowthSamplingContract` and read `GrowthFitArtifactV1`. It should not infer a regime from the legacy enum. The structural schema is `idlekit.growth-fit.v1`.

There is no RNG. The formulas and the executed simulation cases are `fixtures/conformance/growth-shapes.json`. The repro label is that file. The slope tolerance is `1e-4`.

Node.js and browser runtimes are not part of the v1 compatibility contract.
