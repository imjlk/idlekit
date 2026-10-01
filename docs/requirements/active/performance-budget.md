# Performance budget

## The bench artifact has a versioned schema {#req-dx04-bench-schema}

Requirement `REQ-DX04-BENCH-SCHEMA`. `DX-04` owns it.

`budgetSchema` in `tools/performanceBudget.ts` is `bench-output-schema`. The artifact contract is `idlekit.performance-budget` and `schemaVersion` is 1. It records corpus, config, config hash, Bun, CPU, OS, arch, iterations, and warmup. `allocPerStep` is `unsupported`. Worker `startupMs` and `serializationMs` are `absent`. This requirement does not implement worker execution.

The executed test is `acceptsPerformanceBudgetSchema` in `tools/performanceBudget.test.ts`.

## Steps per second use the runtime workload only {#req-dx04-workload-denominator}

Requirement `REQ-DX04-WORKLOAD-DENOMINATOR`. `DX-04` owns it.

`budgetDenominator` is `runtime-denominator`. `stepsPerSec` is the workload count divided by the median runtime seconds. prepare-cold and prepare-warm durations are not in that quotient. A 100-step workload with runtime samples of 100ms and 200ms, and prepare samples of 5000ms and 900ms, uses 150ms.

The executed test is `keepsRuntimeWorkloadDenominator` in `tools/performanceBudget.test.ts`.

## An empty runtime duration is not a rate {#req-dx04-empty-duration}

Requirement `REQ-DX04-EMPTY-DURATION`. `DX-04` owns it.

`budgetEmptyDuration` is `empty-duration-absent`. No runtime samples make total time median, p95, and steps/sec `absent`. A measured runtime of 0ms stays median `measured` 0, and steps/sec stays `absent` rather than 0 or Infinity.

The executed test is `keepsEmptyDurationAbsent` in `tools/performanceBudget.test.ts`.

## Missing counters are not zero {#req-dx04-unknown-metric}

Requirement `REQ-DX04-UNKNOWN-METRIC`. `DX-04` owns it.

`budgetUnknownMetric` is `unknown-is-not-zero`. Omitted planner nodes, draws, and retained samples are `absent`. A supplied 0 is `measured` 0. `allocPerStep` stays `unsupported`.

The executed test is `keepsUnknownMetricsUnmeasured` in `tools/performanceBudget.test.ts`.

## An unfavorable repeat fails the gate {#req-dx04-gate-failure}

Requirement `REQ-DX04-GATE-FAILURE`. `DX-04` owns it.

`budgetGateFailure` is `unfavorable-fails`. The gate fails when the current median exceeds both the relative slowdown and the absolute median floor, and the repeat count is at least the minimum. Fewer repeats fail as `too-few-repeats` and do not pass. The compare function does not call the baseline writer. A 100ms median moving to 180ms fails a relative slowdown of 0.25 with an absolute floor of 50ms.

The executed test is `failsUnfavorableBudget` in `tools/performanceBudget.test.ts`.

## A baseline hash mismatch is rejected {#req-dx04-baseline-hash}

Requirement `REQ-DX04-BASELINE-HASH`. `DX-04` owns it.

`budgetHashMismatch` is `baseline-hash-rejected`. A config hash that does not match its config is `baseline-hash-mismatch`. The baseline writer is not called.

The executed test is `rejectsBaselineHashMismatch` in `tools/performanceBudget.test.ts`.

## Only the same config is compared {#req-dx04-same-config}

Requirement `REQ-DX04-SAME-CONFIG`. `DX-04` owns it.

`budgetSameConfig` is `same-config-only`. The same engine, seed, model, step, trace, observer, worker, and planner are comparable. A 4ms to 9ms change with relative slowdown 0.25 and absolute floor 50ms passes. A different observer, engine, or trace is `config-mismatch`. A pass does not call the baseline writer.

The executed test is `comparesOnlyTheSameConfig` in `tools/performanceBudget.test.ts`.

## Cold and warm labels stay on prepare {#req-dx04-phase-labels}

Requirement `REQ-DX04-PHASE-LABELS`. `DX-04` owns it.

`budgetPhaseLabels` is `cold-warm-labels`. prepare-cold is labeled `cold`. prepare-warm is labeled `warm`. The runtime median uses runtime samples only. install, check, and build stay labeled `other`. Full trace is not the default scoring mode.

The executed test is `keepsColdAndWarmLabels` in `tools/performanceBudget.test.ts`.
