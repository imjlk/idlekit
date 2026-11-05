# Tutorial Example Set

Korean version: [README_ko.md](./README_ko.md)

This directory contains the example scenarios used throughout the public docs.

## Start here

- `11-my-game-v1.json`: personal baseline for your own game idea, including design intent and session defaults for `idk experience`
- `12-my-game-compare-b.json`: generated comparison variant
- `13-my-game-tune.json`: generated tuning spec

The linear starters are deterministic. For seeded variation, censored draws,
and an unresolved population p95, run the [feedback examples](../experience/README.md).

For checkpoint persistence and resume equivalence across reset cycles, run the
[save/resume example](../reset-cycle/README.md).

## Learn commands

- `01-cafe-baseline.json`: validate / simulate / eta / report
- `02-cafe-fast.json`: fast mode and step-duration differences
- `03-cafe-compare-b.json`: compare walkthrough
- `04-cafe-tune.json`: tune walkthrough

## Worked design example

- `14-orbital-foundry-v1.json`: synthetic manufacturing economy with producers, upgrades, and recovered cores
- `15-orbital-foundry-compare-b.json`: alternate costs and growth; measure worth, available cash, and milestone timing under matched conditions
- `16-orbital-foundry-tune.json`: canonical design-oriented tune spec

## Design library families

- `17-session-arcade-v1.json`: session-heavy family baseline for short-burst progression
- `18-session-arcade-compare-b.json`: faster-feeling session variant with weaker long-tail value
- `19-session-arcade-tune.json`: session-heavy tune spec
- `20-longrun-colony-v1.json`: longrun family baseline for offline-heavy scaling
- `21-longrun-colony-compare-b.json`: stronger opening but weaker 30d/90d colony scale
- `22-longrun-colony-tune.json`: longrun tune spec
- `23-prestige-reactor-v1.json`: prestige-heavy family baseline for repeated resets and multiplier carryover
- `24-prestige-reactor-compare-b.json`: earlier-prestige prestige variant with weaker carryover
- `25-prestige-reactor-tune.json`: prestige-heavy tune spec

Prestige Reactor tuning can exceed JavaScript's finite `number` range through repeated
resets. Select `--engine breakInfinity`; the plugin keeps prestige worth and reward
calculations in that engine. From the repository root:

```bash
bun run --cwd packages/cli dev -- tune ../../examples/tutorials/23-prestige-reactor-v1.json --tune ../../examples/tutorials/25-prestige-reactor-tune.json --engine breakInfinity --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
```

## Built-in model examples

These run without a plugin. See [Built-in models](../../docs/models/README.md).

- `26-exponential-forge-v1.json`: `exponential` generator with geometric income and cost, a level cap, and a pow soft cap
- `27-prestige-loop-v1.json`: `prestige` model with root-scaled points, an additive multiplier, a minimum run time, and kept levels
- `28-twin-currency-v1.json`: `multi-currency` model with capped gems, a gem-paid generator, a fee market, and overflow auto-conversion
- `29-factory-chain-v1.json`: `production-chain` model from ore to coins with batch times, level gates, a storage cap, and bottleneck quotes
- `30-lucky-forge-v1.json`: `exponential` model with seeded crits, chest drops, and frenzy events, read through 16 Monte Carlo draws with confidence intervals

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/26-exponential-forge-v1.json --format md
```

## Recommended order

1. `11 -> 12 -> 13`: create your own scenario and compare strategies.
2. `14 -> 15 -> 16`: adapt a plugin economy and examine tradeoffs.
3. Choose one family above for session, longrun, or prestige behavior.
4. `01 -> 03 -> 04`: inspect individual command outputs.

The older `05` through `10` examples have been consolidated into Orbital Foundry,
Session Arcade, and Longrun Colony. Numbers stay stable so existing references to
the retained examples keep working. These are synthetic models, with no measured
player retention or revenue attached.
