# @idlekit/money

## 0.3.2 — 2026-10-16

### Patch changes

- [81a6e50](https://github.com/imjlk/idlekit/commit/81a6e50b52260eb50170ec6d35c6f42cc06b863d) Rebuild the packages with ttsc 0.32.1 and align its lint, Evidence, Graph, and bundler plugins. Update typia to 15.1.0 and refresh generated contract metadata and toolchain integrity pins. Support the separate native Graph packages in toolchain diagnostics. — Thanks @imjlk!

## 0.3.1 — 2026-10-13

### Patch changes

- [fc3fc9b](https://github.com/imjlk/idlekit/commit/fc3fc9b1a75ce3c00260c87dccf3e73a252148b9) Parse scientific money suffixes without intermediate overflow and keep small finite amount signs consistent with analysis artifact validation. — Thanks @imjlk!

## 0.3.0 — 2026-10-12

### Minor changes

- [38c9836](https://github.com/imjlk/idlekit/commit/38c98360e701bb087295b59825fe51f3ccd74537) Keep ETA validity and exactness aligned with engine comparison and wallet settlement.
  
  - reject positive ETA ratios lost to zero during engine division
  - reject income in a different wallet or target unit
  - expose optional Engine comparisonIsExact metadata and keep tolerant or unknown comparisons analytic-local
  - preserve legacy seconds while limiting exact labels and reach brackets to declared strict comparators — Thanks @imjlk!

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

