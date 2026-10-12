# Reset cycle execution

## Committed reset transitions {#req-pr10-committed-reset}

Requirement `REQ-PR10-COMMITTED-RESET`. `PR-10` owns it.

`resetCycleExecution` in `packages/core/src/sim/analysis/resetCycle.ts` is `committed-reset-transition`. `executeResetCycles` runs each cycle with `runScenario`, then commits the reset through `applyDecisions`. That helper is the action payment path from `stepOnce`. The reset call does not tick income, evolve, or advance `t`.

A model whose prestige action adds 1 point and adds 1 to the income multiplier, run for 3 cycles of 2 seconds, commits 3 resets. The carried point count is 3 and the multiplier is 4 when the run starts from 0 points and multiplier 1. `cycles: 1` ends at count 1. That is a different state, not the same run with a different `cycles` label.

`applyDecisions` records a committed reset only from an applied reset action. `emitCommittedResets` forwards that receipt. A later `prestige.count` difference is not enough to emit `onReset`. `wallT` is the session wall clock when the model declared one, and it is null when the model did not. It is not an operating-system clock. An observer and a run without an observer end on the same economy state.

A strategy cursor and a stream RNG snapshot restored at the cycle boundary match a continuous run. The repro label is `0x7110`. The stream seed is `0x7110`. The buy choice is even draws from that stream. There is no second random source.

`pointsFrom` is the gain the prestige spec would declare. `resetState` is the next state for that gain. `multiplierFrom` maps the post-reset point total to a multiplier and is not written again when `resetState` or a prestige action already wrote the multiplier. When a prestige action exists, the spec functions are not called. The default adapter is resolved from the state at each reset boundary, so a prestige action that appears during an interval is used. A model with neither a prestige action nor a complete prestige spec at the boundary needs an explicit adapter. The result status is `unsupported`, the first interval has run, and no reset is committed. During an interval the strategy does not see the reset action, so the executor commits every reset.

`analyzePrestigeCycle` still returns its interval scan, including `stability` and `breakEvenSec`, plus a warning that those fields are not measured resets. The new artifact does not carry them. `maxCycles`, a horizon that cannot hold the next interval, and a step budget stop the run without inventing the remaining resets. A cycle that stops on the step budget does not reset.

The executed test is `runsThreeCommittedResets` in `packages/core/src/sim/analysis/resetCycle.test.ts`.

## Refused resets pay no reward {#req-pr10-refused-reset}

Requirement `REQ-PR10-REFUSED-RESET`. `PR-10` owns it.

`resetCycleSameContract` is `prestige-and-custom-reset`. A prestige action and a custom action use the same `executeResetCycles` receipt. `canApply` false, an unpaid cost, and a prestige cooldown are `resetSkippedReason` values `cannot-apply`, `insufficient-funds`, and `cooldown`. The reward stock does not change on that refusal. The runner does not apply a reset anyway. Further cycles are not started after a refusal. `cycles` of `0`, `NaN`, or `Infinity`, and an interval of `0`, throw before any cycle runs.

The executed test is `recordsRejectedResetWithoutReward` in `packages/core/src/sim/analysis/resetCycle.test.ts`.

## Reward delta excludes the opening stock {#req-pr10-reward-delta}

Requirement `REQ-PR10-REWARD-DELTA`. `PR-10` owns it.

`resetCycleRewardDelta` is `reward-delta-excludes-opening-stock`. The realized reward is the adapter metric after the committed reset minus the same metric before that reset. Opening points of 100 stay in the carried stock. They are not added into `rewardDelta` or `accumulatedReward`. A gain of 1 is `"1"`. The carried point string is `"101"`.

The executed test is `excludesOpeningRewardFromDelta` in `packages/core/src/sim/analysis/resetCycle.test.ts`.
