# Guarded analytic advance

Korean version: [guarded-analytic-advance_ko.md](./guarded-analytic-advance_ko.md)

`PR-16` adds an opt-in advance for an interval whose income integral matches fixed-step. Fixed-step stays the reference runner. Omitting `run.advance` leaves the existing fast flag unchanged. That flag can still omit money events. It is not this analytic skip.

The first exact interval is constant income with no evolve, purchase, strategy, reset, milestone, soft cap, scheduled session, seed, tick threshold, context `emit` callback, or non-empty money bucket. A chunk stops at the goal, the horizon, the step budget, or the next refused boundary. Its steps come from the same `nextBoundary` as fixed-step, on the summed clock, and it takes whole reference steps, at least one per chunk. It does not jump to the duration end and check the goal only there. Each step reaches the runner as it is taken, so a long chunk does not buffer its steps, and a certified step reuses the income the guard read. The reported capability uses the same context as the gate, scenario constraints included. An approximation request is not applied. That report is `fallback`, its observation claim is `degraded`, and the run itself stays on fixed-step.

Drop and accumulate with `maxLogGap` stay on fixed-step. A sum of small ticks is not treated as one large delta. A context seed does not take an analytic chunk, and the seed schedule is not rewritten. `advanceResult("statically-known")` without a run is `insufficient-data` with reason `advance observations were not supplied`. `advanceResult("unsupported")` is `unsupported`.

An exact chunk records one observation sample per reference step. Goal time, reward gap, and money counters follow that sample. The event log on that chunk is not a per-tick transcript. A missing money event is not stored as a measured zero. `fast.disableMoneyEvents` still omits retained money events and keeps the applied counter. `seedSchedule` stays `unchanged`. `externalProvider` is false. There is no second numeric engine. The conformance relation `checkGuardedAdvance` compares advanced and fixed-step runs across the seed corpus.

Seed `16` labels `examples/analysis/advance-constant.json`. One local run of that bench, with advance omitted as the reference and one exact chunk for the same horizon, recorded:

| Horizon | Step | Fixed-step ms | Exact-chunk ms | rss bytes | Wallet | Exact steps |
|---|---|---|---|---|---|---|
| 30d (`2592000` s) | `3600` | `6.954000000000178` | `3.5305419999999685` | `398163968` | `5184000` | `720` |
| 90d (`7776000` s) | `3600` | `7.608375000000251` | `2.2211669999996957` | `398409728` | `15552000` | `2160` |

Both wallets matched. Those durations and rss values are the record. This document does not state a speedup multiple. `tools/bench-sim.ts` remains the fixed-step CLI corpus and is separate from compiler prepare.

The structural contract is `idlekit.advance.v1` at [docs/schemas/advance.v1.schema.json](./schemas/advance.v1.schema.json). The generator also writes [docs/schemas/generated/advance.v1.schema.json](./schemas/generated/advance.v1.schema.json). This does not replace `ScenarioV1` or the money metrics.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `07ad46ecf38a81f753b48c5bd9354ead767de6e346d89fb5ecfe0bd8917aaf51`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, and `docs:verify` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 120000 src/sim/advance.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 120000 src/sim/simulator.time.test.ts src/sim/offline.test.ts src/sim/observation.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 180000 src/scenario/scenarioContract.test.ts` (from `packages/core`) | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun run public:check` | 0 |

The first two `evidence:check` runs exited 2 on placeholder reviews. The next run exited 1 because the generated scenario schema was still stale. The rerun after `contracts:generate` exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0.

## Graph

Queried with `ttsc-graph` 0.30.4 on `tsconfig.graph.json`, protocol `2025-11-25`, no generation identifier, shutdown 0. `consumeExactChunk` is declared at `packages/core/src/sim/advance.ts:289`. `refusalForAdvance` is declared at `packages/core/src/sim/advance.ts:186`. `finishAdvanceReport` is declared at `packages/core/src/sim/advance.ts:135`. `applyExactIncome` is declared at `packages/core/src/sim/advance.ts:245`. An impact trace of `consumeExactChunk` names `runScenario` at `packages/core/src/sim/simulator.ts:31` (call at line 110), `applyOfflineSeconds` at `packages/core/src/sim/offline.ts:90` (call at line 186), `matchesReferenceWalletAndGoal`, and the callers of the two runners. `refusalForAdvance` and `consumeExactChunk` share the guard `certifyAdvance`, which `consumeExactChunk` calls at `advance.ts:337`. The trace is not every caller. The JSON fixture is outside the graph.
