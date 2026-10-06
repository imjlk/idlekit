---
npm/@idlekit/cli: minor
---

Add a reusable typed CSV balance workflow with deterministic pacing and sensitivity checks.

- `idk balance` validates numeric IDs and units, materializes a scenario, and publishes result CSV/JSON with provenance
- atomic generation publication and freshness checks protect against stale or concurrently edited inputs
- bounded pacing checks distinguish breaches, unreached milestones, and errors using explicit seeds, strategy, and horizon
- add synthetic contract fixtures and regression coverage without shipping game-specific balance data
