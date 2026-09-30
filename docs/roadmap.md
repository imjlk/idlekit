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

Those exports are not finished analysis contracts. ETA, prestige-cycle, growth, session simulation, Monte Carlo, the strategy tuner, in-process `evaluate`, `review`, KPI regression, and replay already exist. Shared meanings and the version policy are in [Analysis contracts](./adr/analysis-contracts.md). The source inventory is in [Source audit](./implementation/source-audit.md).

## Analysis track

Correctness work follows the toolchain, then the conformance harness:

1. Baseline contracts in the ADR and source audit.
2. `TC-01` through `TC-04`: ttsc check/emit, the Bun transform, Evidence, and Graph.
3. `DX-01`: seeded conformance tests.
4. `PR-01` through `PR-07`: payment, time bounds, run isolation, observation, session time, and resolved run configuration.
5. `TC-05` before new analysis DTOs, then `PR-08` through `PR-14`.
6. `DX-02` through `DX-04`: analyzer registry, inspect, and runtime performance budgets.
7. `PR-17` and `PR-18`: deterministic balance checks, then an optional rule judge.
8. `PR-20`: integration fixtures, docs, packaging, and consumer gates for the selected scope.

`PR-15` (flow observation), `PR-16` (guarded time skip), `PR-19` (Jev provider), and `DX-05` (worker backend) stay optional.

At `265c6ed`, root `packageManager` is `bun@1.3.10` and CI pins Bun `1.3.9`. Check and emit still use `tsc`. `TC-01` unifies the host and moves check/emit to ttsc. Development Node or Go needed by that compiler is a host detail. The product runtime stays Bun-first.

`prestigeCycle.stability` is not a steady-state measurement. `createBreakEternityEngine` remains an unimplemented placeholder.

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
- Node.js or browser support as a product runtime
- a finished `breakEternity` engine
- Jev as a required publish gate
