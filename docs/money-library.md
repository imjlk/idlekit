# @idlekit/money Guide

Korean version: [money-library_ko.md](./money-library_ko.md)

`@idlekit/money` is the focused money-handling package in the workspace.
It separates numeric engines, money state transitions, notation, parsing, and serialization
from the larger simulator.

## Scope

- `Engine<N>` numeric adapters
- `Money` / `MoneyState`
- `tickMoney` with `drop` and `accumulate`
- `formatMoney` / `parseMoney`
- `serializeMoneyState` / `deserializeMoneyState`
- `VisibilityTracker`

## Quick start

```bash
bun install
bun run --cwd packages/money typecheck
bun run --cwd packages/money test
bun examples/money-package/run.ts
```

## Minimal example

```ts
import {
  createNumberEngine,
  tickMoney,
  formatMoney,
  type MoneyState,
} from "@idlekit/money";

const E = createNumberEngine();
const unit = { code: "COIN" as const };

let state: MoneyState<number, "COIN"> = {
  money: { unit, amount: 1e9 },
  bucket: 0,
};

state = tickMoney({
  E,
  state,
  delta: { unit, amount: 1 },
  policy: { mode: "accumulate", maxLogGap: 6 },
}).state;

console.log(formatMoney(E, state.money));
```

## When to use it directly

Use `@idlekit/money` without `@idlekit/core` when you only need:

- resource accumulation logic
- compact money formatting/parsing
- serialization of money state
- UI-facing visibility checks for small deltas

## Examples

- Money-only example: [../examples/money-package/README.md](../examples/money-package/README.md)
- Engine adapter example: [plugin-and-adapter.md](./plugin-and-adapter.md)
