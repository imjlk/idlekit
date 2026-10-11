# Analysis contracts

## Shared goal evaluation {#req-pr08-shared-goal}

Requirement `REQ-PR08-SHARED-GOAL`. `PR-08` owns it.

`sharedGoalEvaluation` is `eta-experiment-check`. `money.atLeast`, `netWorth.atLeast`, `prestige.points.atLeast`, and `milestone.<key>` are the default goals. `evaluateGoalForEta`, `evaluateGoalForExperiment`, and `evaluateGoalForCheck` call one predicate. Their `reached` and `status` values match. The method labels are `fixed-step`, `monte-carlo`, and `exact` only when status is `ok`. An unsupported goal omits `reached` and `method`.

`walletMoneyMetric` and `netWorthMetric` read amounts with `Engine.cmp`, `Engine.isFinite`, and `Engine.toString`. They do not call `Engine.toNumber`. A missing `netWorth` is unsupported unless the caller asks for the wallet fallback, and that fallback is an assumption, not a zero.

There is no RNG. The fixture state is literal.

## Custom registration {#req-pr08-custom-metric}

Requirement `REQ-PR08-CUSTOM-METRIC`. `PR-08` owns it.

`customMetricRegistration` is `model-analysis-registry`. `createModelAnalysisRegistry` keys adapters by model id and version. Callers register metrics and goals there. `Model` gains no required method. A count metric may read `vars` through a caller function. Core source does not name that caller's resource.

`capabilityKnowledge` is `unknown` when no adapter is registered. On a registered adapter, an omitted capability is `unsupported`. `flowResult("unsupported")` and `resetResult("unsupported")` return status `unsupported` and no numeric value. They do not say stable.

Flow, reset, and advance method bodies are not in this PR. `AnalyzerRegistry` is `DX-02`.

## Analysis artifact v1 {#req-pr08-analysis-artifact}

Requirement `REQ-PR08-ANALYSIS-ARTIFACT`. `PR-08` owns it.

`analysisArtifactContract` is `idlekit.analysis.artifact.v1`. The wire type is `AnalysisArtifactV1`. `schemaVersion` is `1`. The generator calls `typia.json.schema<AnalysisArtifactV1, "3.1">()` and writes `docs/schemas/generated/analysis.artifact.v1.schema.json`. `contracts:check` compares that file and does not rewrite it.

`reading` is `observed`, `estimated`, or `unavailable`. `status` is separate from `method`. An unavailable reading has no `amount` and no `value`. A real zero keeps decimal `"0"` and sign `zero`. A nonfinite amount is status `invalid`, sign `nonfinite`, and omits the decimal. `1e400` stays the engine decimal string.

`sampleCount`, `horizon`, and `effectiveRunHash` are omitted when the caller does not supply them. A missing sample is not stored as `0`. An explicit `sampleCount` of `0` stays `0`.

`artifactProvenance` hashes the schema hash, `algorithmVersion`, and the assumption text. It does not hash `effectiveRunHash`. CLI `_meta.contractVersion` stays `1.4.0`. `linkAnalysisArtifact` places the artifact beside `_meta`.

The numeric audit for this change: `eta.ts` and `prestigeCycle.ts` still call `toNumber` on amounts for legacy estimates. `growth.ts` still uses `Number` on series values. Those paths are not the artifact. New amount readings use `Engine.cmp`, `Engine.isFinite`, and `Engine.toString`. Count, time, and ratio readings use `Number.isFinite` on a number the extractor already returned.
