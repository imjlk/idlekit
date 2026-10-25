# Parameter experiments

Korean version: [parameter-experiments_ko.md](./parameter-experiments_ko.md)

`runExperiment` compares registered model and strategy parameters. The spec is `ExperimentSpecV1`. It is not `ScenarioV1` and it is not strategy-only `TuneSpecV1`. `idk tune` still tunes strategy params. The new command is `idk experiment <spec>`.

## What the first version measures

The method is `fixed-sweep-and-one-at-a-time`. The estimator is `one-at-a-time-local-v1`. That is local one-at-a-time sensitivity. It is not global sensitivity and it is not a Sobol index. `globalSensitivity` and `sobol` are false.

Each candidate starts from the scenario named by `scenario.ref`: its wallet, unit, tick policy, model params, and strategy params. Only the assigned paths change, and the raw params reach `create` as they do in a scenario run. The spec model must be the scenario model, and a spec strategy must be the scenario strategy when the scenario names one. Each candidate runs on the same seeds and horizon. The session block is recorded on each task, but no session schedule is executed, so a `session` dimension is rejected. Resetting a parameter builds a fresh model and a fresh strategy through `createRunFactory`. The input scenario object is not written. Paths are dotted identifiers checked against the existing ParamSpace kinds and the model or strategy `paramsSchema`. A path the schema strips is rejected. A schema that transforms a value only validates it: the factory still receives the raw assigned value, as in a legacy-raw scenario run, and the task records that raw value. In addition, a factory without a schema accepts only paths already in the scenario params, and so are two dimensions on one target whose paths are equal or nested. Logical seeds and constraint ids must be unique, and a constraint limit must be finite. JSONPath, prototype paths, and eval paths are rejected before a run.

Runs continue to `horizonSec`, except when every metric is `timeToMoney`, which can stop at its goal. The reach time is read on the way, so end money and `vars.benefit` are horizon values even when `timeToMoney` is also requested. A candidate metric is the arithmetic mean over every seed. One failed seed fails it and one censored seed censors it. Money stays an amount of the effective engine: constraints, Pareto order, and elasticity compare it in that engine, so a `breakInfinity` amount past the double range is still observed.

Relative elasticity is reported only when baseline `p` and `y` are finite and greater than zero and `p` changes. Otherwise the row keeps an absolute change and a direction, or it is unavailable. A goal that is not reached stays censored. Its time is null. It is not replaced with the horizon, and it is not differentiated. Its lower bound, the simulated horizon, only proves an `lte` time constraint violated.

The default report is per-metric change plus constraint violation ids. There is no weighted composite. Optional Pareto uses fully observed objectives only. A censored or failed objective is `uncompared` and cannot win.

## Progress milestones

Reach times use the sum of committed tick durations, so large absolute state clocks do not round a fractional duration. Action-derived keys such as `action.buy.firstApplied` and `progress.first-upgrade` occur at tick start; model-emitted and `prestige.first` milestones occur at tick end. An initially affordable purchase therefore measures zero seconds and satisfies a zero-second deadline.

Use `"metricId": "timeToMilestone"` with `"milestoneKey": "tower:first-prestige"` to compare the first committed occurrence of that exact key. It also works in objectives and constraints; one spec selects one milestone key. The artifact records that key. Use a key emitted by model `milestones` or a runner key such as `prestige.first`; the experiment does not infer progress from money or the initial state.

This measures progression even when buying upgrades or prestiging empties the wallet. The first occurrence wins, even when the key repeats or retained event and milestone samples are full. A missing key stays censored with a null value. Its elapsed horizon is only a lower bound for deadline constraints, not an achieved time. Sensitivity is unavailable when the baseline is censored. Runs using this metric continue to the horizon, so it can be compared with end money and `vars.benefit`.

A spec fragment for reaching a first prestige within 20 minutes:

```json
{
  "metricId": "timeToMilestone",
  "milestoneKey": "tower:first-prestige",
  "constraints": [
    { "id": "first-prestige-deadline", "metricId": "timeToMilestone", "op": "lte", "limit": 1200 }
  ]
}
```

## Canonical example

The fixture is [parameter-experiment.json](../fixtures/conformance/parameter-experiment.json). Seed `28948`. Constant income, target money `10`, step `1`, horizon `40`.

- model `incomeRate` baseline `1` reaches in `10`
- model probe `2` reaches in `5`, elasticity `"-0.5"`, direction `lower`
- model probe `0.5` reaches in `20`, elasticity `"-2"`, direction `higher`
- strategy `maxPicks` baseline `1` and probe `2` both reach in `10`, elasticity `"0"`, direction `flat`

The task id for the income probe is `oat:incomeRate:2#28948`. Its model params are `{"incomeRate":2}` and its strategy params stay `{"maxPicks":1}`. The policy probe keeps income at `1` and sets `maxPicks` to `2`. Both tasks record engine id `number`, engine version, model id, and model version. The CLI records the version of the engine that ran (`idlekit-cli@<version>` for a built-in engine), not the scenario engine metadata. A horizon of `9` at rate `1` leaves the reach time null rather than `"9"`.

The artifact contract is `idlekit.experiment.v1` at `docs/schemas/generated/experiment.v1.schema.json`.

Node.js and browser runtimes are not part of the v1 compatibility contract.
