# Roadmap

Korean version: [roadmap_ko.md](./roadmap_ko.md)

This roadmap describes what `idlekit` already covers, what must be true before public npm publish, and what comes after the first public release.

## Current status

The repository already supports:

- deterministic economy simulation
- strategy tuning and replay artifacts
- offline catch-up and state resume
- `experience` analysis for session patterns, milestones, perceived progression, and growth
- long-horizon `ltv` / `kpi` evaluation
- one canonical plugin-rich worked example: `Orbital Foundry`

## Pre-publish gate

Public publish is considered blocked until these stay green together:

- `bun run typecheck`
- `bun run test`
- `bun run docs:verify`
- `bun run templates:check`
- `bun run public:check`
- `bun run kpi:report`
- `bun run kpi:regress`
- `bun run release:publish:preflight`

Product-level publish expectations:

- the personal scaffold flow works without plugins
- the Orbital Foundry example proves design tradeoff analysis
- docs explain both first-contact usage and serious design evaluation
- package landing pages stay consistent with the actual supported feature set

## v1 roadmap

### 1. Publish readiness

- keep English canonical docs and Korean `_ko` docs aligned
- keep Orbital Foundry as the main worked example
- keep release, pack, replay, and docs gates green

### 2. Design report polish

- improve `experience --format md`
- improve `compare` summaries for design tradeoffs
- add clearer decision hints to reports and KPI outputs

### 3. Real design library

- add more canonical game concepts with distinct design intent
- add more milestone conventions and worked tuning objectives
- extend session-pattern and perceived progression guidance

### 4. Post-v1 extensions

- stochastic gameplay models built on explicit seeded randomness
- richer automation/prestige examples
- more adapter/plugin examples for external consumers

## What not to expect in v1

- breaking public API churn
- major version bumps
- arbitrary calendar DSLs for sessions
- non-deterministic core behavior outside explicit seeded Monte Carlo paths
