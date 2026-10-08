# Planner rollout

## Planner rollout matches the committed step {#req-pr04-planner-rollout}

Requirement `REQ-PR04-PLANNER-ROLLOUT`. `PR-04` owns it.

`prestigeCooldownContract` in `packages/core/src/sim/constraints.ts` is `idlekit.prestige-cooldown`. `plannerSearchContract` in `packages/core/src/sim/strategy/planner.ts` is `idlekit.planner-search`. `TC-05` has not registered either DTO. `ExecutionPlan` and `RunCheckpoint` stay on the objects `PR-03` already introduced.

The first choice is unset, wait, or one real action. A later buy does not replace a first wait. `decide()` returns `[]` for unset and for wait. A saving fixture whose first step cannot buy, and whose second step can, returns `[]` from the first call.

A rollout calls `stepOnce` with a cloned state, that tick's `dt` (`ctx.stepSec`, or `1` when it is absent), the same payment path, `maxActionsPerStep`, and `decidePrestigeCooldown`. The preview context omits `emit`. It does not call a committed observer, `onPrestigeReset`, `executionStream`, or `previewStream`. The caller's state object stays unchanged.

`minPrestigeIntervalSec` is enforced only by `decidePrestigeCooldown`. When the interval is missing, not finite, or not positive, prestige is allowed. When `lastPrestigeResetT` is missing or not finite, the status is unanchored, prestige is allowed, and no past timestamp is invented. The warning is `PRESTIGE_COOLDOWN_UNANCHORED`. The next committed reset starts the interval. When the anchor is known, prestige is allowed at `lastPrestigeResetT + minPrestigeIntervalSec` and blocked before that. 59 seconds is blocked and 60 is allowed for a 60-second interval and an anchor at 0. A blocked action is `action.skipped` with reason `cooldown` and warning `PRESTIGE_COOLDOWN`. `prestigeReadyAtSec` is not read back into the anchor. A checkpoint that only has `prestigeReadyAtSec` stays unanchored.

The committed step records `prestigeResetT` as `state.t` before `dt` advances. `runScenario` and `applyOfflineSeconds` pass that time to `onPrestigeReset` and use it on the next tick. `createRunFactory` stores it on `runner.lastPrestigeResetT`. When the interval is known, `runner.prestigeReadyAtSec` is `lastPrestigeResetT + minPrestigeIntervalSec`. A fresh run and a legacy resume omit `runner` until a committed reset. `lastPrestigeResetT` is not a `ScenarioV1` or `SimState` field. `SimStateJSON` may persist the anchor in optional `meta.lastPrestigeResetT`; it must be finite and no later than the saved `state.t`. Simulate restores it before offline catch-up and online execution, and saves it again even when that stage makes no reset. An older save without this metadata remains unanchored. An `ExecutionPlan` may carry `maxActionsPerStep` and `minPrestigeIntervalSec`. It does not carry the anchor. Preview receives the plan seed, step, and those constraints through the run context.

Search caps are runtime clamps: `horizonSteps` 32, `beamWidth` 8, `maxBranchingActions` 8, and 256 rollouts. The report's `globallyOptimal` is false. `stopped` is `horizon` or `budget`. `clamped` records an input above a cap. Equal scores keep the lower action id, then the lower bulk size. A wait uses `~wait` and does not beat an alphabetic id on a tie. This beam search is not a global solver.

The executed test is `keepsPlannerRolloutFaithful` in `packages/core/src/sim/strategy/planner.regression.test.ts`. The repro label is `0x7104`. The runs do not draw from that label.
