# Simulation conformance

## Seeded relations are conditional {#req-dx01-conformance-harness}

Requirement `REQ-DX01-CONFORMANCE-HARNESS`. `DX-01` owns it.

The harness lives in `packages/core/src/testkit/` and `packages/money/src/testkit/`. Neither package barrel exports it. Production builds exclude `src/testkit`.

`conformanceGeneratorVersion` is `1`. A property draw records that version, the test seed, and, when a run has one, a separate game seed. Shrinking records the path from the first failing value to the kept value. `fixtures/conformance/shrink-gap.json` is one intentional failure: integers that must be `<= 0` or `>= 8`. The minimal failing integer is replayed with the same seed and path.

These relations are checked only when their condition holds:

- the same scenario and an on-grid checkpoint replay to the same engine money strings
- a declared prestige cooldown fixture resumes from JSON on the same tick grid with the last committed reset anchor, preserving reset timing and the economy snapshot; undeclared fixtures and a missing or non-positive cooldown interval do not apply
- independent trials are compared by game seed, not by call order
- event retention and a recording observer do not change the economy snapshot
- a JSON state round-trip preserves that snapshot
- step `1` and `0.5` match for constant income and may differ when a purchase threshold sits between them
- `bulk(n)` matches repeated single buys only when the fixture declares that equivalence
- a negative balance fails the check only when the payment policy disallows debt
- cross-engine comparison uses finite log distance and refuses a comparison whose `toNumber` or engine finiteness is not finite

Formula seconds, fixture expectations, and executed `etaSimulate` / `etaAnalytic` results stay labeled apart. `bun run test:conformance` uses a short fixed case count. `bun run test:conformance:extended` raises it. Temporary copies, not the working tree, show that a missing typia transform, a deleted evidence citation, and an empty graph miss.

`PR-01`, `PR-02`, `PR-03`, and `PR-05` add their own invariants on these helpers. This requirement does not claim those bugs are fixed.
