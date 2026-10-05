# Plugin and Adapter Guide

Korean version: [plugin-and-adapter_ko.md](./plugin-and-adapter_ko.md)

This guide covers two extension points:

- CLI plugins that contribute models, strategies, and objectives
- `Engine<N>` adapters that let you plug in a custom numeric backend

## Plugin module shape

A CLI plugin can export any combination of `models`, `strategies`, and `objectives`.

```ts
import type { ModelFactory, ObjectiveFactory, StrategyFactory } from "@idlekit/core";

const plugin: {
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
} = {
  models: [],
  strategies: [],
  objectives: [],
};

export default plugin;
```

Named exports are also supported.

## Loading a plugin

```bash
bun run --cwd packages/cli dev -- models list --plugin ./my-plugin.ts --allow-plugin true
```

Recommended secure loading:

```bash
SHA=$(shasum -a 256 ./my-plugin.ts | awk '{print $1}')
bun run --cwd packages/cli dev -- models list \
  --plugin ./my-plugin.ts \
  --allow-plugin true \
  --plugin-root . \
  --plugin-sha256 ./my-plugin.ts=$SHA
```

Canonical worked example using the bundled plugin:

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/14-orbital-foundry-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --session-pattern twice-daily \
  --days 7 \
  --format json
```

## Engine adapters

`@idlekit/money` and `@idlekit/core` use the `Engine<N>` interface to abstract numeric backends.
That lets you switch between `number`, `break_infinity.js`, or your own fixed-point / bigint engine.

`stepOnce` is the payment boundary. An omitted `bulkSize`, or size `1`, pays `Action.cost` once and then calls `apply` once. A larger integer size re-reads `Action.bulk` on the current state and pays the one matching `BulkQuote.cost` once. `apply` does not pay again. A size chosen by a planner is not a stored price. A missing, duplicate, non-integer, non-finite, negative, or wrong-unit quote is rejected before `apply`.

Runners do not step past `durationSec`. The last tick may be shorter than `stepSec`. Each tick passes a copy of `ctx` whose `stepSec` is that tick's `dt`. The original context object is not written. A preview that reads `ctx.stepSec` therefore sees the runner's clock, not a stored step. Only constant income is treated as exact across different step sizes.

Independent trials do not share a strategy cursor or a stateful model closure. `createRunFactory` restores `snapshotState` for a fresh draw, keeps that cursor for `continue`, and builds a new instance from a `ModelFactory` or `StrategyFactory`. A closure with hidden state and neither a factory nor snapshot hooks is not isolated by cloning the function. Marking it stateful throws `RunIsolationError` before the run. `initial.vars` is copied from the input scenario. `ctx.E` is shared. Engine values are treated as immutable.

Use the adapter example to see a custom `Engine<bigint>` wired into the simulator:

- [../examples/adapter-pattern/README.md](../examples/adapter-pattern/README.md)
- [../examples/plugins/README.md](../examples/plugins/README.md)

## Built-in linear model and large amounts

The built-in `linear` model accepts decimal or scientific amount strings for `incomePerSec`, `buyCostBase`, and `buyIncomeDelta`. Its costs, bulk quotes, and inventory value use the selected money engine, including exponential costs that exceed the Number range.

Use `idk simulate scenario.json --engine breakInfinity --format json` (or the same engine flag on `experience`, `evaluate`, and `ltv`) for large economies such as `1e400`. `scenario.engine` is metadata and does not select the runtime engine. The default Number engine rejects non-finite linear income, costs, or net worth with guidance to choose `breakInfinity`. Engine arithmetic still has the precision and range of its adapter; a finite logarithm does not promise exact integer accounting.
