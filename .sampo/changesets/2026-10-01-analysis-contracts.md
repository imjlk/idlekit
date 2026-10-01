---
npm/@idlekit/core: minor
npm/@idlekit/cli: patch
---

Add analysis artifact v1 without replacing ScenarioV1 or CLI metadata.

- money, net worth, prestige points, and milestone goals share one predicate
- model capabilities are registered outside Model and do not score missing flow as zero
- contracts:check compares the generated artifact schema and does not rewrite it
- CLI output keeps contractVersion 1.4.0 and links the artifact beside _meta
