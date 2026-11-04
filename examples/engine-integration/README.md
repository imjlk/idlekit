# Engine Integration Example

Korean version: [README_ko.md](./README_ko.md)

This example connects one idlekit scenario to Godot, Unity, and game-side TypeScript code. The guide is [docs/engine-integration.md](../../docs/engine-integration.md).

## Files

| Path | Purpose |
| --- | --- |
| `scenario.json` | The cafe economy (`linear` model) used by every step |
| `cafe.engine-params.json` | `idk export engine --target generic --levels 25` output |
| `godot/addons/idlekit/idlekit_economy.gd` | `IdlekitEconomy` resource script for Godot 4 |
| `godot/data/cafe_economy.tres`, `godot/data/cafe_economy.json` | Godot exports |
| `godot/tools/check_economy.gd` | Headless load check |
| `unity/IdlekitEconomy.cs`, `unity/Editor/IdlekitEconomyImporter.cs` | ScriptableObject and editor importer |
| `unity/cafe_economy.json`, `unity/cafe_levels.csv` | Unity exports |
| `import/shop-levels.csv` + `.mapping.json` | Level table imported with curve fits |
| `import/balance-sheet.json` + `.mapping.json` | Nested balance sheet imported field by field |
| `ts-runtime/economy.ts` | Game-side economy code with no idlekit imports |
| `ts-runtime/runtime-plugin.ts` | Plugin that exports it as `runtimes` |

The committed exports are regenerated and compared by the CLI tests and `bun run docs:verify:quick`, so they always match the CLI.

## Run

From `packages/cli`:

```bash
# Export
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target generic --levels 25
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target godot --levels 25 \
  --out ../../examples/engine-integration/godot/data/cafe_economy.tres
bun run dev -- export engine ../../examples/engine-integration/scenario.json --target unity --file-format csv --levels 25

# Import, then validate
bun run dev -- import scenario ../../examples/engine-integration/import/shop-levels.csv \
  --mapping ../../examples/engine-integration/import/shop-levels.mapping.json --out /tmp/imported-shop.json
bun run dev -- validate /tmp/imported-shop.json

# Runtime verification
bun run dev -- verify runtime ../../examples/engine-integration/scenario.json \
  --plugin ../../examples/engine-integration/ts-runtime/runtime-plugin.ts --allow-plugin true \
  --runtime cafe.runtime.exact --seed 7 --format md
```

`cafe.runtime` is the game as shipped: it rounds prices up to whole coins. With the default tolerance it fails and lists each rounded price; `--abs-tolerance 1` accepts the rounding. `cafe.runtime.exact` matches the model exactly.

## Godot check

With Godot 4.3 or later on the path:

```bash
cd examples/engine-integration/godot
godot --headless --path . --import
godot --headless --path . --script res://tools/check_economy.gd
```

The script loads `data/cafe_economy.tres` as `IdlekitEconomy`, prints a few prices, and checks that `data/cafe_economy.json` gives the same table. Repository CI does not install Godot or Unity; the C# files are not compiled in CI.

## Unity

Copy `unity/IdlekitEconomy.cs` into your project and `unity/Editor/IdlekitEconomyImporter.cs` into an `Editor` folder. Use **Assets → idlekit → Import Economy JSON** and pick `cafe_economy.json`. At run time, `CostAt(owned)` and `IncomeAt(owned, multiplier)` read the table and fall back to the curves past its end.
