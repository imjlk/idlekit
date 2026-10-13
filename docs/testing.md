# Testing Guide

Korean version: [testing_ko.md](./testing_ko.md)

Official support in v1: Bun `>=1.4.2` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

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
bun run bench:planner -- --runtime-ms 100,200 --workload 30
bun run bench:monte-carlo -- --runtime-ms 100,200 --draws 1000 --workload 30
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
bun tools/analysis-baseline-check.ts
```

## Performance budgets

`bench:sim:check` scores the short representative scenario with trace off. The mean and p95 are runtime samples. Compiler prepare is a separate phase and is not steps/sec. A gate failure needs enough repeats, a relative slowdown, and an absolute median floor. A failure does not rewrite the baseline. The long corpus is `bench:sim:suite:check` on the scheduled workflow `.github/workflows/performance-corpus.yml`. `kpi:report` and `kpi:regress` stay the economic gate. See [Performance budgets](./performance-budget.md).

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

## Review report smoke

`bun run review:smoke` is a maintainer-only check for the human review path.

- it uses the Gunshi generator to verify the live help for `review doctor`, `review evaluate`, and `review compare`
- CLI tests verify Markdown defaults and JSON output contracts without a TTY

## Compatibility fixtures

Compatibility fixtures live under `fixtures/compat/v1/`.

- add new fixtures for additive contract growth
- do not rewrite existing fixtures unless you are intentionally revisiting compatibility policy
- run `bun run compat:check` after adding or updating fixtures

## Analysis baseline

At `265c6ed` the repository compiler was `tsc`, tests ran with `bun test`, and the CLI bundle was Bunli. Root Bun was `1.3.10` and CI pinned Bun `1.3.9`. `TC-01` moves CI to Bun `1.3.10` and pins ttsc. `TC-02` runs package check and money/core emit through `ttsc`, with the same transform on Bun source, `bun test`, the CLI bundle, and the packed artifact. The live pins are in [Toolchain pins](./toolchain.md).

`bun tools/analysis-baseline-check.ts` checks the paths cited by the [source audit](./implementation/source-audit.md) and the current host pins.

`evidence:check`, `evidence:smoke`, and `format:check` are repository commands after `TC-03`. `graph:check` is the `TC-04` command. `test:conformance` is the `DX-01` command. `contracts:generate` and `contracts:check` are the `TC-05` commands. Check compares a fresh generation with `docs/schemas/generated/` and does not write it. `toolchain:doctor` and `toolchain:prepare` are the `TC-01` host commands.

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

Formula seconds are labeled `formula`. `etaSimulate` and `etaAnalytic` stay `executed`. `PR-01` uses `checkBulk` for a flat price that declares equivalence and leaves a mid-buy bonus undeclared. `PR-02` uses `checkResume` for one same-grid split and does not require a different step size to match unless the fixture is constant income. `PR-03` uses `checkTrialOrder`, `checkReplay`, `checkJsonRoundTrip`, and `checkSnapshots` so a fresh trial does not depend on draw order. `PR-05` uses `checkRetention` to compare `stats` as well as the economy snapshot, so a truncated event log does not change those counters. `PR-04` uses `keepsPlannerRolloutFaithful` so a first wait stays a wait, a rollout does not emit on the live context, and a 60-second prestige cooldown matches across a committed step, a preview, and a resumed checkpoint. `PR-06` uses `keepsSessionClocksDistinct` so a 12-hour absence with a 1-hour cap stays elapsed 12 hours and credited 1 hour, and a completed day stays on a 24-hour wall horizon. `PR-07` uses `keepsResolvedRunConfiguration` so one plan opens a fresh simulate stage and a fresh experience stage, a planner preview sees the step override, `breakInfinity` keeps `1e400` finite, and the semantic digest ignores the directory. The repro label is `0x7107`. The runs use seed `1`. `TC-05` uses `keepsTypedContractSingleSource`, `keepsSemanticValidation`, and `runsPublishedScenarioValidator`. The corpus is a literal scenario. It does not draw a seed. `0`, `-1`, and `NaN` steps fail `validateScenarioV1` only. Unknown keys stay allowed at runtime. `PR-14` uses `checkConstantIncomeExperiment` so a constant-income experiment reaches target `T` at `T/p` and keeps reach-time elasticity `-p/p'` for divisor rates. That relation runs typia validators, so both conformance scripts preload `@ttsc/unplugin/bun-register`. `bun run test:conformance` uses eight property cases. `CONFORMANCE_CASES=200` via `test:conformance:extended` is the scheduled corpus (`.github/workflows/conformance-extended.yml`). `bun run test:conformance:negative` copies fixtures under `tmp/` and expects a missing typia transform, a deleted evidence citation, and an empty graph lookup to miss. It is not part of `test:conformance`.

Graph does not see the JSON fixture, the workflow file, or the package script string. Those are unobserved dynamic edges. Query `runScenario`, `conformanceGeneratorVersion`, and `compareAmounts` in source before editing the helpers.

### DX-01 verification

Host: macOS arm64, Bun `1.3.10`, `ttsc 0.30.4 (Version 7.0.2)`. Requirement file sha256 `0efed87200a7893388d45bad58aa389235bc0ddb2169f8293eb3d53c98cfaf13`. Graph server `ttsc-graph 0.30.4`, protocol `2025-11-25`, no generation identifier. Verified commit `87ae394de944c86b2c59c62c257414ea3f814e5e`. Its parent is `51dfd43bccfc7d29d18c5b51cb463d66c34d0c51`.

| Command | Exit |
|---|---|
| `bun run test:conformance` (that commit also ran the negative runner) | 1 |
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

The conformance unit tests and the shrink replay exited 0. That commit's `test:conformance` also ran the negative runner, and its `transform-present` step hit `TtscUnstableGenerationError`, so the script exited 1. The short gate is now the unit tests plus the shrink replay. `bun run test:conformance:negative` stays out of that gate until `transform-present` is stable.

`conformanceGeneratorVersion` lookup on project `tsconfig.graph.json` returned `packages/core/src/testkit/conformance.ts:10`. Reverse trace reached `replaysConstantIncomeAndShrinksGap` at `packages/core/src/testkit/conformance.test.ts:191`. `compareAmounts` is declared at line 36 in both testkits. Built `dist/` does not contain `testkit`. The shrink fixture's minimal value is `1`.

Shared meanings for later analysis work are in [Analysis contracts](./adr/analysis-contracts.md).

## Integration matrix

`examples/analysis/integration-matrix.json` is the PR-20 hand fixture. Seed label is `19`. `packages/core/src/sim/integrationMatrix.ts` computes constant-income, session-budget, quoted-bulk, and reset-carry answers without calling the simulator. The off-grid horizon is the declared `checkPartialFinalTick` relation in `packages/core/src/testkit/conformance.ts`, which the seed corpus also runs. `packages/core/src/sim/integrationMatrix.test.ts` runs Number and breakInfinity, a stateful scripted cursor, event log off/capped/full, recorded offline policy against the same fixed-step total, an unreached goal, and the unsupported `breakEternity` placeholder. Flow diagnosis, guarded analytic advance, the Jev judge, and the explicit worker pool are included optional capabilities. They are not the default command path. They are optional at run time, not optional in the release check: `tools/publish-gate.ts` runs the repository-wide `typecheck`, `test`, and `build`, which include their sources and tests, so a failure in any of them blocks publication. `createBreakEternityEngine` stays an unimplemented placeholder. Orbital Foundry and the tutorials stay the worked examples. CI `bun run test` already includes this file. The quality job also runs toolchain smoke, typecheck, contracts, doctor completions, runtime, conformance, build, release dry-run, `bench:sim:check`, `docs:verify:quick`, templates, install smoke, readme smoke, compat, public, replay, `kpi:report`, and `kpi:regress`. `bench:sim:suite:check`, `tune:regress`, `review:smoke`, and full `docs:verify` stay outside that push job. `bench:sim:suite:check` stays on `.github/workflows/performance-corpus.yml`. A fast wrong total is not a pass: `bench:sim` compares every run's `endMoney` with [examples/bench/end-money.json](../examples/bench/end-money.json), and under `--assert` a mismatch or an unrecorded scenario fails. This change does not publish to npm.

Host for this run: macOS arm64, Bun `1.4.2` (`744846f84`), `packageManager` `bun@1.4.2`, ttsc `0.30.4`. With the worker entry in the JS bundle, the bundle root is `src`, so the CLI bundle stays at `dist/main.js` and the worker is `dist/runtime/workers/entry.js`. `bench:sim:check` times `packages/cli/dist/main.js` from the repo root so the sample is the shipped simulate, not the CLI ttsc preload. `bench:sim:suite:check`, `tune:regress`, `review:smoke`, `install:smoke`, and `readme:smoke` were not rerun for this re-land. This change does not publish to npm.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test src/sim/integrationMatrix.test.ts` (from `packages/core`) | 0 |
| `bun run typecheck` | 0 |
| `bun run test` | 0 |
| `bun run test:conformance` | 0 |
| `bun run contracts:check` | 0 |
| `bun run build` | 0 |
| `bun run runtime:check` | 0 |
| `bun run compat:check` | 0 |
| `bun run replay:verify` | 0 |
| `bun run docs:verify:quick` | 0 |
| `bun run docs:verify` | 0 |
| `bun run templates:check` | 0 |
| `bun run public:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run --cwd packages/cli generate:check` | 0 |
| `bun run --cwd packages/cli doctor:completions` | 0 |
| `bun run bench:sim:check` | 0 |
| `bun run kpi:report` | 0 |
| `bun run kpi:regress` | 0 |
| `bun run toolchain:smoke` | 0 |
