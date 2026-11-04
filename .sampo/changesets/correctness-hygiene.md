---
npm/@idlekit/cli: patch
npm/@idlekit/core: patch
npm/@idlekit/money: patch
---

`--seed` on `simulate`, `experience`, `evaluate`, `compare`, `tune`, and `ltv` now accepts only integers in `0..4294967295`. Fractional, negative, or larger values were previously recorded in `_meta.seed` while the 32-bit RNG ran a different stream; they now fail with `CLI_USAGE`. `deriveDrawSeed` mixes the draw index with `Math.imul`, so draw indexes above about 3.4 million keep all 32 bits; seeds for smaller indexes are unchanged. `ltv` reports value-bearing monetization inputs that used built-in defaults in `monetization.assumptions` and warns on stderr. Markdown output rounds plain decimals to 12 significant digits for display, while JSON, CSV, artifacts, and state keep lossless values. Core money re-exports and the unimplemented `breakEternityEngine` placeholder are documented as such.
