---
npm/@idlekit/cli: minor
---

Add a reusable typed CSV balance workflow with deterministic pacing and sensitivity checks.

- `idk balance` validates numeric IDs and units, materializes a scenario, and publishes result CSV/JSON with provenance
- atomic generation publication and freshness checks protect against stale or concurrently edited inputs
- bounded pacing checks distinguish breaches, unreached milestones, and errors using explicit seeds, strategy, and horizon
- optional `exportVariants` publishes a deterministic scenario manifest and executable sensitivity scenarios inside the checked, atomic bundle while preserving the default five outputs
- add a tiny public linear example handing exported scenarios to existing simulate, compare, strategy tuning, and offline-session analysis commands
- document numeric-only sheet fields, strategy overrides, seed and Monte Carlo boundaries, and the separation between pacing and offline/session horizons
- add synthetic contract fixtures and regression coverage without shipping game-specific balance data
