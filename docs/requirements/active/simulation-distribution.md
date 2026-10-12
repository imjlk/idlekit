# Simulation distribution

## Samples stay observed, censored, failed, or unsupported {#req-pr13-sample-accounting}

Requirement `REQ-PR13-SAMPLE-ACCOUNTING`. `PR-13` owns it.

`distributionSampleAccounting` in `packages/core/src/sim/analysis/distribution.ts` is `observed-censored-failed-unsupported`. `analyzeDistribution` counts draws, observed samples, right-censored samples, and failures. Completion rate is observed divided by observed plus right-censored. Ninety observed values of `"10"` and ten censored samples on horizon 40 have completion rate `0.9`. The population p95 uses the common-horizon order statistic. Index 94 of 100 sits in the censored tail, so population status is `outside-observed-range` and the value is null. The completed-only q0.95 stays `"10"` and is labeled `completed-only`. Those two numbers are not interchangeable.

Five censored samples and no observed sample are `unavailable`. The arithmetic mean is null. It is not `"0"`. A failed sample whose payload is `"0"` does not enter the mean. Two observed `"10"` values stay mean `"10"`.

The executed test is `separatesCensoringFromObservedQuantiles` in `packages/core/src/sim/analysis/distribution.test.ts`.

## Quantiles use one indexed convention {#req-pr13-quantile-convention}

Requirement `REQ-PR13-QUANTILE-CONVENTION`. `PR-13` owns it.

`distributionQuantileConvention` is `inclusive-floor-index-v1`. The method id is `inclusive-floor-index` and the method version is `1`. On a sorted sample, the rank is `floor((n - 1) * q)`. For `[1, 2, 3, 4, 5]`, q0 is 1, q0.5 is 3, q0.95 is 4, and q1 is 5. An empty sample returns null, not 0. Canonical keys are `q` plus the number's own text, so `0.946` and `0.954` stay `q0.946` and `q0.954`. A repeated key throws. `NaN` and `1.1` throw. The structural schema is `typia.json.schema<DistributionArtifactV1, "3.1">()` registered as `idlekit.distribution.v1`.

The executed test is `fixesQuantileRanksAndKeys` in `packages/core/src/sim/analysis/distribution.test.ts`.

## Logical draws ignore worker count {#req-pr13-logical-draws}

Requirement `REQ-PR13-LOGICAL-DRAWS`. `PR-13` owns it.

`distributionLogicalDraws` is `logical-index-not-worker-slot`. `logicalDrawSeed` and `logicalDrawId` take the base seed and the draw index. They do not take a worker count. `simulateMonteCarlo` derives each draw with those helpers and opens `fresh` on the logical id. `monteCarloDrawBudget` is `finite-integer-draws`. `NaN`, `Infinity`, and `0` draws throw before the loop. A non-finite seed throws. A non-finite budget throws. Common random numbers throw unless `executionStream` is true.

A stateful income factory still ends at money `3` for every draw of duration 2. Calling the three draws again matches. Opening logical draws `2`, `0`, then `1` keeps draw 2 on its own seed and money `3`. The artifact seed list is ordered by logical draw index. `reduction.workerCountIndependent` is true. This run is local. It does not start workers.

The executed test is `keepsLogicalDrawsIndependentOfOrder` in `packages/core/src/sim/analysis/distribution.test.ts`.

## A seeded drop stays inside tolerance {#req-pr13-empirical-drop}

Requirement `REQ-PR13-EMPIRICAL-DROP`. `PR-13` owns it.

`distributionEmpiricalDrop` is `seeded-bernoulli-tolerance`. `independentBernoulli` draws one uniform from `logicalDrawSeed`. `fixtures/conformance/independent-drop.json` fixes seed `28947`, 10000 draws, probability `0.01`, and absolute tolerance `0.005`. The empirical rate must lie inside that tolerance. The fixture does not require the rate to equal `0.01`. Five constant observed values `"5"` report variance `0` and `zeroVariance` true. That is a normal result for a model that consumes no randomness. A pair of monetization samples is source `monetization`, not `model-strategy-session`.

The executed test is `checksSeededDropAndZeroVariance` in `packages/core/src/sim/analysis/distribution.test.ts`.

## Means and the first visible change stay distinct {#req-pr13-mean-identity}

Requirement `REQ-PR13-MEAN-IDENTITY`. `PR-13` owns it.

`distributionMeanIdentity` is `arithmetic-mean-log-and-log-mean`. Observed values `"10"` and `"1000"` have arithmetic mean `"505"`, mean of log10 `"2"`, and a log10 of that arithmetic mean that is neither `"2"` nor `"505"`. `firstVisibleDistributionSample` maps a missing `firstVisibleChangeSec` to status `censored` and value null. It does not substitute active seconds or `0`. `summarizeExperienceMonteCarlo` sends each draw through that helper. The legacy numeric summary averages observed changes only and is null when every draw is censored.

The executed test is `separatesMeansAndCensorsMissingVisibleChange` in `packages/core/src/sim/analysis/distribution.test.ts`.
