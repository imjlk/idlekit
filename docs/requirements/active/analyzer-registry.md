# Analyzer registry

## Registry conflicts fail before a body runs {#req-dx02-registry-conflicts}

Requirement `REQ-DX02-REGISTRY-CONFLICTS`. `DX-02` owns it.

`analyzerRegistryConflicts` in `packages/core/src/sim/analysis/analyzers.ts` is `fail-before-run`. `createAnalyzerRegistry` rejects a duplicate id and version when `register` is called. A dependency cycle is rejected when the definition that closes the cycle is registered, and that definition is not stored. A missing dependency throws `AnalyzerRegistryError` before any body. Params that fail `validateParams` throw before any body. Capability knowledge `unsupported` returns status `unsupported` and does not call the body. Bodies run in dependency order. Results are sorted by id, then version. The probe bodies run `m` then `a`. The returned ids are `a` then `m`.

`register` also checks every field `run` reads, because a plugin definition is a runtime value. A definition without `validateParams`, with a negative cost, or with a dependency that has no version is refused at `register`, and `registerAnalyzerIsolated` returns the message. An unrequested dependency runs under the semantics of the analyzer that pulled it in. Two parents with the same semantics share it. Two parents with different semantics throw before any body. `cost.freshRuns` is `0` or `1`, because a group shares one fresh run; a cost of `2` is refused at `register`. A dependent of a blocked dependency gets the dependency's status, and a dependent of a dependency that finished other than `ok` is `insufficient-data`. Neither dependent body runs.

`ModelAnalysisAdapter` is not this registry. This requirement does not add a second numeric engine.

The executed test is `rejectsRegistryConflictsBeforeRun` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A caller can register a metric and an analyzer {#req-dx02-custom-analyzer}

Requirement `REQ-DX02-CUSTOM-ANALYZER`. `DX-02` owns it.

`analyzerCustomRegistration` is `caller-metric-and-analyzer`. The builtin registry lists `eta` version `1` and `growth` version `1`. A caller registers metric `fixture.ore` on `ModelAnalysisRegistry` and analyzer `fixture.custom` on a separate `AnalyzerRegistry`. Core source does not contain those names. The model registry has no `run` method. With the registered metric id, the analyzer returns `3`. With an empty metric list, the status is `unsupported` and the body is not called again. A definition with `resolveDemand` is checked against the metrics of its resolved demand, not the static union. With only `money` registered, growth for `money` is `ok` and growth for `netWorth` is `unsupported`.

The executed test is `runsCustomMetricAnalyzer` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A short observation does not call the growth body {#req-dx02-insufficient-observation}

Requirement `REQ-DX02-INSUFFICIENT-OBSERVATION`. `DX-02` owns it.

`analyzerInsufficientObservation` is `insufficient-observation-rerun-plan`. The growth adapter demands trace coverage. A supply whose coverage is `summary` returns status `insufficient-data`, value `null`, rerun reason `insufficient-data`, and `freshRuns` `0`. `analyzeGrowth` is not called. The supplied input object is not read. The result does not start a simulation.

The executed test is `reportsInsufficientObservation` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## An execution analyzer stays inside its budget {#req-dx02-execution-budget}

Requirement `REQ-DX02-EXECUTION-BUDGET`. `DX-02` owns it.

`analyzerExecutionBudget` is `explicit-budget-not-silent-run`. An execution definition receives the caller `RunFactory` and the caller budget. `maxFreshRuns` `0` does not call `execute`. Horizon `100` with `maxDurationSec` `10` does not call `execute`. The rerun note says the fresh run exceeds the explicit budget. A granted run calls `requestRun` twice and gets the same grant. The batch `freshRuns` is `1`. `allowExecution` false returns rerun reason `execution-not-requested` and does not call the body. Samples are reserved across the batch: two groups of `8` samples under `maxSamples` `10` run the first and refuse the second with `budget`. A group blocked by an `unsupported` capability reserves no run, so a later group gets the only run under `maxFreshRuns` `1`. ETA without a scenario returns rerun reason `missing-scenario`, and the batch `freshRuns` is `0`. `resolveCost` makes analytic ETA cost no fresh run, so it is `ok` with `maxFreshRuns` `0` and reports `freshRuns` `0`. Simulated ETA runs for `maxDurationSec`, so `maxDurationSec` `100` with horizon `1` and duration budget `10` is refused with `budget` before any run.

The executed test is `enforcesExecutionBudget` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## Adapters keep the existing algorithm version {#req-dx02-same-algorithm}

Requirement `REQ-DX02-SAME-ALGORITHM`. `DX-02` owns it.

`analyzerSameAlgorithm` is `adapter-keeps-algorithm-version`. The growth adapter calls `analyzeGrowth` and returns that report as `value`. Its `algorithmVersion` is `growth-report-v1` for both `runGrowthAnalyzer` and `AnalyzerRegistry.run`. The ETA adapter calls `etaSimulate` or `etaAnalytic`. Simulate seconds for constant income `1` and money target `3` stay `3`. `algorithmVersion` is `eta-estimate-v1`, the same string as `estimate.algorithmVersion`. Analytic seconds match `etaAnalytic`. The adapter source does not call `fitGrowth`.

The executed test is `matchesExistingAlgorithmVersions` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## Observation demand is copied onto the plan {#req-dx02-observation-plan}

Requirement `REQ-DX02-OBSERVATION-PLAN`. `DX-02` owns it.

`analyzerObservationPlan` is `demand-on-plan-and-provenance`. Analyzers that share session `session-a`, strategy `greedy`, horizon `10`, step `1`, seed `4`, and observation cadence `2` use one fresh run. `executionPlan.trace.everySteps` is `2`. `executionPlan.durationSec` is `10`. Provenance demand records cadence `2`. A third analyzer with horizon `11` is a separate group and a second fresh run. Its duration is `11`. Result order is `alpha`, `late`, `zeta`. `alpha` shares with `zeta@1` only. The batch `freshRuns` count is `2`.

The traced cadence rounds down, so it is never coarser than the demand. Cadence `5` at step `2` traces every `2` steps. Cadence `0.3` at step `0.1` traces every `3`. Cadence `1` at step `2` returns `insufficient-data` and does not call the body. The grant's `run()` opens the group's fresh run once through the caller `RunFactory`. Two members of one group get the same `RunResult`, the factory opens one fresh run, and the trace holds `t` `0`, `2`, and `4`. The group key is JSON, so session `a` with strategy `b|c` and session `a|b` with strategy `c` are two groups. A definition with `sharesRun` `false`, such as ETA, which runs its own simulation, is always its own group. A blocked analyzer is not listed in a peer's `sharedWith`.

The executed test is `recordsObservationDemandOnThePlan` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A plugin analyzer waits for permission {#req-dx02-plugin-isolation}

Requirement `REQ-DX02-PLUGIN-ISOLATION`. `DX-02` owns it.

`analyzerPluginIsolation` is `permission-before-load-and-isolate-failure`. `assertAnalyzerPluginsPermitted(false, ["plugin.ts"])` throws before later work. An allowed path and an empty path list do not throw. `registerAnalyzerIsolated` turns a duplicate `growth@1` into a message. `eta@1`, `growth@1`, and a later `plugin.custom@1` stay registered. The CLI command calls this permission check before `loadRegistries`. Trust root and sha256 checks stay in the existing plugin loader. A rejected analyzer definition does not remove builtins.

The executed test is `isolatesPluginAnalyzerFailure` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## JSON and Markdown stay on the local result {#req-dx02-local-output}

Requirement `REQ-DX02-LOCAL-OUTPUT`. `DX-02` owns it.

`analyzerLocalOutput` is `json-markdown-local-not-judge`. `analyzerNotJudge` is `analyzer-creates-evidence-judge-interprets`. JSON of a growth adapter result has `algorithmVersion` `growth-report-v1`. Markdown is a `json` fence containing that version. `analyzerModuleBoundaryIssues` on `analyzers.ts` is empty: no CLI import, no Jev import, no filesystem import, and no network import. Builtin ids do not include `jev`. Replacing `fetch` with a function that throws does not fail the local growth adapter.

The executed test is `rendersLocalAnalyzerOutput` in `packages/core/src/sim/analysis/analyzers.test.ts`.
