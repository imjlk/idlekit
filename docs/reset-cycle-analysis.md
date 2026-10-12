# Reset policy analysis

Korean version: [reset-cycle-analysis_ko.md](./reset-cycle-analysis_ko.md)

`analyzeResetPolicies` compares reset intervals on one finite horizon. Each candidate starts from the caller's `createScenario`. Completed resets stay separate from the trailing span that has not reset. `realizedReward` sums committed deltas and leaves opening stock out. `unrealizedReward` is the reset that was not committed. `rewardRate` divides the realized sum by completed cycle time. It does not divide a stock by the horizon.

## What replaces the legacy fields

`analyzePrestigeCycle` still returns the old interval scan.

| Legacy field | Old meaning | Replacement |
|---|---|---|
| `breakEvenSec` | `min(interval, horizon)` | `recovery.seconds` when the selected metric crosses its pre-reset threshold, otherwise `recovery.status: "censored"` and `seconds: null` |
| `stability: "stable"` when `cycles >= 5` | copied cycle count | `stability.status` from the requested minimum count, trailing windows, and absolute plus relative tolerance |

The new statuses are `insufficient-data`, `stable`, `drifting`, `non-stationary`, and `oscillating`. `provedSteadyState` is false. Agreement inside a window is not a mathematical steady state. Evidence that this report matches a fixture is not that proof either.

The new wire object is `ResetPolicyArtifactV1`, schema `idlekit.reset-policy.v1`. It does not copy `breakEvenSec`. Legacy output is not rewritten to hide those fields. `idk prestige-cycle` still calls `analyzePrestigeCycle`.

`best` carries the objective and its reading (`flow`, `stock`, or `time`), the scan range, `scope: "scan-range"`, `globalOptimum: false`, the session assumption, and the observation status. Ranking uses `Engine.cmp`. A tie under `toNumber` is not a tie under that compare. The winner is the best scanned candidate, not a global optimum.

A session pattern commits a manual reset only while a block is active. `resetDelaySec` is the caller's time cost. It advances wall time and grants no income. Offline gaps do not commit a reset. They apply the scenario's offline progression, cap and decay included, as `simulateSessionPattern` does, and active blocks see session clocks when the model reads them. Reaching the cycle budget or a refused reset stops further resets, not the schedule, so every candidate plays to the same horizon. A scheduled candidate measures recovery from its own first reset. A scheduled cycle lasts from the previous reset wall to this one, so the reset delay counts toward the reward rate. The unrealized reset is dry-run only when active play reaches the horizon. A reset delay is not active play. A scheduled incomplete span starts at the last committed reset. A boundary reset sees the block's session clocks, and the goal is read on each committed reset state as well as inside the runners. A reset exactly at the horizon counts when the horizon falls inside a block. Final reads happen at the horizon even when a reset delay runs past it. Scheduled boundary decisions reach `onAction` and `ctx.emit`. Goal and recovery times are seconds from the scenario origin on the wall clock, so a reset delay or a capped absence counts in full.

During playback the reset action is hidden from the strategy, so only the policy commits resets. A reset adapter is resolved at each boundary under the live constraints. `horizonSec` is elapsed time from the scenario origin. A goal time is the first committed state that meets the goal, between resets included. `goal-reach-sec` needs a goal, and `absoluteTolerance` must be a finite amount of at least 0. A winner that was refused partway leaves the artifact `incomplete`, and a winner without enough cycles for the stability windows leaves it `insufficient-data`. The stability windows must be distinct. Net worth, income, and the goal are read with the live constraints, and with session clocks on a schedule.

## Canonical example

There is no RNG. The engine is the number engine. Opening points are 100 and opening money is 50. Income is 1 coin per second. Each reset grants 1 point, leaves the multiplier at 1, and does not clear money. The scan is 10..10 step 10. The horizon is 45 seconds. The cycle budget is 8. Stability asks for 4 cycles, windows 2 and 4, absolute tolerance `0`, and relative tolerance 0. Recovery reads pre-reset income. The known rate is [reset-policy-rate.json](../fixtures/conformance/reset-policy-rate.json).

Expected result:

- 4 committed resets, realized reward `"4"`, final points `"104"`
- completed cycle time 40, reward rate `"0.1"`
- incomplete span 40..45, unrealized reward `"1"`
- final net worth `"95"`
- recovery seconds `0`, because income never drops; this is not `min(10, 45)`
- stability `stable`, `provedSteadyState` false, known solution matches
- best objective `cumulative-reset-reward`, reading `flow`, value `"4"`
- scope `scan-range`, `globalOptimum` false, session `always-active`

The same model on horizon 40 compares intervals 10 and 20. Realized rewards are `"4"` and `"2"`. Final points are `"104"` and `"102"`. The best interval is 10.

A separate income fixture starts at 25, drops to 0 on reset, and climbs by 1 per second. The crossing is 25 seconds. Horizon 20 leaves it censored.

Node.js and browser runtimes are not part of the v1 compatibility contract.
