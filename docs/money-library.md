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

## Event collection and compact facts

`options.collectEvents: false` omits event records and emitter calls. Add
`options.collectFacts: true` to receive readonly `facts` counts for `applied`,
`dropped`, `queued`, `flushed`, and `blocked`, with the same wallet and bucket.
`appliedDelta` and `flushedBucket` preserve the corresponding event amounts when
those events occur. Facts are optional and independent of event collection;
the default result shape is unchanged. Core uses them when money events are
omitted so observation counters and exact positive reward detection remain intact.

## Notation and parsing boundaries

- `formatMoney` rounds to `significantDigits` (an integer from 1 to 100, default 3; anything else throws a `RangeError`). A mantissa that rounds up to 1000 moves to the next suffix: `999.9` is `1aa`, not `1.00e+3`. When the digits are fewer than the integer part, the result stays plain: `123` with 1 digit is `100`.
- A `table` suffixer stops at its last entry. Larger values keep that suffix with a bigger mantissa (`1e12` with `["", "K", "M"]` is `1000000M`) instead of printing a wrong small number.
- The sign comes from the value, so `-1e-13` prints `-1e-13` even though `cmp` treats it as equal to 0. Exponent forms are trimmed like plain ones (`1e-7`, not `1.00e-7`, unless `trimTrailingZeros` is false).
- `parseMoney` accepts ASCII digits with an optional sign, fraction, exponent, and suffix. Locale separators (`1,000`, `1.000,5`), fullwidth digits, `1_000`, `0x10`, `5.`, `NaN`, and `Infinity` are rejected. A value past the engine range comes back as the engine holds it (`Infinity` for `1e400` on the Number engine, 0 on underflow), so check `isFinite`; core ETA and compare fail closed on it. For a `table` suffixer an exact match wins over a case-insensitive one.
- `createNumberEngine().from` rejects blank and non-numeric strings instead of returning 0 or `NaN`. The strings its own `toString` writes, including `NaN`, `Infinity`, and `-Infinity`, still load. `cmp(Infinity, Infinity)` is 0. `cmp` has no unordered result for `NaN`, so guard with `isFinite`.
- `deserializeMoneyState` checks that `unit`, `amount`, and `bucket` are strings. The Number engine writes `-0` as `0`.

## When to use it directly

Use `@idlekit/money` without `@idlekit/core` when you only need:

- resource accumulation logic
- compact money formatting/parsing
- serialization of money state
- UI-facing visibility checks for small deltas

## Relationship with @idlekit/core

`@idlekit/money` is the canonical import path for engines, `Money`/`MoneyState`, `tickMoney`, notation, and money serde. `@idlekit/core` re-exports the same symbols from thin wrapper modules so existing simulator code keeps working; the implementation exists only in `@idlekit/money`. The core re-exports remain part of the v1 compatibility contract and are scheduled for deprecation, so new code that only needs money primitives should import from `@idlekit/money`.

`breakEternityEngine` and `createBreakEternityEngine` are placeholders and are not implemented in v1: every method throws `BREAK_ETERNITY_EXPERIMENTAL_MESSAGE`. They are exported only to keep the public surface stable. Use `breakInfinityEngine` (or `createBreakInfinityEngine`) for large values, or implement a custom `Engine<N>` adapter.

## Examples

- Money-only example: [../examples/money-package/README.md](../examples/money-package/README.md)
- Engine adapter example: [plugin-and-adapter.md](./plugin-and-adapter.md)
