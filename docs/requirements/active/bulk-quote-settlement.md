# Bulk quote settlement

## Quoted bulk buys pay the current quote once {#req-pr01-bulk-quote-settlement}

Requirement `REQ-PR01-BULK-QUOTE-SETTLEMENT`. `PR-01` owns it.

`stepOnce` in `packages/core/src/sim/step.ts` is the production host. `singleBuySize` is `1`. An omitted `bulkSize` or that size pays `Action.cost` once and then calls `apply` once. It does not read `Action.bulk`. A larger integer size calls `Action.bulk` on the state after earlier actions in the same tick and pays the one `BulkQuote` whose `size` is that integer. `cost: null` is free and is not the same as a missing cost. A zero amount is a finite payment. A missing size, two quotes with that size, a non-positive, fractional, `NaN`, or infinite size, a non-finite amount, a negative amount, or a unit mismatch is rejected before `apply`. Rejection does not change `wallet` or `vars`. Insufficient funds still follow `payment.onInsufficientFunds` (`skip`, `warn`, or `throw`) and skip with `insufficientFunds`. Other quote rejections skip with `invalidQuote`.

`apply` does not make a second payment. A quote stored by a planner or a UI is not the amount charged. The next action in the same tick is quoted again. Plugin callbacks are not rolled back.

`packages/core/src/sim/step.bulk.test.ts` is the executed test host. It is not the production host. Builtin `linear` and `plugin.generators` pay the quote their own `bulk()` returns, from the CLI fixture that calls the same `stepOnce`.

`checkBulk` compares a bulk buy with repeated single buys only when the fixture declares that equivalence. A mid-buy bonus is not declared, so that pair is not required to match. The flat size-10 total `10 * 10` is the formula. The quote object is the fixture. The wallet after `stepOnce` is the executed result. The declared-equality property uses test seed `0xB011`.
