# `production-chain` model

Korean version: [production-chain_ko.md](./production-chain_ko.md)

Recipes turn inputs into outputs. Ore becomes ingots, ingots become gears, gears become coins. Each recipe has a batch time, a build cost per level, optional level gates, and an optional level cap. Resources can have storage caps that push back on the recipes that fill them. `analyzeProductionChain` reads the steady-state flow and names the bottleneck.

```json
"model": {
  "id": "production-chain",
  "version": 1,
  "params": {
    "primary": { "idleIncome": "2" },
    "resources": [
      { "id": "ore", "valueInPrimary": 0.5 },
      { "id": "ingot", "valueInPrimary": 2.5, "cap": "200" },
      { "id": "gear", "valueInPrimary": 12 }
    ],
    "recipes": [
      { "id": "mine", "outputs": { "ore": "1" }, "timeSec": 1, "build": { "currency": "primary", "base": "10", "growth": 1.12 } },
      { "id": "smelter", "inputs": { "ore": "2" }, "outputs": { "ingot": "1" }, "timeSec": 2, "build": { "base": "40", "growth": 1.15 }, "unlock": [{ "recipe": "mine", "level": 3 }] },
      { "id": "assembler", "inputs": { "ingot": "3" }, "outputs": { "gear": "1" }, "timeSec": 4, "build": { "base": "150", "growth": 1.18 }, "unlock": [{ "recipe": "smelter", "level": 2 }] },
      { "id": "market", "inputs": { "gear": "1" }, "outputs": { "primary": "30" }, "timeSec": 2, "build": { "base": "400", "growth": 1.2 }, "maxLevel": 20, "unlock": [{ "recipe": "assembler", "level": 1 }] }
    ]
  }
},
"initial": { "vars": { "levels": { "mine": 0, "smelter": 0, "assembler": 0, "market": 0 }, "stock": { "ore": "0", "ingot": "0", "gear": "0" } } }
```

## Params

| Field | Default | Meaning |
| --- | --- | --- |
| `primary.idleIncome` | `"1"` | Wallet income per second with no recipe |
| `resources[]` | `[]` | `id`, `initial` (`"0"`), `cap` (storage ceiling), `valueInPrimary` (`0`; used for net worth, build quotes, and the bottleneck ranking) |
| `recipes[]` | at least one | see below |
| `recipes[].inputs` | `{}` | Amount used per batch, by resource id or `primary` |
| `recipes[].outputs` | at least one | Amount made per batch, by resource id or `primary` |
| `recipes[].timeSec` | `1` | Seconds one level takes for one batch. Capacity is `level / timeSec` batches per second |
| `recipes[].build` | `{ "currency": "primary", "base": "10", "growth": 1.15 }` | Price of level `L + 1` is `base * growth^L`, in `primary` or a resource |
| `recipes[].maxLevel` | none | Builds stop here |
| `recipes[].unlock` | `[]` | `{ recipe, level }` gates. All must hold to build, and to run |

`primary` is reserved. A recipe that consumes its own output, a cycle between recipes through resources, unknown references, and duplicate ids are rejected by `validateScenarioV1`. `primary` can appear on both sides without forming a cycle.

Vars: `levels` by recipe id, and `stock` by resource id as decimal strings.

## Each tick

Recipes run producers first, then consumers, ties in declared order, so one tick can carry ore through to coins. For each unlocked recipe with levels, the batches this tick are the smallest of:

- capacity: `level * dt / timeSec`
- every input on hand divided by its amount per batch
- the room left under every capped output divided by its amount per batch (backpressure)

Inputs are consumed, outputs are added, and `primary` outputs are paid to the wallet times the prestige multiplier. The wallet also gets `primary.idleIncome * multiplier` per second through `income`.

## Actions and milestones

- `build.<recipe>` (kind `buy`): available when the gates hold and `maxLevel` is not reached. Paid in primary it has bulk sizes 1, 10, 25, and 100; paid in a resource it checks and deducts the stock and has one size-1 quote. `deltaIncomePerSec` is the steady-state value the extra levels add (primary per second plus `valueInPrimary` of the surplus), times the multiplier. Greedy therefore builds the stage that limits the chain.
- Milestone `production-chain.<recipe>.unlocked` when a gated recipe's gates first hold.

Net worth is wallet + `Σ stock * valueInPrimary` + the price paid for every recipe level.

## Bottleneck analysis

`analyzeProductionChain(params, levels)` returns, in the Number domain:

- `depth`, and per recipe its `depth`, `level`, `capacityBatchesPerSec`, `batchesPerSec`, `utilization`, `limitedBy` (`capacity`, `unbuilt`, `locked`, or `{ input }`), and `marginalValuePerSec` for one more level
- per resource `producedPerSec`, `consumedPerSec`, and `surplusPerSec`
- `primaryPerSec` from recipes (idle income and multiplier excluded) and `valuePerSec` with surplus valued
- `bottleneck`: the recipe whose next level adds the most value, and what limits it
- `starved`: recipes running below capacity for lack of input
- `assumptions`: stock already held and storage caps are not part of the steady state

At the end of the tutorial run it reports `assembler` as the bottleneck and `market` as starved for gears.

## Try it

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/29-factory-chain-v1.json --format md
```

```ts
import { analyzeProductionChain } from "@idlekit/core";

const report = analyzeProductionChain(scenario.model.params, { mine: 65, smelter: 47, assembler: 31, market: 16 });
report.bottleneck; // { recipe: "assembler", marginalValuePerSec: 1.875, limitedBy: "capacity" }
```

Node.js and browser runtimes are not part of the v1 compatibility contract.
