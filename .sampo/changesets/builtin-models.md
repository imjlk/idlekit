---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Add four built-in models that need no plugin: `exponential` (geometric generator with `maxLevel` and a `pow`/`sqrt`/`log` soft cap), `prestige` (exponential generator plus a `prestige.reset` action and `Model.prestige` spec that `executeResetCycles` and `analyzeResetPolicies` pick up), `multi-currency` (capped secondary currencies, exchanges with fees, overflow/surplus auto-conversion, secondary-currency purchases quoted in primary value), and `production-chain` (recipes with batch time, build cost, unlock gates, storage backpressure, and `analyzeProductionChain` bottleneck analysis). The CLI registers them next to `linear`. Params JSON schemas live in `docs/schemas/models/`, tutorials `26` to `29` show each model, and `docs/models/` documents them. Existing scenarios and the `linear` model are unchanged.
