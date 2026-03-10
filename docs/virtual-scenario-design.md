# Virtual Scenario Design Guide

Korean version: [virtual-scenario-design_ko.md](./virtual-scenario-design_ko.md)

This guide maps early idle-game design decisions into runnable `idlekit` scenarios.

## Recommended reading order

- [../examples/tutorials/11-my-game-v1.json](../examples/tutorials/11-my-game-v1.json)
- [../examples/tutorials/12-my-game-compare-b.json](../examples/tutorials/12-my-game-compare-b.json)
- [../examples/tutorials/13-my-game-tune.json](../examples/tutorials/13-my-game-tune.json)
- [../examples/tutorials/05-idle-design-v1.json](../examples/tutorials/05-idle-design-v1.json)
- [../examples/tutorials/08-idle-design-city-factory.json](../examples/tutorials/08-idle-design-city-factory.json)
- [../examples/tutorials/09-idle-design-loot-camp.json](../examples/tutorials/09-idle-design-loot-camp.json)
- [../examples/tutorials/10-idle-design-space-port.json](../examples/tutorials/10-idle-design-space-port.json)

## Design canvas

Before editing JSON, lock these five decisions:

- currencies: what is the main payment currency and what optional long-term value currency exists?
- production loop: what increases income over time?
- sinks: what forces meaningful spending choices?
- action priority: what should players buy first in early / mid / late game?
- KPI windows: what matters at `30m/2h/24h/7d/30d/90d`?

## Mapping ideas to scenario fields

- main currency -> `unit`, `wallet`, `Action.cost`
- secondary value currency -> `vars`, exchange actions, tuning objective weights
- producers -> `vars.producers`
- upgrades -> `vars.upgrades`
- long-horizon monetization -> `monetization`

## Suggested workflow

1. scaffold with `init scenario --track personal --preset <builder|session|longrun>`
2. rename currencies and adjust `model.params`
3. simulate the baseline
4. run `ltv` on `30m/2h/24h/7d/30d/90d`
5. compare against the generated `compare-b`
6. tune the generated strategy spec
