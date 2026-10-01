# Growth model classification

## Shape is independent of speed {#req-pr12-shape-speed}

Requirement `REQ-PR12-SHAPE-SPEED`. `PR-12` owns it.

`growthShapeIndependentOfSpeed` is `shape-independent-of-log-slope`. `fitGrowth` reports `shape` and `speed` as separate fields. `windowSec` is the time window even when the trace has fewer than 1024 points. A slope threshold does not choose the shape.

`x = exp(0.001 t)` and `x = exp(0.2 t)`, t from 0 through 80 step 1, are both `exponential`. Their log10 slopes are about `0.000434` and `0.0869` per second. The legacy speed buckets for those slopes remain `softcap` and `exp`. `(t+1)^2` and `10 + 3t` are `polynomial`. `exp(0.002 t^2)` is `accelerating-log`. `100 * (1 - exp(-0.08 t))` from t=1 through 80 is `saturating`. A flat 25 is `constant`. Seven samples of a fast exponential, t from 0 through 6, are `unknown` with status `insufficient-data`.

`runScenario` executes the slow exponential, the fast exponential, and the linear series. A configured softcap on the slow exponential does not change the shape. The artifact records `method` `heuristic-fit`, `algorithmVersion` `growth-fit-v1`, `fitWindow`, `sampleCount`, and a residual. `claimsResourceBottleneck` is false. The fit does not claim an asymptotic regime.

There is no RNG. The formulas are `fixtures/conformance/growth-shapes.json`. The slope tolerance is `1e-4`.

The executed test is `separatesShapeFromSpeed` in `packages/core/src/sim/analysis/growth.fit.test.ts`.

## Bad domains are not a speed claim {#req-pr12-scale-domain}

Requirement `REQ-PR12-SCALE-DOMAIN`. `PR-12` owns it.

`growthDomainNotDisguised` is `non-positive-and-discontinuity-are-not-speed`. A break-infinity series at `1e400` and the same series at `1e406` are both `exponential`, and their log10 slopes match within `1e-4`. The first amount's `absLog10` is above 300. The amount is not narrowed with `toNumber` before that. Step 2 and step 1 of `exp(0.2 t)` share that slope within the same tolerance. `windowSec` stays the normalization.

A zero series is domain `zero`, status `invalid`, shape `unknown`. A negative series is domain `negative` and is not passed through `abs`. One sample is `insufficient-data`. None of those windows is `stall` or `super-exp`. An irregular exponential stays `exponential` and irregular. A reset drop and the same drop from `runScenario` split into two exponential windows. The second window's discontinuity is `drop`. A purchase time splits a smooth exponential into two exponential windows. Cadence equal to `windowSec` is `insufficient-data`. A retained trace shorter than the minimum says so and stays `unknown`.

The executed test is `refusesDisguisedDomains` in `packages/core/src/sim/analysis/growth.fit.test.ts`.

## Legacy report stays a speed bucket {#req-pr12-legacy-preserved}

Requirement `REQ-PR12-LEGACY-PRESERVED`. `PR-12` owns it.

`growthLegacyObservationPreserved` is `legacy-report-and-net-worth-fallback`. `analyzeGrowth` still returns the four legacy regimes. On the net-worth fixture it requests `netWorth`, uses `netWorth`, and keeps two segments. `fitGrowthFromRun` on that fixture also reports `valueSource` `netWorth`. A model with no `netWorth` is `netWorthFallback` on both calls. `legacySpeedBucket` is only the old threshold. It is not a cause, and it is not copied into the experience or `idk growth` output. Those call sites still call `analyzeGrowth`.

The executed test is `preservesLegacyNetWorthFallback` in `packages/core/src/sim/analysis/growth.fit.test.ts`.
