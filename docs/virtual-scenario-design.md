# Virtual Scenario Design Guide

Korean version: [virtual-scenario-design_ko.md](./virtual-scenario-design_ko.md)

This guide maps early idle-game design decisions into runnable `idlekit` scenarios.

## Recommended reading order

- [../examples/tutorials/11-my-game-v1.json](../examples/tutorials/11-my-game-v1.json)
- [../examples/tutorials/12-my-game-compare-b.json](../examples/tutorials/12-my-game-compare-b.json)
- [../examples/tutorials/13-my-game-tune.json](../examples/tutorials/13-my-game-tune.json)
- [../examples/tutorials/14-orbital-foundry-v1.json](../examples/tutorials/14-orbital-foundry-v1.json)
- [../examples/tutorials/15-orbital-foundry-compare-b.json](../examples/tutorials/15-orbital-foundry-compare-b.json)
- [../examples/tutorials/16-orbital-foundry-tune.json](../examples/tutorials/16-orbital-foundry-tune.json)
- [../examples/tutorials/05-idle-design-v1.json](../examples/tutorials/05-idle-design-v1.json)
- [../examples/tutorials/08-idle-design-city-factory.json](../examples/tutorials/08-idle-design-city-factory.json)
- [../examples/tutorials/09-idle-design-loot-camp.json](../examples/tutorials/09-idle-design-loot-camp.json)
- [../examples/tutorials/10-idle-design-space-port.json](../examples/tutorials/10-idle-design-space-port.json)

## Canonical worked example: Orbital Foundry

`Orbital Foundry` is the repo's main publish-facing design example.

Concept mapping:

- currency: `CREDIT`
- producers: orbital fabricators and drone lines
- upgrades: automation tiers
- auxiliary value: recovered `cores`

Use it when you want to see the full decision loop on a richer economy:

1. validate the baseline
2. inspect `experience` under `twice-daily`
3. compare end-state worth and milestone timing against the A/B variant
4. tune the producer-first strategy with a design-oriented objective
5. run `ltv` and `kpi:report` for long-horizon viability

The intended tradeoff in this pair is:

- baseline (`14`): better long-run worth and long-horizon value
- compare-b (`15`): faster first-upgrade timing

## Design library families

Use these families after Orbital Foundry when you want a more specific pacing shape:

- `17/18/19 Session Arcade`: short-burst, session-heavy progression
- `20/21/22 Longrun Colony`: offline-heavy scale checks and 30d/90d worth
- `23/24/25 Prestige Reactor`: reset timing, multiplier carryover, and prestige loops

## Design canvas

Before editing JSON, lock these five decisions:

- currencies: what is the main payment currency and what optional long-term value currency exists?
- production loop: what increases income over time?
- sinks: what forces meaningful spending choices?
- action priority: what should players buy first in early / mid / late game?
- KPI windows: what matters at `30m/2h/24h/7d/30d/90d`?

Then add the design-facing layer:

- `design.intent`: what feeling are you aiming for?
  - `frequent-progression`
  - `scale-fantasy`
  - `strategic-optimization`
- `design.sessionPattern`: which real play rhythm are you evaluating?
  - `always-on`
  - `short-bursts`
  - `twice-daily`
  - `offline-heavy`
  - `weekend-marathon`
- `analysis.experience`: default series / draw / quantile settings for `idk experience`

## Mapping ideas to scenario fields

- main currency -> `unit`, `wallet`, `Action.cost`
- secondary value currency -> `vars`, exchange actions, tuning objective weights
- producers -> `vars.producers`
- upgrades -> `vars.upgrades`
- long-horizon monetization -> `monetization`
- design intent -> `design.intent`
- session cadence -> `design.sessionPattern`
- perceived progression defaults -> `analysis.experience`

## Suggested workflow

1. scaffold with `init scenario --track personal --preset <builder|session|longrun>`
2. rename currencies and adjust `model.params`
3. simulate the baseline
4. run `experience` to inspect milestones and perceived progression
5. run `ltv` on `30m/2h/24h/7d/30d/90d`
6. compare against the generated `compare-b`
7. tune the generated strategy spec

## Standard milestone keys

Built-in and documentation-facing milestone keys should use these conventions:

- `progress.first-upgrade`
- `progress.first-automation`
- `prestige.first`
- `system.*` for model-specific milestones

If your plugin model emits milestones, keep those names stable so `compare --metric timeToMilestone --milestone-key ...` stays usable across scenario variants.
