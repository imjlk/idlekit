# `prestige` model

Korean version: [prestige_ko.md](./prestige_ko.md)

The [`exponential`](./exponential.md) generator plus a first-class reset. A reset turns the run's net worth into prestige points, the points set a permanent income multiplier, and the run starts over. The model plugs into the existing `state.prestige` fields and into the reset-cycle executor, so the reset analyses work on it without an adapter.

```json
"model": {
  "id": "prestige",
  "version": 1,
  "params": {
    "generator": { "idleIncome": "1", "baseIncome": "1", "growthRate": 1.03, "costBase": "12", "costGrowth": 1.13 },
    "prestige": {
      "requirement": "2e4",
      "formula": { "kind": "root", "scale": 1, "exponent": 0.5 },
      "multiplierPerPoint": 0.25,
      "multiplierMode": "additive",
      "minRunSec": 300,
      "minGain": 1,
      "starterCash": "10",
      "keepLevels": 2
    }
  }
},
"initial": { "vars": { "level": 0, "runStartT": 0 } }
```

## Params

`generator` takes every [`exponential`](./exponential.md) param, `stochastic` included. `prestige`:

| Field | Default | Meaning |
| --- | --- | --- |
| `requirement` | `"1e6"` | Net worth at which a reset first grants points. Must be `> 0` |
| `formula` | `{ "kind": "root", "scale": 1, "exponent": 0.5 }` | `root`: `floor(scale * (worth / requirement)^exponent)`, exponent in `(0, 1]`. `log10`: `floor(scale * (log10(worth / requirement) + 1))` |
| `multiplierPerPoint` | `0.1` | Multiplier per total point |
| `multiplierMode` | `"additive"` | `additive`: `1 + perPoint * points`. `compound`: `(1 + perPoint)^points` |
| `minRunSec` | `0` | A run must last this long before the reset is offered. `constraints.minPrestigeIntervalSec` still applies on top |
| `minGain` | `1` | A reset that would grant fewer points is not offered |
| `starterCash` | `"0"` | Wallet after a reset |
| `keepLevels` | `0` | Generator levels kept through a reset |

Vars: `level` and `runStartT`, the `t` at which the current run started (default `0`).

## The reset

`prestige.reset` (kind `prestige`, no cost) is offered when the run is at least `minRunSec` old and the gain is at least `minGain`. The gain is read from net worth, wallet plus the price paid for current levels, so spending does not lower it. Applying it:

- sets the wallet to `starterCash`, clears the settlement bucket, and sets `maxMoneyEver` to `starterCash`
- adds one to `prestige.count`, adds the gain to `prestige.points`, and recomputes `prestige.multiplier` from the total
- keeps `min(keepLevels, level)` levels and sets `runStartT` to the reset time

The model also exposes the same rules as a `Model.prestige` spec (`pointsFrom`, `multiplierFrom`, `resetState`), for callers that read the spec. The milestone `prestige.reset-available` fires when a reset first becomes available in a run.

## Who decides when to reset

The executor is the only reset authority, as [Reset cycle execution](../reset-cycle.md) requires. `greedy` does not reset, because the action has no cost and no income quote to rank. Use one of:

- `executeResetCycles({ scenario, policy: { kind: "fixed-interval", intervalSec, cycles } })`, which picks `prestige.reset` through `resetAdapterFor` and commits one reset per boundary
- `analyzeResetPolicies({ createScenario, scan, horizonSec, ... })`, which compares intervals by realized points (`state.prestige.points`); see [Reset policy analysis](../reset-cycle-analysis.md)
- a plugin strategy that issues `prestige.reset`

`previewPrestigeGain(E, params, worth, currentPoints)` is the design-time hook: it returns `eligible`, `gainedPoints`, `nextPoints`, and `nextMultiplier` for a worth, without run time or cooldown. Use it to tabulate a reset curve or to check a reset-policy result by hand. `prestigePointsFor` and `prestigeMultiplierFor` are the two formulas on their own.

```ts
import { analyzeResetPolicies, compileScenario, createNumberEngine } from "@idlekit/core";

const artifact = analyzeResetPolicies({
  createScenario: () => compileScenario({ E: createNumberEngine(), scenario, registry, strategyRegistry }),
  scan: { fromSec: 600, toSec: 1800, stepSec: 600 },
  horizonSec: 5400,
  cycleBudget: 10,
  objective: "cumulative-reset-reward",
  recovery: { metric: "pre-reset-net-worth" },
  stability: { minObservedCycles: 3, windows: [2, 3], absoluteTolerance: "0", relativeTolerance: 0.5 },
});
```

`idk prestige-cycle` is the legacy interval scan. It runs the scenario's strategy for each interval and does not reset, so its `pointsPerHour` counts the reset available at the end of each interval (`Model.prestige.pointsFrom`) on top of committed points. `idk reset-policy` runs `analyzeResetPolicies` from the CLI and adds ROI against never resetting, a timing window, and stability; see [Advanced analysis](../advanced-analysis.md#reset-policy-idk-reset-policy).

## Try it

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/27-prestige-loop-v1.json --format md
bun run --cwd packages/cli dev -- prestige-cycle ../../examples/tutorials/27-prestige-loop-v1.json --scan 600..2400 --step 600 --horizon 7200 --format md
bun run --cwd packages/cli dev -- reset-policy ../../examples/tutorials/27-prestige-loop-v1.json --scan 600..1800 --step 600 --horizon 5000 --format md
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
