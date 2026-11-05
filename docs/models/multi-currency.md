# `multi-currency` model

Korean version: [multi-currency_ko.md](./multi-currency_ko.md)

A wallet currency (`primary`) plus one or more secondary currencies. Each generator produces one currency and is bought with one currency. Secondary currencies can have caps, exchanges move value between currencies with a fee, and auto-convert rules turn overflow or surplus into another currency every tick.

```json
"model": {
  "id": "multi-currency",
  "version": 1,
  "params": {
    "primary": { "idleIncome": "1" },
    "currencies": [{ "id": "gem", "initial": "0", "cap": "40", "valueInPrimary": 12, "idleIncome": "0.01" }],
    "generators": [
      { "id": "mine", "produces": "primary", "incomePerLevel": "1.2", "costCurrency": "primary", "costBase": "12", "costGrowth": 1.12 },
      { "id": "drill", "produces": "gem", "incomePerLevel": "0.02", "costCurrency": "primary", "costBase": "150", "costGrowth": 1.3, "maxLevel": 25 },
      { "id": "foundry", "produces": "primary", "incomePerLevel": "12", "costCurrency": "gem", "costBase": "5", "costGrowth": 1.25 }
    ],
    "exchanges": [{ "id": "sell-gems", "from": "gem", "to": "primary", "rate": 10, "fee": 0.1, "lot": "1" }],
    "autoConvert": [{ "exchange": "sell-gems", "mode": "overflow" }]
  }
},
"initial": { "vars": { "levels": { "mine": 0, "drill": 0, "foundry": 0 }, "balances": { "gem": "0" } } }
```

## Params

| Field | Default | Meaning |
| --- | --- | --- |
| `primary.idleIncome` | `"1"` | Wallet income per second with no generator |
| `primary.cap` | none | The wallet is clamped to this after each tick; the excess can feed an `overflow` rule |
| `currencies[]` | at least one | `id`, `initial` (`"0"`), `cap`, `valueInPrimary` (`1`, used for net worth and quotes; `0` leaves it out), `idleIncome` (`"0"`) |
| `generators[]` | at least one | `id`, `produces` (`"primary"`), `incomePerLevel` (`"1"`), `costCurrency` (`"primary"`), `costBase` (`"10"`), `costGrowth` (`1.15`), `maxLevel` |
| `exchanges[]` | `[]` | `id`, `from`, `to`, `rate` (units of `to` per unit of `from`), `fee` in `[0, 1)`, `lot` (`"1"`, amount one manual exchange converts) |
| `autoConvert[]` | `[]` | `exchange`, `mode` (`overflow` converts what a cap would discard; `surplus` converts everything above `keep`), `keep` (`"0"`) |

`primary` is reserved. Unknown currency, generator, or exchange references, duplicate ids, and an exchange from a currency to itself are rejected by `validateScenarioV1`.

Vars: `levels` by generator id, and `balances` by secondary currency id as decimal strings. A currency missing from `balances` starts at its `initial`.

## Each tick

1. The strategy's purchases settle.
2. The wallet receives primary income `(primary.idleIncome + Σ incomePerLevel * level) * multiplier`.
3. `evolve` clamps the wallet to `primary.cap`, then adds each secondary currency's income times `dt`, clamped to its cap, then runs the `autoConvert` rules in declared order. A converted amount is `amount * rate * (1 - fee)`.

## Actions and milestones

- `buy.<generator>` (kind `buy`). Paid in primary, it is a normal priced purchase with bulk sizes 1, 10, 25, and 100. Paid in a secondary currency, its wallet cost is `null`, `canApply` checks the balance, `apply` deducts it, and its one size-1 quote carries `equivalentCost` and `deltaIncomePerSec` in primary-equivalent value (`valueInPrimary`). That is how `greedy` ranks a gem purchase against a coin purchase.
- `exchange.<id>` (kind `custom`): converts one `lot`. From primary, the lot is the wallet cost.
- Milestone `multi-currency.<currency>.capped` when a balance (or the wallet, as `primary`) reaches its cap.

Net worth is wallet + `Σ balance * valueInPrimary` + the price paid for every generator level, in primary-equivalent value. `multiCurrencyRate(E, params, levels, currency, multiplier)` returns one currency's production per second.

## Try it

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/28-twin-currency-v1.json --format md
```

In the tutorial the gem cap of 40 fills, `sell-gems` turns the overflow into coins at 9 coins per gem, and greedy buys `foundry` levels with gems once their value beats the next coin purchase.

Node.js and browser runtimes are not part of the v1 compatibility contract.
