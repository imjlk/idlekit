# @idlekit/money

## 0.3.3 — 2026-11-05

### Patch changes

- [312d7e4](https://github.com/imjlk/idlekit/commit/312d7e4432b67a89a90fb7df1a11c9ea2c303b7b) `--seed` on `simulate`, `experience`, `evaluate`, `compare`, `tune`, and `ltv` now accepts only integers in `0..4294967295`. Fractional, negative, or larger values were previously recorded in `_meta.seed` while the 32-bit RNG ran a different stream; they now fail with `CLI_USAGE`. `deriveDrawSeed` mixes the draw index with `Math.imul`, so draw indexes above about 3.4 million keep all 32 bits; seeds for smaller indexes are unchanged. `ltv` reports value-bearing monetization inputs that used built-in defaults in `monetization.assumptions` and warns on stderr. Markdown output rounds plain decimals to 12 significant digits for display, while JSON, CSV, artifacts, and state keep lossless values. Core money re-exports and the unimplemented `breakEternityEngine` placeholder are documented as such. — Thanks @imjlk!
- [c874682](https://github.com/imjlk/idlekit/commit/c874682c384bb72b749e676101c9aa5196b31b61) `formatMoney` carries a mantissa that rounds to 1000 into the next suffix (`999.9` is `1aa`, not `1.00e+3`), keeps plain digits when `significantDigits` is smaller than the integer part, stays on the last `table` suffix instead of printing a wrong small value, keeps the sign of tiny negative values, trims exponent forms, and rejects `significantDigits` outside 1 to 100 or not an integer. `parseMoney` prefers an exact `table` suffix over a case-insensitive one. `createNumberEngine().from` rejects blank and non-numeric strings instead of returning 0 or `NaN`, and `cmp(Infinity, Infinity)` is 0. `deserializeMoneyState` checks that `unit`, `amount`, and `bucket` are strings. — Thanks @imjlk!

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

