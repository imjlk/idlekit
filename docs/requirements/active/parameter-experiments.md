# Parameter experiments

## Local elasticity stays one parameter at a time {#req-pr14-local-elasticity}

Requirement `REQ-PR14-LOCAL-ELASTICITY`. `PR-14` owns it.

`experimentLocalOat` in `packages/core/src/sim/analysis/experiment.ts` is `one-at-a-time-local-not-sobol`. `runExperiment` builds a fixed sweep and local probes from registered dimensions. It does not compute a Sobol index or a global sensitivity index. `globalSensitivity` and `sobol` stay false. The estimator version is `one-at-a-time-local-v1` and the method is `fixed-sweep-and-one-at-a-time`.

Constant income of rate `p` with step `1` reaches money `T` at time `T/p` when `p` divides `T`. The canonical fixture is `fixtures/conformance/parameter-experiment.json`, seed `28948`. Target `10` and horizon `40` give baseline rate `1` a reach time `"10"`. Probe rate `2` reaches in `"5"` and the elasticity is `"-0.5"` with direction `lower`. Probe rate `0.5` reaches in `"20"` and the elasticity is `"-2"` with direction `higher`. Policy `maxPicks` probe `2` keeps reach time `"10"`, elasticity `"0"`, and direction `flat`. A non-positive baseline parameter reports absolute change and direction and leaves elasticity unavailable. Relative elasticity is only for finite `p` and `y` greater than zero.

The executed test is `checksLocalElasticityDirection` in `packages/core/src/sim/analysis/experiment.test.ts`.

## Tasks keep parameters, seed, and version {#req-pr14-task-descriptor}

Requirement `REQ-PR14-TASK-DESCRIPTOR`. `PR-14` owns it.

`experimentTaskDescriptor` is `task-id-params-seed-version`. A task id is the candidate id, `#`, and the logical seed. The same seed, session, and horizon are used for every candidate. The descriptor stores `engineId`, `engineVersion`, `modelId`, `modelVersion`, `strategyId`, and JSON text for model and strategy params. It does not store a function or a compiled scenario. The income probe task `oat:incomeRate:2#28948` has model params `{"incomeRate":2}` and strategy params `{"maxPicks":1}`. The policy probe task keeps `{"incomeRate":1}` and sets `{"maxPicks":2}`. `effectiveRunHash` is the caller-supplied run hash. Original and effective spec hashes are sha256 of the canonical spec. The structural schema is `typia.json.schema<ExperimentArtifactV1, "3.1">()` registered as `idlekit.experiment.v1`.

Each candidate starts from the scenario named by `scenario.ref`. Its wallet, unit, tick policy, model params, and strategy params are the base, and only the assigned paths change. Like scenario compile in legacy-raw mode, the candidate passes the raw params to `create`. The schema output only confirms the assigned paths, so a field the schema strips, such as `note`, stays `"kept"`. A generated probe id writes a string probe as JSON text, so choice probes `1` and `"1"` become `oat:tag:1` and `oat:tag:"1"`. The spec model must be the scenario model. A spec strategy must be the scenario strategy when the scenario names one. A candidate metric is the arithmetic mean over every seed. One failed seed fails it and one censored seed censors it. A `GEM` scenario with wallet `100`, income of rate times logical seed, target `130`, and horizon `30` gives seed `1` the reach time `"30"` and seed `3` the reach time `"10"`. The candidate reach time is `"20"` and end money is `"160"`. The task keeps the scenario strategy params `{"maxPicks":3}`. The CLI records the version of the engine that ran, `idlekit-cli@<version>` for a built-in engine, not the scenario engine metadata. It passes the loaded plugin digests to the run hash and the output meta.

The executed tests are `checksLocalElasticityDirection` and `startsCandidatesFromScenario` in `packages/core/src/sim/analysis/experiment.test.ts`.

## Strategy tune stays a separate signature {#req-pr14-tune-signature}

Requirement `REQ-PR14-TUNE-SIGNATURE`. `PR-14` owns it.

`experimentSeparateSpec` is `experiment-spec-not-tunespec`. `TuneSpecV1` still describes only `strategy.space`. `validateTuneSpecV1` accepts a strategy integer path. `runCandidateAndScore` still scores seeds `7` and `11` as `9`. The experiment spec is not passed through that tuner. `idk tune` is unchanged. `idk experiment <spec>` is a separate command.

The executed test is `keepsStrategyTuneSignature` in `packages/core/src/sim/analysis/experiment.test.ts`.

## Parameters use a registered setter {#req-pr14-registered-setter}

Requirement `REQ-PR14-REGISTERED-SETTER`. `PR-14` owns it.

`experimentRegisteredSetter` is `registered-key-not-jsonpath`. A path is dotted identifiers. `__proto__`, `prototype`, `constructor`, `eval`, `$`, brackets, and parentheses are rejected. Session paths are only `pattern` or `days`. Values must sit in the ParamSpace kind `bool`, `int`, `number`, or `choice`. An integer outside min and max is rejected. A numeric choice value must be finite. A rate of `-1` can sit inside a wide numeric space and still fail the model `paramsSchema` because income must be positive. A path the schema strips or rewrites is rejected: the zod object schema strips `incomeRat`, so that typo would otherwise run at the scenario rate. Two dimensions on one target whose paths are equal or nested are rejected, so one probe cannot overwrite another. A `session` dimension is rejected, because each candidate runs one continuous horizon and no session schedule is executed. A repeated logical seed is rejected. A spec model that is not the scenario model is rejected. A constraint limit must be finite, so a JSON literal `1e400` that parses to Infinity is rejected, and two constraints cannot share an id. Those rejections happen before `ModelFactory.create`. The create count stays `0`.

The executed test is `rejectsUnsafeParametersBeforeRun` in `packages/core/src/sim/analysis/experiment.test.ts`.

## Candidate order does not change the scenario {#req-pr14-candidate-order}

Requirement `REQ-PR14-CANDIDATE-ORDER`. `PR-14` owns it.

`experimentCandidateOrder` is `sorted-candidates-unmutated-scenario`. Reversing explicit candidate ids changes `originalSpecHash` and leaves `effectiveSpecHash` and the rest of the artifact the same. Candidate ids come out sorted. The experiment compiles the scenario once and each fresh run creates a model, so two candidates and one seed across both orders call create `6` times. The input scenario JSON is unchanged, including a decoy `incomeRate` of `0` that is not the model parameter. Elasticity rows follow the sorted dimension ids, so reordered probed dimensions give the same artifact apart from `originalSpecHash`.

The executed test is `keepsCandidateOrderAndScenario` in `packages/core/src/sim/analysis/experiment.test.ts`.

## A censored reach time is not the horizon {#req-pr14-censored-horizon}

Requirement `REQ-PR14-CENSORED-HORIZON`. `PR-14` owns it.

`experimentCensoredHorizon` is `censored-time-not-horizon`. Horizon `9`, rate `1`, and target `10` finish with money below the target. The baseline task status is `censored` and the value is null. It is not `"9"`. The rate `2` probe still reaches in `"5"`. Elasticity against the censored baseline is `unavailable`, with null elasticity and null absolute change. The missed goal is not turned into a finite time. The reach time is read on the way and the run continues to the horizon. With target `10`, horizon `40`, and an end money constraint, rate `1` reaches in `"10"` and ends with `"40"`, and rate `2` reaches in `"5"` and ends with `"80"`. End money is not read at the reach time. Only a spec whose metrics are all `timeToMoney` stops at the goal. A scenario stop condition or step budget is removed, so it cannot end a candidate before the horizon.

The executed test is `skipsCensoredHorizonForSensitivity` in `packages/core/src/sim/analysis/experiment.test.ts`.

## Unknown objectives are not Pareto wins {#req-pr14-pareto-unknown}

Requirement `REQ-PR14-PARETO-UNKNOWN`. `PR-14` owns it.

`experimentParetoUnknown` is `unknown-is-not-superior`. Two objectives are higher end money and higher `vars.benefit`. The hand points are A `(5, 3)`, B `(3, 5)`, C `(6, 1)`, D `(2, 2)`, and E money `4` with benefit unreported. A, B, and C trade off. D is dominated by A and by B. E is `uncompared` because benefit is censored, so E is not treated as better. The front is `["A", "B", "C"]`. Constraint `cap` is end money `lte 4`, so A and C list `cap` and B does not. The artifact has no weighted score.

Money stays an amount of the effective engine. Constraints compare it in that engine, Pareto compares each objective by its order, and elasticity divides in that engine. With `breakInfinity`, end money `1e400` and `1e401` are observed, not censored. Both violate a cap of `lte 1e300`. The `1e401` probe alone is non-dominated. The elasticity of the exponent probe `401` against `400` is `3600`. The elasticity stays in the engine until it is text: end money `1e-10` and `1e400` for exponents `100` and `510` give a relative change near `1e410` and an elasticity near `2.44e409`, not unavailable. A seed mean divides before it adds, so a benefit of `1e308` on two seeds averages to `1e308`.

The executed tests are `matchesHandPareto` and `keepsLargeEngineAmounts` in `packages/core/src/sim/analysis/experiment.test.ts`.
