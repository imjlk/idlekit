# Scenario and Tuning Specification Guide

Korean version: [scenario-and-tuning_ko.md](./scenario-and-tuning_ko.md)

This guide summarizes the public ScenarioV1 and TuneSpec contracts used by `idlekit`.

## Minimal ScenarioV1 example

```json
{
  "schemaVersion": 1,
  "unit": { "code": "COIN" },
  "policy": { "mode": "drop" },
  "model": { "id": "linear", "version": 1 },
  "initial": {
    "wallet": { "unit": "COIN", "amount": "0" }
  },
  "clock": { "stepSec": 1, "durationSec": 600 }
}
```

## Core fields

- `unit`: primary payment currency
- `policy`: `drop` or `accumulate`, plus optional `maxLogGap`
- `model`: model id and version
- `initial`: wallet, vars, prestige state, and optional max worth
- `clock`: simulation step and stop condition
- `strategy`: strategy id plus params
- `design`: intent and session-pattern metadata for design-facing analysis
- `analysis`: ETA / growth / prestige / experience analysis options
- `monetization`: retention, revenue, and uncertainty inputs for LTV
- `sim.fast`: log-domain fast mode
- `outputs.report`: report and trace settings

## Design-facing fields

- `design.intent`: descriptive label for the intended play feel
- `design.sessionPattern`: default pattern/days for `idk experience`
- `analysis.experience.series`: `"money"` or `"netWorth"`
- `analysis.experience.draws`: Monte Carlo draw default
- `analysis.experience.quantiles`: summary quantiles for experience Monte Carlo

Common milestone key conventions:

- `progress.first-upgrade`
- `progress.first-automation`
- `prestige.first`
- `system.*`

## Strategy parameter injection

`compileScenario` resolves strategy params like this:

1. `scenario.strategy.params`
2. `strategyFactory.defaultParams`
3. `{}`

If a schema exists, params are validated before the strategy instance is created.

## Tuning

Use `TuneSpecV1` when you want to search strategy parameters against a scalar objective.
The built-in workflow is:

- define a strategy id and parameter search space
- define an objective id
- set seed list and budget
- run `idk tune ... --tune <spec>`

See the tutorial examples:

- [../examples/tutorials/11-my-game-v1.json](../examples/tutorials/11-my-game-v1.json)
- [../examples/tutorials/13-my-game-tune.json](../examples/tutorials/13-my-game-tune.json)
