# @idlekit/money

Money primitives for idle and incremental game economies.
Includes numeric engines, notation, money state transitions, serialization, and visibility tracking.
Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

```bash
bun add @idlekit/money
```

Requires Bun `>=1.3.0`.

Use this package when you need:

- `Engine<N>` adapters
- `Money` / `MoneyState`
- `tickMoney` with `drop` / `accumulate`
- money formatting, parsing, and serde

## Quick example

<!-- snippet: snippets/readme/money-quick-example.ts -->
```ts
import {
  createBreakInfinityEngine,
  deserializeMoneyState,
  formatMoney,
  serializeMoneyState,
  tickMoney,
} from "@idlekit/money";

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

const saved = serializeMoneyState(E, result.state, { engineName: "break_infinity.js" });
const restored = deserializeMoneyState(E, saved);

console.log(formatMoney(E, restored.money));
```

## Runtime

`@idlekit/money` is maintained as a Bun-first ESM package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Product roadmap: [docs/roadmap.md](https://github.com/imjlk/idlekit/blob/main/docs/roadmap.md)
- Usage guide: [docs/money-library.md](https://github.com/imjlk/idlekit/blob/main/docs/money-library.md)
- Example: [examples/money-package](https://github.com/imjlk/idlekit/tree/main/examples/money-package)
