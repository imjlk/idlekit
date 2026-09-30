# Testing Guide

Korean version: [testing_ko.md](./testing_ko.md)

Official support in v1: Bun `>=1.3` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

## Repository commands

```bash
bun run typecheck
bun run runtime:check
bun run --cwd packages/cli generate:check
bun run --cwd packages/cli doctor:completions
bun run test
bun run test:conformance
bun run test:conformance:extended
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run readme:smoke
bun run review:smoke
bun run compat:check
bun run public:check
bun run replay:verify
bun run bench:sim
bun run bench:sim:suite
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
bun tools/analysis-baseline-check.ts
```

## Test runtime rules

- Use `bun:test` as the default test runner
- Prefer `packages/cli/src/testkit/bun.ts` for CLI test I/O
- Prefer Bun APIs over `node:` imports in `packages/*/src` runtime code and `tools/`
- Enforce the runtime rule with `bun run runtime:check`
- Treat Node.js/browser execution as outside the v1 support contract unless explicitly documented otherwise

## Current coverage

Core:

- step transitions and simulation loop behavior
- strategy determinism and resume state
- scenario validation / compilation
- offline catch-up and serializer validation

CLI:

- output schemas and replay artifact contracts
- `experience` schema, session-pattern replay, and design-metric comparisons
- `setup`, `doctor --fix`, `tune --wizard`, and review TUI/image flows
- init preset matrix and naming rules
- error contract coverage
- replay consistency and resume determinism
- plugin loading and security policy
- docs, templates, install smoke, public readiness, and replay gates
- interactive review smoke for `review doctor`, `review evaluate`, and `review compare`
- perceived progression and KPI regression guardrails

## Interactive review smoke

`bun run review:smoke` is a maintainer-only check for the human review path.

- it mounts the lazy-loaded `review doctor`, `review evaluate`, and `review compare` flows with a test renderer
- it verifies the shared loading shell appears first
- it verifies each dashboard reaches stable content without crashing after lazy follow-up work

## Compatibility fixtures

Compatibility fixtures live under `fixtures/compat/v1/`.

- add new fixtures for additive contract growth
- do not rewrite existing fixtures unless you are intentionally revisiting compatibility policy
- run `bun run compat:check` after adding or updating fixtures

## Analysis baseline

At `265c6ed` the repository compiler was `tsc`, tests ran with `bun test`, and the CLI bundle was Bunli. Root Bun was `1.3.10` and CI pinned Bun `1.3.9`. `TC-01` moves CI to Bun `1.3.10` and pins ttsc. `TC-02` runs package check and money/core emit through `ttsc`, with the same transform on Bun source, `bun test`, the CLI bundle, and the packed artifact. The live pins are in [Toolchain pins](./toolchain.md).

`bun tools/analysis-baseline-check.ts` checks the paths cited by the [source audit](./implementation/source-audit.md) and the current host pins.

`evidence:check`, `evidence:smoke`, and `format:check` are repository commands after `TC-03`. `graph:check` is the `TC-04` command. `test:conformance` is the `DX-01` command. `contracts:generate` and `contracts:check` are not. `toolchain:doctor` and `toolchain:prepare` are the `TC-01` host commands.

## Simulation conformance

`packages/core/src/testkit/conformance.ts` and `packages/money/src/testkit/compareAmounts.ts` are test-only. Package barrels do not export them, and production builds exclude `src/testkit`.

The test seed drives case generation. `gameSeedForCase` derives the game RNG seed from that test seed without consuming the generator. Reports store `conformanceGeneratorVersion` (`1`), both seeds, engine, model, strategy, and tick schedule. A failure shrinks toward a smaller value and can be replayed from `fixtures/conformance/shrink-gap.json`.

Checked only when the fixture says the relation holds:

| Relation | Condition |
|---|---|
| replay, on-grid resume, JSON round-trip | same ticks, decisions, and RNG schedule |
| trial order | results are keyed by game seed |
| event retention and a recording observer | economy snapshot, not the retained sample list |
| step `1` vs `0.5` | constant income must match; a purchase threshold may differ |
| bulk vs repeated buys | the fixture declares equivalence |
| negative balance | the payment policy disallows debt |
| number vs break-infinity | finite log distance; non-finite `toNumber` is not equality |

Formula seconds are labeled `formula`. `etaSimulate` and `etaAnalytic` stay `executed`. `PR-01`, `PR-02`, `PR-03`, and `PR-05` add further invariants on these helpers. `bun run test:conformance` uses eight property cases. `CONFORMANCE_CASES=200` via `test:conformance:extended` is the scheduled corpus (`.github/workflows/conformance-extended.yml`). The negative half copies fixtures under `tmp/` and expects a missing typia transform, a deleted evidence citation, and an empty graph lookup to miss.

Graph does not see the JSON fixture, the workflow file, or the package script string. Those are unobserved dynamic edges. Query `runScenario`, `conformanceGeneratorVersion`, and `compareAmounts` in source before editing the helpers.

### DX-01 verification

Host: macOS arm64, Bun `1.3.10`, `ttsc 0.30.4 (Version 7.0.2)`. Requirement file sha256 `0efed87200a7893388d45bad58aa389235bc0ddb2169f8293eb3d53c98cfaf13`. Graph server `ttsc-graph 0.30.4`, protocol `2025-11-25`, no generation identifier. Verified commit `58eba05b478c380c8308a6d8f802634f5c86b54a`. Its parent is `4078aa3ff3526d106c5860a461c6ca8475dc0014`.

| Command | Exit |
|---|---|
| `bun run test:conformance` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run --cwd packages/money typecheck` | 0 |
| `bun run --cwd packages/core typecheck` | 0 |
| `bun run --cwd packages/money build` | 0 |
| `bun run --cwd packages/core build` | 0 |
| `bun tools/analysis-baseline-check.ts` | 0 |
| `bun run runtime:check` | 0 |
| `bun run test` | unrun |
| `bun run build` | unrun |
| `bun run test:conformance:extended` | unrun |

`conformanceGeneratorVersion` lookup returned `packages/core/src/testkit/conformance.ts:8`. Reverse trace reached `replaysConstantIncomeAndShrinksGap` at `packages/core/src/testkit/conformance.test.ts:191`. `compareAmounts` is declared at line 36 in both testkits. Built `dist/` does not contain `testkit`. The shrink fixture's minimal value is `1`.

Shared meanings for later analysis work are in [Analysis contracts](./adr/analysis-contracts.md).
