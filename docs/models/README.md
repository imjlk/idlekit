# Built-in models

Korean version: [README_ko.md](./README_ko.md)

`@idlekit/core` ships four models besides `linear`. The CLI registers all of them, so a scenario can name one in `model.id` without a plugin. Each one is a `ModelFactory` with a params schema and a vars schema, so `validateScenarioV1`, `compileScenario`, `runScenario`, `analyzeGrowth`, and the reset-cycle analyses read it like any plugin model.

| `model.id` | What it models | Tutorial | Params schema |
| --- | --- | --- | --- |
| `exponential` | One generator whose income and price both grow geometrically, with an optional level cap and soft cap | [`26-exponential-forge-v1.json`](../../examples/tutorials/26-exponential-forge-v1.json) | [`exponential.params.v1.schema.json`](../schemas/models/exponential.params.v1.schema.json) |
| `prestige` | The `exponential` generator plus a first-class reset: points, multiplier, run length, kept levels | [`27-prestige-loop-v1.json`](../../examples/tutorials/27-prestige-loop-v1.json) | [`prestige.params.v1.schema.json`](../schemas/models/prestige.params.v1.schema.json) |
| `multi-currency` | A wallet currency plus capped secondary currencies, exchanges with fees, and auto-conversion | [`28-twin-currency-v1.json`](../../examples/tutorials/28-twin-currency-v1.json) | [`multi-currency.params.v1.schema.json`](../schemas/models/multi-currency.params.v1.schema.json) |
| `production-chain` | Recipes that turn resources into resources or cash, with batch times, build costs, level gates, and bottleneck analysis | [`29-factory-chain-v1.json`](../../examples/tutorials/29-factory-chain-v1.json) | [`production-chain.params.v1.schema.json`](../schemas/models/production-chain.params.v1.schema.json) |

Model pages: [exponential](./exponential.md), [prestige](./prestige.md), [multi-currency](./multi-currency.md), [production-chain](./production-chain.md).

## Shared rules

- Amounts in params and vars are decimal strings such as `"10"` or `"1.5e12"`, so the `breakInfinity` engine keeps them exact. Rates and growth factors are numbers.
- Every field with a default may be left out. `model.params` and `initial.vars` may be left out entirely when every required field has a default (`exponential` and `prestige`).
- Every model is deterministic: the same scenario replays bit for bit, and the tests run each tutorial twice to check it.
- Income, cost, and net worth are finite or the model throws `BuiltinModelRangeError`. Use `--engine breakInfinity` for economies that pass `1e308`.
- The prestige multiplier in `state.prestige.multiplier` scales every income the models pay, so a plugin or the reset executor can drive it.
- A plugin model with the same `id@version` replaces the built-in one, the same as it would replace `linear`.
- The params JSON schemas are generated from the zod schemas with `bun run models:schemas` and checked by a unit test and `bun run models:schemas:check`. They are structural: cross-references, duplicate ids, recipe cycles, and `> 0` amounts are checked by `validateScenarioV1` only.

## What the strategies see

`greedy` ranks purchases by payback (`equivalentCost / deltaIncomePerSec`). Every built-in purchase quotes its exact income change. A purchase paid in a secondary currency quotes its cost and income in primary-equivalent value, so greedy can compare it with wallet purchases. A production-chain build quotes its steady-state marginal value, so greedy builds the bottleneck first.

`greedy` never resets the `prestige` model on its own. The reset action costs nothing and adds no income, which greedy cannot rank. Choose reset timing with `executeResetCycles` or `analyzeResetPolicies`; see [prestige](./prestige.md).

Node.js and browser runtimes are not part of the v1 compatibility contract.
