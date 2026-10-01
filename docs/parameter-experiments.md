# Parameter experiments

Korean version: [parameter-experiments_ko.md](./parameter-experiments_ko.md)

`runExperiment` compares registered model, strategy, and session parameters. The spec is `ExperimentSpecV1`. It is not `ScenarioV1` and it is not strategy-only `TuneSpecV1`. `idk tune` still tunes strategy params. The new command is `idk experiment <spec>`.

## What the first version measures

The method is `fixed-sweep-and-one-at-a-time`. The estimator is `one-at-a-time-local-v1`. That is local one-at-a-time sensitivity. It is not global sensitivity and it is not a Sobol index. `globalSensitivity` and `sobol` are false.

Each candidate runs on the same seeds, session, and horizon. Resetting a parameter builds a fresh model and a fresh strategy through `createRunFactory`. The input scenario object is not written. Paths are dotted identifiers checked against the existing ParamSpace kinds and the model or strategy `paramsSchema`. JSONPath, prototype paths, and eval paths are rejected before a run.

Relative elasticity is reported only when baseline `p` and `y` are finite and greater than zero and `p` changes. Otherwise the row keeps an absolute change and a direction, or it is unavailable. A goal that is not reached stays censored. Its time is null. It is not replaced with the horizon, and it is not differentiated.

The default report is per-metric change plus constraint violation ids. There is no weighted composite. Optional Pareto uses fully observed objectives only. A censored or failed objective is `uncompared` and cannot win.

## Canonical example

The fixture is [parameter-experiment.json](../fixtures/conformance/parameter-experiment.json). Seed `28948`. Constant income, target money `10`, step `1`, horizon `40`.

- model `incomeRate` baseline `1` reaches in `10`
- model probe `2` reaches in `5`, elasticity `"-0.5"`, direction `lower`
- model probe `0.5` reaches in `20`, elasticity `"-2"`, direction `higher`
- strategy `maxPicks` baseline `1` and probe `2` both reach in `10`, elasticity `"0"`, direction `flat`

The task id for the income probe is `oat:incomeRate:2#28948`. Its model params are `{"incomeRate":2}` and its strategy params stay `{"maxPicks":1}`. The policy probe keeps income at `1` and sets `maxPicks` to `2`. Both tasks record engine id `number`, engine version, model id, and model version. A horizon of `9` at rate `1` leaves the reach time null rather than `"9"`.

The artifact contract is `idlekit.experiment.v1` at `docs/schemas/generated/experiment.v1.schema.json`.

Node.js and browser runtimes are not part of the v1 compatibility contract.
