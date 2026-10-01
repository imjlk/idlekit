# Scenario inspect

## A fixed duration includes the last partial tick {#req-dx03-partial-tick}

Requirement `REQ-DX03-PARTIAL-TICK`. `DX-03` owns it.

`inspectPartialTick` in `packages/core/src/sim/analysis/inspect.ts` is `partial-tick-included`. `fixedDurationStepCount` walks `nextBoundary`. A duration of 10 seconds and a step of 3 seconds is 4 ticks, and the last dt is 1. A duration of 10 seconds and a step of 2 seconds is 5 full ticks. A duration already inside the time-boundary epsilon is 0 steps. The loop stops at 1,000,000 steps. The report `simulated` flag stays false.

The executed test is `countsFixedDurationSteps` in `packages/core/src/sim/analysis/inspect.test.ts`.

## An until-only run has no step count {#req-dx03-until-unknown}

Requirement `REQ-DX03-UNTIL-UNKNOWN`. `DX-03` owns it.

`inspectUntilUnknown` is `until-only-unknown`. A clock with `untilExpr` and no `durationSec` has horizon kind `until`, `durationSec` null, and stage `stepCount` `unknown`. `maxSteps` is not used as a prediction. When `durationSec` is set, the duration count is used even if `until` is also present, because `until` may stop earlier.

The executed test is `marksUntilOnlyUnknown` in `packages/core/src/sim/analysis/inspect.test.ts`.

## A wide decimal on the number engine is a warning {#req-dx03-decimal-range}

Requirement `REQ-DX03-DECIMAL-RANGE`. `DX-03` owns it.

`inspectDecimalRange` is `decimal-range-is-advisory`. `decimalExceedsNumberDomain` flags a scientific exponent whose absolute value is at least 15, or an integer digit length above 15. It does not pass the literal through `Number`. On engine `number`, `1e400` is diagnostic `decimal-range` with severity `warning`, and the report stays valid. On `breakInfinity` the same literal does not warn, and `numericDomain.exact` is `decimal-string`. A small literal such as `15` is not flagged.

The executed test is `warnsOnDecimalRange` in `packages/core/src/sim/analysis/inspect.test.ts`.

## Stage plans differ, and planner cost is a bound {#req-dx03-stage-override}

Requirement `REQ-DX03-STAGE-OVERRIDE`. `DX-03` owns it.

`inspectStageOverride` is `stage-plans-differ`. Simulate keeps the command step. Experience keeps the scenario step and applies session. A planner request of horizon 100, beam 8, and branch 8 is capped at 32, 8, and 8. `expansionUpperBound` is that cap, `clamped` is true, and `measuredDurationSec` is null. Diagnostic `planner-cost` is a warning. The bound is a budget proposal, not a measured duration. `plannerExpansionBound` does not call `stepOnce`.

The executed test is `explainsStageOverrides` in `packages/core/src/sim/analysis/inspect.test.ts`.

## Named plugins stay unloaded by default {#req-dx03-plugins-default}

Requirement `REQ-DX03-PLUGINS-DEFAULT`. `DX-03` owns it.

`inspectPluginsDefault` is `plugins-stay-unloaded`. When a plugin path is requested and `resolve` is false, `userCode` is `not-run`, `loadedIds` is empty even if the caller supplied ids, and diagnostic `plugin-skipped` is present. Inspect does not import the module.

The executed test is `leavesPluginsUnloaded` in `packages/core/src/sim/analysis/inspect.test.ts`.

## Resolved plugin metadata omits source text {#req-dx03-plugin-metadata}

Requirement `REQ-DX03-PLUGIN-METADATA`. `DX-03` owns it.

`inspectPluginMetadata` is `metadata-after-trust`. When `resolve` is true, `userCode` is `may-run`, the supplied factory ids are reported, and diagnostic `plugin-user-code` is present. The report JSON does not contain a source sentinel. Import may run user code. Compile is not treated as safe, and factory `create` is not called by this report.

The executed test is `reportsResolvedPluginMetadata` in `packages/core/src/sim/analysis/inspect.test.ts`.

## Unsupported is not unknown {#req-dx03-capability-split}

Requirement `REQ-DX03-CAPABILITY-SPLIT`. `DX-03` owns it.

`inspectCapabilitySplit` is `unsupported-is-not-unknown`. Prestige requested with reset `unsupported` emits `missing-reset`. Prestige requested with reset `unknown` emits `capability-unknown` and does not emit `missing-reset`. Flow `unknown` stays `unknown` and does not emit `capability-unknown`. An unloaded plugin capability stays `unknown`.

The executed test is `separatesUnsupportedFromUnknown` in `packages/core/src/sim/analysis/inspect.test.ts`.

## Inspect does not tick or use the network {#req-dx03-no-run}

Requirement `REQ-DX03-NO-RUN`. `DX-03` owns it.

`inspectNoRun` is `no-tick-no-network`. `inspect.ts` does not call `runScenario` or `stepOnce`. A growth demand for trace coverage is unmet when the request does not include a trace, `met` is false, and diagnostic `insufficient-observation` is present. Replacing `fetch` with a function that throws does not fail the report. Analyzer observation demand is attached to this same result. Doctor stays a separate command.

The executed test is `doesNotSimulateOrFetch` in `packages/core/src/sim/analysis/inspect.test.ts`.
