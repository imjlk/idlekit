# Simulation time boundaries

## A run stops on the economic horizon {#req-pr02-simulation-time-boundaries}

Requirement `REQ-PR02-SIMULATION-TIME-BOUNDARIES`. `PR-02` owns it.

`runScenario` in `packages/core/src/sim/simulator.ts` and `applyOfflineSeconds` in `packages/core/src/sim/offline.ts` are the production hosts. `timeBoundaryEpsilonScale` in `packages/core/src/sim/timeBoundary.ts` is the shared dust scale. Epsilon is `max(1e-12, abs(limit) * timeBoundaryEpsilonScale)`, and the limit is the economic horizon. A duration loop's last tick is `min(stepSec, time still inside that horizon)`. It does not take a full `stepSec` that would pass the horizon. `stepOnce` remains the only economy transition. This is not an analytic skip, and `fast` does not change that.

A state that already meets `durationSec` or `until` stops before `maxSteps` can fail the run. `durationSec: 0` and an `until` that is already true complete with zero steps. `maxSteps` is a safety budget. When a duration or `until` was requested and the budget is hit first, the run returns `stop.reason: "budget"` and keeps the state. When neither was requested, `runScenario` still throws `exceeded maxSteps`. That throw is the guard against an unbounded loop, not a successful horizon. Offline catch-up always has an economic horizon, so a short `maxSteps` stops with `budget` instead of discarding the partial run. `stop` is in-memory only. The CLI simulate wire schema does not gain this object.

`stepSec` and the tick `dt` must be finite and greater than 0. Program-API `durationSec` must be finite and greater than or equal to 0. `maxSteps` must be a finite integer greater than or equal to 0. Those checks happen before the loop. ScenarioV1 JSON still rejects a non-positive `clock.durationSec`. That JSON rule is not the program API. An `until` without a duration has a finite budget only when `maxSteps` is set. This requirement does not invent a hidden default budget.

Each tick copies `ctx` and sets `stepSec` to that tick's `dt`. The caller's context object is not written. A stored preview step is not the runner's clock. The trace keeps the first state and the final state, and it does not append the final state twice when that state is already the last point. Action and skip events are stamped `action-start` at the time before the tick. Money and milestone events are stamped `income-end` after income and `dt`.

Constant income may match across step sizes. A model whose buy depends on when income arrives does not have to match. A full run and a same-grid split of that run use `checkResume`. Different step sizes are not that relation. `stop` does not claim they are equal.

`packages/core/src/sim/simulator.time.test.ts` is the executed test host. It is not a production host. The repro label is `0x7102`. The test does not draw a game seed. The formula for the size-6 horizon is `6 + 4 = 10` at 1 per second. The wallet after `runScenario` is the executed result.
