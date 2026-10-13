# Performance budget

## The bench artifact has a versioned schema {#req-dx04-bench-schema}

Requirement `REQ-DX04-BENCH-SCHEMA`. `DX-04` owns it.

`budgetSchema` in `tools/performanceBudget.ts` is `bench-output-schema`. The artifact contract is `idlekit.performance-budget` and `schemaVersion` is 1. It records corpus, scenario, scenario hash, config, config hash, Bun, CPU, OS, arch, iterations, and warmup. `allocPerStep` is `unsupported`. Worker `startupMs` and `serializationMs` are `absent`. This requirement does not implement worker execution. `totalTimeP95Ms` is the nearest-rank p95, so with seven samples it is the slowest one. `tools/bench-planner.ts` and `tools/bench-monte-carlo.ts` reject a negative or non-finite sample, a counter, seed, or model version that is not an integer of at least 0, a step that is not a finite number above 0, a blank text value, an unlisted choice, and an unknown flag. They record `warmup` 0, because prepare samples are not discarded runtime samples.

The executed tests are `acceptsPerformanceBudgetSchema`, `takesNearestRankP95`, and `rejectsNegativeSamples` in `tools/performanceBudget.test.ts`.

## Steps per second use the runtime workload only {#req-dx04-workload-denominator}

Requirement `REQ-DX04-WORKLOAD-DENOMINATOR`. `DX-04` owns it.

`budgetDenominator` is `runtime-denominator`. `stepsPerSec` is the workload count divided by the median runtime seconds. prepare-cold and prepare-warm durations are not in that quotient. A 100-step workload with runtime samples of 100ms and 200ms, and prepare samples of 5000ms and 900ms, uses 150ms. A duration of 1,000,001 one-second steps counts 1,000,001. A duration past 100,000,000 steps is `null`, not a truncated count.

The executed test is `keepsRuntimeWorkloadDenominator` in `tools/performanceBudget.test.ts`.

## An empty runtime duration is not a rate {#req-dx04-empty-duration}

Requirement `REQ-DX04-EMPTY-DURATION`. `DX-04` owns it.

`budgetEmptyDuration` is `empty-duration-absent`. No runtime samples make total time median, p95, and steps/sec `absent`. A measured runtime of 0ms stays median `measured` 0, and steps/sec stays `absent` rather than 0 or Infinity.

The executed test is `keepsEmptyDurationAbsent` in `tools/performanceBudget.test.ts`.

## Missing counters are not zero {#req-dx04-unknown-metric}

Requirement `REQ-DX04-UNKNOWN-METRIC`. `DX-04` owns it.

`budgetUnknownMetric` is `unknown-is-not-zero`. Omitted planner nodes, draws, and retained samples are `absent`. A supplied 0 is `measured` 0. `allocPerStep` stays `unsupported`. `tools/bench-sim.ts` leaves observation retained samples `absent` because simulate output has no observation retention count, and an event-log count is not one. It records `peakRssBytes` from the simulate child process and leaves RSS and heap delta `absent`.

The executed test is `keepsUnknownMetricsUnmeasured` in `tools/performanceBudget.test.ts`.

## An unfavorable repeat fails the gate {#req-dx04-gate-failure}

Requirement `REQ-DX04-GATE-FAILURE`. `DX-04` owns it.

`budgetGateFailure` is `unfavorable-fails`. The gate fails when the current median exceeds both the relative slowdown and the absolute median floor, and the repeat count is at least the minimum. Fewer repeats fail as `too-few-repeats` and do not pass. A baseline without an integer `iterations` of at least 1, an integer `warmup` of at least 0, and a `null` or integer `workloadCount` is not read. The compare function does not call the baseline writer. A 100ms median moving to 180ms fails a relative slowdown of 0.25 with an absolute floor of 50ms.

The executed tests are `failsUnfavorableBudget` and `rejectsBaselineWithoutIterations` in `tools/performanceBudget.test.ts`.

## A baseline hash mismatch is rejected {#req-dx04-baseline-hash}

Requirement `REQ-DX04-BASELINE-HASH`. `DX-04` owns it.

`budgetHashMismatch` is `baseline-hash-rejected`. A config hash that does not match its config is `baseline-hash-mismatch`. The baseline writer is not called. A baseline file is one artifact or a `bench-sim --out` result. From a result, each scenario takes the `perScenario[].budget` with its scenario hash.

The executed tests are `rejectsBaselineHashMismatch` and `readsBenchOutputAsBaseline` in `tools/performanceBudget.test.ts`.

## Only the same config is compared {#req-dx04-same-config}

Requirement `REQ-DX04-SAME-CONFIG`. `DX-04` owns it.

`budgetSameConfig` is `same-config-only`. The same engine, seed, model, step, trace, observer, worker, and planner are comparable. A 4ms to 9ms change with relative slowdown 0.25 and absolute floor 50ms passes. A different observer, engine, or trace is `config-mismatch`. The scenario hash and workload count must also match, or the comparison is `workload-mismatch`. A 30-step and a 1800-step scenario with the same config are rejected. A blank `untilExpr` is ignored, as the scenario compiler does. Bun, OS, and arch must match, or the comparison is `host-mismatch`. CPU brand is recorded and not compared. The engine is the run's effective engine from simulate `_meta.effectiveEngine`, not `scenario.engine`, which simulate records as metadata. The seed is the run's `_meta.seed`. A scenario file has no seed field. The observer is `on`, because runScenario enables the observation recorder by default and a scenario file cannot turn it off. A baseline refresh replaces this host's entry with the same scenario path or scenario hash and keeps other hosts' entries. The trace mode reads `outputs.report.traceEverySteps`, as the scenario compiler does. A cadence above 1 is `bounded`. A cadence of 1 or none traces every step and is `unbounded`. A pass does not call the baseline writer.

The executed tests are `comparesOnlyTheSameConfig`, `rejectsDifferentWorkload`, `readsTraceCadence`, and `rejectsBaselineFromAnotherHost` in `tools/performanceBudget.test.ts`.

## Cold and warm labels stay on prepare {#req-dx04-phase-labels}

Requirement `REQ-DX04-PHASE-LABELS`. `DX-04` owns it.

`budgetPhaseLabels` is `cold-warm-labels`. prepare-cold is labeled `cold`. prepare-warm is labeled `warm`. The runtime median uses runtime samples only. install, check, and build stay labeled `other`. Full trace is not the default scoring mode. In `tools/bench-sim.ts`, prepare-cold is the first ttsc bundle build of the CLI in the bench process and prepare-warm repeats that build. Warmup simulate runs are discarded and are not prepare samples.

The executed test is `keepsColdAndWarmLabels` in `tools/performanceBudget.test.ts`.
