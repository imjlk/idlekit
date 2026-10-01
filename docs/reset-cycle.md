# Reset cycle execution

Korean version: [reset-cycle_ko.md](./reset-cycle_ko.md)

`executeResetCycles` runs a fixed interval, or an explicit list of durations, and commits one reset after each completed cycle. The reset goes through `applyDecisions`, the same payment path as `stepOnce`. It does not grant a tick of income. The adapter builds its action for the current state, so `applyDecisions` is called with `resolveAgainstModel: false` and does not drop a spec or custom action that `model.actions` does not list. `stepOnce` keeps re-reading `model.actions`.

The default adapter uses a prestige action when the model has one. `pointsFrom`, `resetState`, and `multiplierFrom` are not applied again on that path. When no prestige action exists, a complete `Model.prestige` spec is the adapter: `pointsFrom` is the gain, `resetState` writes the next state, and `multiplierFrom` is only compared. A model with neither needs an explicit adapter. The status is then `unsupported` and the state is unchanged.

Each cycle records absolute `startSec` and `endSec`, cycle-local `durationSec`, `resetAtSec`, `rewardDelta`, and `accumulatedReward`. The delta is the reward gained by that reset. Stock already held is not counted again. A failed condition, cost, or cooldown is `resetSkippedReason` and pays nothing. `cycles` of `0`, `NaN`, or `Infinity`, and an interval of `0`, are rejected. A horizon, `maxCycles`, or step budget stops the run instead of inventing resets.

`analyzePrestigeCycle` remains the legacy interval scan. Its `stability`, `breakEvenSec`, and copied `cycles` values are not evidence of a committed reset. The warnings on that return say so. This artifact does not include those fields. Comparing reset policies and declaring a steady state belong to a later change.

Node.js and browser runtimes are not part of the v1 compatibility contract.
