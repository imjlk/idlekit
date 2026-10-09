# @idlekit/money

## 0.2.0 — 2026-10-09

### Minor changes

- [9f28ee9](https://github.com/imjlk/idlekit/commit/9f28ee9537eb5d7b8bae0ae0c5e39cad16a16dda) Require Bun >=1.4.2 for all packages. Upgrade the Bun runtime and CI pins before installing this release, or retain an already installed previous package version and lockfile until the runtime can be upgraded. Follow the migration guide at https://github.com/imjlk/idlekit/blob/main/docs/bun-14-migration.md. — Thanks @imjlk!
- [3f7e9b1](https://github.com/imjlk/idlekit/commit/3f7e9b1bae6f6c53a3c1e8f800d14c9c41aad20f) Allow money ticks to return compact counts and applied/flushed amounts without retaining events. Fast simulations and planner previews use these facts to preserve observation counters and reward gaps while avoiding discarded event objects. Reuse each policy's computed precision gap for its threshold check. — Thanks @imjlk!

### Patch changes

- [cdb504f](https://github.com/imjlk/idlekit/commit/cdb504fefdf0c03e7e3ce010d8997e8d32eddc30) Charge a bulk buy the current quote once instead of the single-action cost.
  
  - omitted `bulkSize` and size `1` still pay `Action.cost` once, then `apply` once
  - a larger integer size re-reads `Action.bulk` and pays that size's `BulkQuote.cost` once
  - `cost: null` stays free
  - missing, duplicate, non-integer, non-finite, negative, and wrong-unit quotes are rejected without paying or applying
  - planner and greedy still choose a size; they do not supply the amount that is charged
  - the linear CLI plugin prices a later buy from ownership so far, and LTV counts invalid-quote skips
  - runs that bought in bulk and paid only the unit price change, because that underpayment was the bug
  - affordability uses exact decimal order, including a huge exponent gap, and does not treat `cmp` or a rounded `toNumber` as exact
  - an engine whose text is not a bare decimal settles only when it implements `exactOrder`
  - greedy `maxAffordable` uses that same exact check — Thanks @imjlk!

