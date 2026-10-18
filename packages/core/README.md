# @idlekit/core

Simulation and analysis primitives for idle game economy design.
It compiles scenarios, executes runs, and evaluates long-horizon KPIs and design-facing metrics.
Official support in v1: Bun `>=1.4.2` only. Node.js and browser runtimes are not part of the v1 compatibility contract.

```bash
bun add @idlekit/core
```

Requires Bun `>=1.4.2`.

Use this package when you need:

- scenario validation / compilation
- simulation loop and `stepOnce`
- built-in strategies and tuning primitives
- growth, milestone, session-pattern, and Monte Carlo analysis
- hypothetical LTV estimates via `deriveMonetizationConfig`, `estimateLtvPerUser` and `estimateLtvDistribution`

## LTV estimates

Import the three LTV functions, the `retentionAtDay` / `progressionFactor` helpers and the
`MonetizationConfig`, `LtvEstimateArgs`, `LtvDistributionArgs`, `LtvPointEstimate` and
`LtvDistribution` types from `@idlekit/core`. Pass a `ScenarioV1` to `deriveMonetizationConfig`;
pass the returned config, `horizonDays` and `progression` to `estimateLtvPerUser`.
`estimateLtvDistribution` also reads `draws`, `quantiles` and `seed`; an omitted one falls back
to `config.uncertainty`, and an explicit one wins. It always samples: `config.uncertainty.enabled`
is the caller's switch for whether to call it, as in the CLI. The CLI uses the same implementation.

LTV is undiscounted cumulative value. A horizon of `H` days covers install days `[0, H)`: day 0
is the install day, active by definition, as in telemetry and `idk calibrate`. A fractional last
day is prorated at that day's retention, so 0.5 days is half of the install day. Earlier releases
covered days `[1, H]`, dropped install-day revenue and charged a 0.5-day horizon at D1
retention. The same horizon now adds the install day and drops day `H`, so LTV values change
and usually rise.

Inputs are hypothetical assumptions, in one caller-chosen currency per installed user.
Defaults are not observed retention or measured revenue. Net revenue applies platform fees
and gross margin; LTV then subtracts CPI, including at a zero-day horizon. Finite progression
is clamped to 0..1. Quantile bands describe sensitivity to assumptions, not fitted confidence
intervals or evidence of enjoyment/retention.

Synchronous limits: 0..36500 days, 1..100000 draws and at most 10000000 draw-days (at least
one work unit per draw). Quantiles must be 1..101 distinct values in 0..1. Each output key is
the exact percent (`q50`, `q90`, `q2.5` for 0.025, `q12.4` for 0.124), so keys never collide or
round. The seed must be an integer in 0..4294967295; other seeds throw instead of being folded.
`retentionAtDay` requires a finite day >= 0 and a valid curve; `progressionFactor` rejects NaN
logs and a span that is not finite and positive, and treats an infinite worth log (zero worth)
as no progression. Invalid inputs and numeric overflow throw `RangeError`. Sampling shrinks
inconsistent correlation matrices toward independence.
Complete-cohort retention observation and safe patch application are available in core;
the public `idk calibrate` CLI shares the observation and planning implementation.
Public estimate configs accept quantile endpoints too. The point estimate validates the whole
config, including the uncertainty defaults the distribution reads; key distinctness and the
seed range are checked when the distribution uses them. `ScenarioV1` authored quantiles retain
their existing `(0, 1)` schema when passed to `deriveMonetizationConfig`.

Partial scenario retention overrides keep the CLI's independent defaults. For example,
`d1: 0.1` alone retains the default `d7: 0.2`; estimates preserve that existing interpolation.
Explicit complete scenario curves still follow scenario ordering validation. Direct estimate
configs validate each rate's range without adding an ordering constraint to completed defaults.
The point projection and the distribution interpolate such a rising curve the same way: one
shared retention shock scales every anchor, and sampling no longer clips a later anchor to the
preceding one, so a zero-uncertainty distribution equals the point projection.

## Observed cohort retention

Import `observeCohort`, `compareRetention`, `planRetentionPatch` and `applyRetentionPatch`
from `@idlekit/core`. `CohortActivityRow` requires `userId` and integer `day`; `active`
defaults to true. Money fields are optional and are never fitted by these retention APIs.
Every installed user needs a day-zero row, including nonreturners, and the caller must
provide a complete activity export with a common, fully mature `observedThroughDay`.
The API checks consistency; it cannot prove export completeness.

`observeCohort(rows, cutoff)` preserves future rates/intervals as null. `planRetentionPatch`
returns `ready`, `unavailable` or `requires-review`; every unobserved target day requires
an explicit retained assumption. Observations that rise or conflict with retained values
remain unchanged and cannot become an automatic patch. `applyRetentionPatch({ scenario,
observation })` recomputes the plan, validates and returns an independent scenario copy.
It throws if the patch is not ready and never replaces revenue, fees, CPI, uncertainty,
cohort size or unobserved retention. `assertCohortObservation` validates serialized input.

See [the complete SDK example](https://github.com/imjlk/idlekit/blob/main/examples/telemetry/cohort-sdk.ts)
and [the cohort export guide](https://github.com/imjlk/idlekit/blob/main/docs/player-telemetry.md).

## Game-specific offline settlement

`simulateSessionPattern({ scenario, pattern, prepareOffline })` optionally calls a synchronous
`SessionOfflinePreparer` once per nonempty absence. It receives `ctx`, `model`, a state snapshot,
`seconds`, `wallStartT`, `wallEndT` and the current policy snapshot. Numeric prototypes are
preserved in the snapshots; treat the shared engine, context and model as immutable.
Use the explicit wall timestamps for expiry checks after earlier capped gaps.

Return any of `model`, `stepSec` and `policy`. They apply only to this gap; omission inherits
the scenario setting. `policy` replaces cap/decay, so `{}` removes both. The session's action
policy stays in `scenario.run.offline.actions`; a callback cannot override it. A replacement
model declares its own `clocks.respondsTo` needs. The SDK still performs reward ticks, goals,
until checks, action filtering, observations and wall/reward accounting.

A game with one atomic settlement can compute it on the snapshot and return a model that
imports its result in one reward tick, with `stepSec` equal to its effective credited seconds
(use a positive step when credit is zero). Stops are checked at tick boundaries; a one-tick
settlement does not expose intermediate game states. Preparation itself must not grant an
external reward: zero credit or an already-reached goal may execute no transition at all.
For partial settlement or intra-gap goals, supply a model that evolves per smaller tick.

This is an SDK callback, not a JSON scenario field. The default session path is unchanged.
See [the big-number offline example](https://github.com/imjlk/idlekit/blob/main/examples/session/offline-preparation.ts).

## Quick example

<!-- snippet: snippets/readme/core-quick-example.ts -->
```ts
import {
  analyzeGrowth,
  compileScenario,
  createModelRegistry,
  createNumberEngine,
  defineModelFactory,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";

type Vars = { owned: number };

const linearFactory = defineModelFactory<number, "COIN", Vars>({
  id: "linear",
  version: 1,
  create() {
    return {
      id: "linear",
      version: 1,
      income(ctx, state) {
        return {
          unit: ctx.unit,
          amount: ctx.E.add(1, Number(state.vars.owned ?? 0)),
        };
      },
      actions() {
        return [];
      },
    };
  },
});

const registry = createModelRegistry([linearFactory]);

const scenario = {
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "linear", version: 1 },
  initial: {
    wallet: { unit: "COIN", amount: "0" },
    vars: { owned: 0 },
  },
  clock: { stepSec: 1, durationSec: 60 },
};

const validated = validateScenarioV1(scenario, registry);
if (!validated.ok || !validated.scenario) {
  throw new Error(`scenario should validate: ${JSON.stringify(validated.issues)}`);
}

const E = createNumberEngine();
const compiled = compileScenario({
  E,
  scenario: validated.scenario,
  registry,
});
const run = runScenario(compiled);
const growth = analyzeGrowth({ run, series: "money", windowSec: 10 });

console.log(
  JSON.stringify({
    endMoney: E.toString(run.end.wallet.money.amount),
    growthSegments: growth.segments,
  }),
);
```

## Runtime

For the duration of an in-memory `runScenario` or `applyOfflineSeconds` result, import `runElapsedSec` from `@idlekit/core` and read `runElapsedSec(run)`. It uses `run.stop.elapsedSec`, the sum of tick seconds. `state.t` is the absolute reward timestamp; at a large starting timestamp, `run.end.t - run.start.t` can round differently. For example, ten 0.1-second ticks starting at `1e15` simulate about one second while the timestamps differ by 1.25 seconds. Results without a stop record fall back to that timestamp difference. A step-budget stop can shorten an individual run before the requested duration; check `run.stop?.reason` or use `assertHorizonReached(run, label)` when the full horizon is required.

For `simulateSessionPattern`, read `summary.elapsedSec` for wall time, `summary.activeSec` for active tick seconds, and `summary.offlineCreditedSec` for offline reward tick seconds. The aggregate `session.run` has no per-run stop record, so `runElapsedSec(session.run)` uses the timestamp fallback. `summary.rewardSec` is also a reward timestamp difference; use the active and offline credited totals when you need simulated tick seconds.

`@idlekit/core` is maintained as a Bun-first ESM package.

## Documentation

- Repository: [github.com/imjlk/idlekit](https://github.com/imjlk/idlekit)
- Product roadmap: [docs/roadmap.md](https://github.com/imjlk/idlekit/blob/main/docs/roadmap.md)
- Scenario guide: [docs/scenario-and-tuning.md](https://github.com/imjlk/idlekit/blob/main/docs/scenario-and-tuning.md)
- Canonical worked example: [examples/tutorials/14-orbital-foundry-v1.json](https://github.com/imjlk/idlekit/blob/main/examples/tutorials/14-orbital-foundry-v1.json)
- Adapter pattern example: [examples/adapter-pattern](https://github.com/imjlk/idlekit/tree/main/examples/adapter-pattern)
