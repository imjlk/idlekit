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

Import the three LTV functions and the `MonetizationConfig` / `LtvPointEstimate` types from
`@idlekit/core`. Pass a `ScenarioV1` to `deriveMonetizationConfig`; pass the returned config,
`horizonDays` and `progression` to `estimateLtvPerUser`. `estimateLtvDistribution` additionally
takes `draws`, `quantiles` and `seed`. The CLI uses the same implementation.

Inputs are hypothetical assumptions, in one caller-chosen currency per installed user.
Defaults are not observed retention or measured revenue. Net revenue applies platform fees
and gross margin; LTV then subtracts CPI, including at a zero-day horizon. Fractional days
are prorated. Finite progression is clamped to 0..1. Quantile bands describe sensitivity to
assumptions, not fitted confidence intervals or evidence of enjoyment/retention.

Synchronous limits: 0..36500 days, 1..100000 draws and at most 10000000 draw-days (at least
one work unit per draw). Quantiles must be nonempty values in 0..1 with distinct rounded
percent keys (`q50`, `q90`). Invalid inputs, colliding keys and numeric overflow throw
`RangeError`. Sampling shrinks inconsistent correlation matrices toward independence.
Calibration of a complete observed cohort remains available through the public `idk calibrate` CLI.

Partial scenario retention overrides keep the CLI's independent defaults. For example,
`d1: 0.1` alone retains the default `d7: 0.2`; estimates preserve that existing interpolation.
Explicit complete scenario curves still follow scenario ordering validation. Direct estimate
configs validate each rate's range without adding an ordering constraint to completed defaults.
Sampling retains its existing clamp of later retention anchors to the preceding anchor,
so this partial-input case can differ from the point projection even with zero uncertainty.

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
