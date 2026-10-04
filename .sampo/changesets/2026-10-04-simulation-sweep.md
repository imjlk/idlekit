---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Close the recurring correctness gaps from the #156 review.

- default seeds and `effectiveRunHash` come from one resolved run identity, so equivalent flags, paths, and save metadata give the same seed, run id, and digest
- default run ids no longer read the scenario path; existing run ids and stage digests change, while no-flag default seeds stay the same
- session observation caps, drop counts, and observer notifications cover the whole session; a session `until` reads a copy of the state
- a shared snapshot strategy has one cursor owner across bindings; a resume that cannot restore its checkpoint throws `RunIsolationError`
- durations are tick seconds instead of `end.t - start.t`, which rounds at a large start time
- a non-finite or non-numeric `state.t`, a non-finite analytic ETA input, and an oversized or non-advancing prestige-cycle scan are rejected
- growth refuses a cut trace and does not draw a segment across a non-finite point; a partial milestone report no longer reads a dropped key or a missing first milestone as unreached
- simulate `totalElapsedSec` sums tick durations across online, offline, and newly saved resume segments; legacy saves retain their timestamp-offset fallback
- action logs carry tick elapsed time across bounded logs and session segments, and ltv `timeToFirstUpgradeSec` uses it from the analysis start
