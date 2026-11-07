# Game Engine Integration

Korean version: [engine-integration_ko.md](./engine-integration_ko.md)

idlekit keeps the economy in a `ScenarioV1` file. Game engines keep it in their own resources, tables, and code. Three commands move numbers between the two and check that they still agree:

| Direction | Command | Result |
| --- | --- | --- |
| idlekit → engine | `idk export engine --target generic\|godot\|unity` | Engine-neutral JSON, a Godot `.tres` resource, or Unity JSON and CSV |
| engine → idlekit | `idk import scenario <table> --mapping <mapping.json>` | A `ScenarioV1` that passes `idk validate` |
| engine ↔ idlekit | `idk verify runtime <scenario> --plugin <adapter.ts> --runtime <id>` | A diff report of the game's income and cost functions against the idlekit model |

All three are deterministic. Exports carry no timestamp, so the same scenario always writes the same bytes. Runtime verification takes `--seed` and passes it to the game code.

The worked example lives in [examples/engine-integration](../examples/engine-integration/README.md).

## Export

```bash
idk export engine scenario.json --target generic --out economy.engine-params.json
idk export engine scenario.json --target godot --out economy.tres
idk export engine scenario.json --target godot --file-format json --out economy.json
idk export engine scenario.json --target unity --out economy.unity.json
idk export engine scenario.json --target unity --file-format csv --csv-table levels --out levels.csv
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--target` | `generic` | `generic`, `godot`, or `unity` |
| `--file-format` | target default | `generic`: `json`. `godot`: `tres` or `json`. `unity`: `json` or `csv` |
| `--levels` | `50` | Rows in the precomputed level table (`0` turns it off) |
| `--csv-table` | `auto` | Unity CSV: `levels`, `parameters`, or `auto` (levels when there are any) |
| `--godot-script` | `res://addons/idlekit/idlekit_economy.gd` | Script path written into the `.tres` |
| `--out` | stdout | Output file |

### Intermediate format

Every target is rendered from one engine-neutral document, `idlekit.engine-params` version 1. Its schema is [schemas/engine-params.v1.schema.json](./schemas/engine-params.v1.schema.json).

- `source` holds the scenario id, title, `scenarioHash`, and CLI version, so a game can tell which scenario produced its data.
- `parameters` lists the model parameters with a type (`amount`, `number`, `integer`, `boolean`, `string`) and a role (`income`, `cost`, `growth`, `other`). Amounts stay strings, so values past the float64 range survive.
- `curves` describes closed-form curves. For the built-in `linear` model these are `buy.generator.cost` (geometric: `cost(n) = base * growth^n`) and `income` (linear: `incomePerSec(n) = (base + perUnit * n) * prestigeMultiplier`).
- `levels` is a level table computed by the idlekit model itself: the price of the next unit, the total spent to reach the level, and income per second at each owned count. The table stops early with a note when a value leaves the float64 range.
- `initial`, `clock`, `policy`, and `strategy` keep the rest of the scenario, so `idk import scenario` can rebuild it.

Plugin models export their parameters as flat dotted keys (`upgrade.growth`) with a note. Curves and level tables are only computed for the built-in `linear` model.

### Godot

The `.tres` file is a Godot 4 text resource (`format=3`) bound to the `IdlekitEconomy` script. Copy [examples/engine-integration/godot/addons/idlekit/idlekit_economy.gd](../examples/engine-integration/godot/addons/idlekit/idlekit_economy.gd) into your project, then load the resource:

```gdscript
var economy := load("res://data/economy.tres") as IdlekitEconomy
var price := economy.cost_at(owned)
var income := economy.income_at(owned, prestige_multiplier)
```

Typed properties: `cost_table` and `income_table` are `PackedFloat64Array`, `parameters` is a `Dictionary`, and `curves` is an `Array` of dictionaries. The JSON variant has the same snake_case keys and loads with `IdlekitEconomy.from_json_file(path)`. The example ships a headless check that loads both files in Godot 4.3.

### Unity

The JSON output uses camelCase fields that `JsonUtility` maps onto the `IdlekitEconomy` ScriptableObject in [examples/engine-integration/unity](../examples/engine-integration/unity/IdlekitEconomy.cs). Each amount has a `double` field and, where precision matters, a text field (`text`, `baseText`, `costText`). The editor menu `Assets/idlekit/Import Economy JSON` creates the asset. CSV output is one table for spreadsheet-style importers: `level,cost,totalCost,incomePerSec` or `key,type,role,value`.

## Import

`idk import scenario` reads a CSV, JSON, or YAML table and writes `ScenarioV1`. It validates the result with the same registries as `idk validate` before writing, and prints the fit summary and warnings to stderr.

```bash
idk import scenario levels.csv --mapping levels.mapping.json --out scenario.json --report-out import-report.json
idk validate scenario.json
```

An `idlekit.engine-params` document imports without a mapping. That is the round trip: `export engine --target generic` followed by `import scenario` rebuilds the model, clock, policy, initial state, and strategy.

### Mapping config

The mapping schema is [schemas/import-mapping.v1.schema.json](./schemas/import-mapping.v1.schema.json).

| Section | Purpose |
| --- | --- |
| `source.rows` | Dotted path to the row array in a JSON or YAML document. CSV rows are used as they are. |
| `source.where` | Keep only rows whose fields equal these values. |
| `units.suffixes` | Number suffixes. `K`, `M`, `B`, and `T` are built in; add `"Qa": 1e15` and so on. `1,500` and `1_500` are read as `1500`. |
| `units.timeUnit` | Time unit of income columns: `sec`, `min`, `hour`, or `day`. Rates are converted to per second. |
| `scenario` | `id`, `title`, `unit`, `clock`, optional `policy` (default `accumulate`, `maxLogGap` 14) and `strategy` (default `greedy`). |
| `model.params` | One entry per model parameter: `{ "from": "column", "timeUnit"?, "scale"?, "type"? }` or `{ "value": ... }`. |
| `curves` | Fit `linear` model parameters from a level table: `level`, `cost` (geometric fit), `income` (linear fit), `timeUnit`. |
| `initial` | `wallet`, `owned`, and `prestigeMultiplier`, each a field or a value. |

Explicit `model.params` entries win over curve fits. Unmapped `linear` parameters fall back to the model defaults with a warning. A fit that misses a row by more than 5% also warns: the table follows a curve the `linear` model cannot reproduce, and a plugin model is the better target. The `--report-out` file records where each parameter came from (`field`, `value`, `fit`, or `default`) and the fit quality (`r2`, `maxRelError`).

### Mapping examples

A level table with suffixed prices and income per minute:

```csv
level,item,price,income_per_min
0,Espresso Machine,25.00,30
2,Espresso Machine,31.36,60
...
40,Espresso Machine,2.33K,630
```

```json
{
  "format": "idlekit.import-mapping",
  "formatVersion": 1,
  "scenario": {
    "id": "imported-shop",
    "unit": { "code": "COIN", "symbol": "C" },
    "clock": { "stepSec": 1, "durationSec": 1800 }
  },
  "curves": { "level": "level", "cost": "price", "income": "income_per_min", "timeUnit": "min" },
  "initial": { "wallet": { "value": "50" } }
}
```

The fits give `buyCostBase ≈ 25`, `buyCostGrowth ≈ 1.12`, `incomePerSec = 0.5`, and `buyIncomeDelta = 0.25`.

A nested balance sheet, one economy selected, hourly rates:

```json
{
  "format": "idlekit.import-mapping",
  "formatVersion": 1,
  "source": { "rows": "economies", "where": { "name": "mine" } },
  "units": { "timeUnit": "hour" },
  "scenario": { "id": "imported-mine", "unit": { "code": "GOLD" }, "clock": { "stepSec": 1, "durationSec": 3600 } },
  "model": {
    "id": "linear",
    "version": 1,
    "params": {
      "incomePerSec": { "from": "production.perHour" },
      "buyIncomeDelta": { "from": "production.perUpgradePerHour" },
      "buyCostBase": { "from": "upgrade.baseCost" },
      "buyCostGrowth": { "from": "upgrade.costMultiplier" }
    }
  },
  "initial": { "wallet": { "from": "start.gold" }, "owned": { "from": "start.lumberjacks" } }
}
```

`"18K"` per hour becomes `incomePerSec: "5"`. Plugin models take `model.params` entries with any key; `curves` only fits the built-in `linear` model.

## Runtime verification

A game often keeps its own copy of the income and cost formulas. `idk verify runtime` checks that copy against the idlekit model.

A plugin exports `runtimes`, an array of `RuntimeEconomyAdapter` from `@idlekit/core`:

```ts
import type { RuntimeEconomyAdapter } from "@idlekit/core";
import { CafeEconomy, CAFE_ECONOMY } from "./economy"; // game code, no idlekit imports

let economy = new CafeEconomy(CAFE_ECONOMY, 0);
export const runtimes: readonly RuntimeEconomyAdapter[] = [
  {
    id: "cafe.runtime",
    init: (ctx) => {
      economy = new CafeEconomy(CAFE_ECONOMY, ctx.seed);
    },
    incomePerSec: (state) => economy.incomePerSec(Number(state.vars.owned), state.prestigeMultiplier),
    actionCosts: (state) => ({ "buy.generator": economy.machineCost(Number(state.vars.owned)) }),
  },
];
```

```bash
idk verify runtime scenario.json --plugin ./runtime-plugin.ts --allow-plugin true --runtime cafe.runtime --seed 7
```

The command simulates the scenario with the Number engine, then calls the adapter on every traced state (`--trace-every` steps). It compares `incomePerSec` and each action price that `actionCosts` returns with the idlekit model at the same state. Both sides see the same states, so a difference is a formula difference, not trajectory drift.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--runtime` | the only adapter | Adapter id when the plugin exports several |
| `--seed` | derived from scenario and runtime id | Passed to `init({ seed })` and to every probe |
| `--duration` | scenario duration | Seconds to simulate |
| `--trace-every` | `1` | Probe every N steps |
| `--rel-tolerance` / `--abs-tolerance` | `1e-9` / `0` | A value matches when either tolerance holds |
| `--max-rows` | `20` | Mismatch rows kept in the report |
| `--fail-on-mismatch` | `true` | Exit code 1 when any value differs |
| `--format` | `json` | `json` or `md` |

The JSON report follows [schemas/runtime.verify.output.schema.json](./schemas/runtime.verify.output.schema.json). It lists per-metric counts and maximum differences, the first mismatch, and the mismatch rows with the state `vars`. `_meta` holds the seed, scenario hash, and plugin digest.

Determinism rules for adapters:

- Seed every random generator from `init`'s `seed`. `init` runs once per verification.
- Do not read clocks, the network, or global state.
- Return a finite number or a decimal string. `null` marks a value as unavailable; a probe where only one side is unavailable counts as a mismatch.

The example game rounds prices up to whole coins. Its `cafe.runtime` adapter fails with the default tolerance and passes with `--abs-tolerance 1`; `cafe.runtime.exact` matches exactly.

## Related

- [Plugin and adapter guide](./plugin-and-adapter.md)
- [Output schemas](./schemas/README.md)

### Structured parameters and v1 compatibility

Generic `idlekit.engine-params` v1 parameters may carry optional `encoding: "json"` with `type: "string"`: the value is JSON for an array, empty object, or null. Other object properties remain dotted paths. Import decodes only this explicit marker, so a genuine string such as `[1,2]` or `{}` remains a string. Existing scalar exports are unchanged. Older untagged exports cannot distinguish arrays from real strings: re-export the original scenario rather than guessing their types. Consumers using the older strict schema must adopt the updated optional field.

Godot JSON/TRES emits tagged values as native arrays/objects/null. Unity JSON keeps JSON in `text` and adds `encoding` for tagged parameters; the parameter CSV adds an `encoding` column only when needed (scalar CSV headers stay unchanged). Only the generic document is accepted by automatic scenario import. Unity/Godot consumers must handle structured data for their own game; no new recipes are generated in their example runtime.
