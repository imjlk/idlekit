# Analyzer registry

## Registry conflicts fail before a body runs {#req-dx02-registry-conflicts}

Requirement `REQ-DX02-REGISTRY-CONFLICTS`. `DX-02` owns it.

`analyzerRegistryConflicts` in `packages/core/src/sim/analysis/analyzers.ts` is `fail-before-run`. `createAnalyzerRegistry` rejects a duplicate id and version when `register` is called. A dependency cycle is rejected when the definition that closes the cycle is registered, and that definition is not stored. A missing dependency throws `AnalyzerRegistryError` before any body. Params that fail `validateParams` throw before any body. Capability knowledge `unsupported` returns status `unsupported` and does not call the body. Bodies run in dependency order. Results are sorted by id, then version. The probe bodies run `m` then `a`. The returned ids are `a` then `m`.

`ModelAnalysisAdapter` is not this registry. This requirement does not add a second numeric engine.

The executed test is `rejectsRegistryConflictsBeforeRun` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A caller can register a metric and an analyzer {#req-dx02-custom-analyzer}

Requirement `REQ-DX02-CUSTOM-ANALYZER`. `DX-02` owns it.

`analyzerCustomRegistration` is `caller-metric-and-analyzer`. The builtin registry lists `eta` version `1` and `growth` version `1`. A caller registers metric `fixture.ore` on `ModelAnalysisRegistry` and analyzer `fixture.custom` on a separate `AnalyzerRegistry`. Core source does not contain those names. The model registry has no `run` method. With the registered metric id, the analyzer returns `3`. With an empty metric list, the status is `unsupported` and the body is not called again.

The executed test is `runsCustomMetricAnalyzer` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A short observation does not call the growth body {#req-dx02-insufficient-observation}

Requirement `REQ-DX02-INSUFFICIENT-OBSERVATION`. `DX-02` owns it.

`analyzerInsufficientObservation` is `insufficient-observation-rerun-plan`. The growth adapter demands trace coverage. A supply whose coverage is `summary` returns status `insufficient-data`, value `null`, rerun reason `insufficient-data`, and `freshRuns` `0`. `analyzeGrowth` is not called. The supplied input object is not read. The result does not start a simulation.

The executed test is `reportsInsufficientObservation` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## An execution analyzer stays inside its budget {#req-dx02-execution-budget}

Requirement `REQ-DX02-EXECUTION-BUDGET`. `DX-02` owns it.

`analyzerExecutionBudget` is `explicit-budget-not-silent-run`. An execution definition receives the caller `RunFactory` and the caller budget. `maxFreshRuns` `0` does not call `execute`. Horizon `100` with `maxDurationSec` `10` does not call `execute`. The rerun note says the fresh run exceeds the explicit budget. A granted run calls `requestRun` twice and gets the same grant. The batch `freshRuns` is `1`. `allowExecution` false returns rerun reason `execution-not-requested` and does not call the body.

The executed test is `enforcesExecutionBudget` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## Adapters keep the existing algorithm version {#req-dx02-same-algorithm}

Requirement `REQ-DX02-SAME-ALGORITHM`. `DX-02` owns it.

`analyzerSameAlgorithm` is `adapter-keeps-algorithm-version`. The growth adapter calls `analyzeGrowth` and returns that report as `value`. Its `algorithmVersion` is `growth-report-v1` for both `runGrowthAnalyzer` and `AnalyzerRegistry.run`. The ETA adapter calls `etaSimulate` or `etaAnalytic`. Simulate seconds for constant income `1` and money target `3` stay `3`. `algorithmVersion` is `eta-estimate-v1`, the same string as `estimate.algorithmVersion`. Analytic seconds match `etaAnalytic`. The adapter source does not call `fitGrowth`.

The executed test is `matchesExistingAlgorithmVersions` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## Observation demand is copied onto the plan {#req-dx02-observation-plan}

Requirement `REQ-DX02-OBSERVATION-PLAN`. `DX-02` owns it.

`analyzerObservationPlan` is `demand-on-plan-and-provenance`. Analyzers that share session `session-a`, strategy `greedy`, horizon `10`, step `1`, seed `4`, and observation cadence `2` use one fresh run. `executionPlan.trace.everySteps` is `2`. `executionPlan.durationSec` is `10`. Provenance demand records cadence `2`. A third analyzer with horizon `11` is a separate group and a second fresh run. Its duration is `11`. Result order is `alpha`, `late`, `zeta`. `alpha` shares with `zeta@1` only. The batch `freshRuns` count is `2`.

The executed test is `recordsObservationDemandOnThePlan` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## A plugin analyzer waits for permission {#req-dx02-plugin-isolation}

Requirement `REQ-DX02-PLUGIN-ISOLATION`. `DX-02` owns it.

`analyzerPluginIsolation` is `permission-before-load-and-isolate-failure`. `assertAnalyzerPluginsPermitted(false, ["plugin.ts"])` throws before later work. An allowed path and an empty path list do not throw. `registerAnalyzerIsolated` turns a duplicate `growth@1` into a message. `eta@1`, `growth@1`, and a later `plugin.custom@1` stay registered. The CLI command calls this permission check before `loadRegistries`. Trust root and sha256 checks stay in the existing plugin loader. A rejected analyzer definition does not remove builtins.

The executed test is `isolatesPluginAnalyzerFailure` in `packages/core/src/sim/analysis/analyzers.test.ts`.

## JSON and Markdown stay on the local result {#req-dx02-local-output}

Requirement `REQ-DX02-LOCAL-OUTPUT`. `DX-02` owns it.

`analyzerLocalOutput` is `json-markdown-local-not-judge`. `analyzerNotJudge` is `analyzer-creates-evidence-judge-interprets`. JSON of a growth adapter result has `algorithmVersion` `growth-report-v1`. Markdown is a `json` fence containing that version. `analyzerModuleBoundaryIssues` on `analyzers.ts` is empty: no CLI import, no Jev import, no filesystem import, and no network import. Builtin ids do not include `jev`. Replacing `fetch` with a function that throws does not fail the local growth adapter.

The executed test is `rendersLocalAnalyzerOutput` in `packages/core/src/sim/analysis/analyzers.test.ts`.
