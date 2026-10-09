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
    growthSlopePerHourLog10: growth.slopePerHourLog10,
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
