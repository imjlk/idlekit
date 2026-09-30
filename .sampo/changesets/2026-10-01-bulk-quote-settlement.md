---
npm/@idlekit/core: patch
---

Charge a bulk buy the current quote once instead of the single-action cost.

- omitted `bulkSize` and size `1` still pay `Action.cost` once, then `apply` once
- a larger integer size re-reads `Action.bulk` and pays that size's `BulkQuote.cost` once
- `cost: null` stays free
- missing, duplicate, non-integer, non-finite, negative, and wrong-unit quotes are rejected without paying or applying
- planner and greedy still choose a size; they do not supply the amount that is charged
- runs that bought in bulk and paid only the unit price change, because that underpayment was the bug
