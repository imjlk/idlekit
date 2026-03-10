# @idlekit/money

Money primitives for idle game economies: numeric engines, money state transitions,
notation, parsing, serialization, and visibility tracking.

## Install

```bash
bun add @idlekit/money
```

## Quick example

```ts
import { createBreakInfinityEngine, formatMoney, tickMoney } from "@idlekit/money";

const E = createBreakInfinityEngine();
const unit = { code: "COIN" as const };

const result = tickMoney({
  E,
  state: {
    money: { unit, amount: E.from("1e6") },
    bucket: E.zero(),
  },
  delta: { unit, amount: E.from("25") },
  policy: { mode: "accumulate", maxLogGap: 6 },
});

console.log(formatMoney(E, result.state.money));
```

## Scope

- `Engine<N>` adapters
- `Money` / `MoneyState`
- `tickMoney` with `drop` / `accumulate`
- `formatMoney` / `parseMoney`
- `serializeMoneyState` / `deserializeMoneyState`
- `VisibilityTracker`

## Runtime

`@idlekit/money` is maintained as a Bun-first ESM package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Usage guide: [docs/money-library.md](https://github.com/imjlk/idlekit/blob/main/docs/money-library.md)
- Example: [examples/money-package](https://github.com/imjlk/idlekit/tree/main/examples/money-package)
