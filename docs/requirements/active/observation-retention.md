# Observation retention

## Retention does not change observed counters {#req-pr05-observation-retention}

Requirement `REQ-PR05-OBSERVATION-RETENTION`. `PR-05` owns it.

`observationContract` in `packages/core/src/sim/observation.ts` is the production host. The value is `idlekit.run-observation`. `TC-05` has not registered that DTO.

`runScenario` and `applyOfflineSeconds` record a compact observation after each committed step. `stepOnce` does not call the observer. A planner rollout calls `stepOnce`, so that rollout is not an observation.

`stepOnce` always asks `tickMoney` for events. Those counts are `observedMoney`. The retained event list includes a money event only when collection is on and fast mode is not omitting money events. Fast and non-fast runs with observation on have the same money counters. Collecting the events does not change the wallet: `collectEvents` only fills the event array.

`observation.enabled: false` sets money and action status to `missing`, rates to null, and coverage to `disabled`. Those zeros are not measured counts. `analyzeUX` does not treat a null rate as a drop or a rare flush. `runCandidateAndScore` reports a missing `droppedRate` or action count as null in its seed results, and `pacingBalancedLog10` throws instead of scoring missing counters as zero.

`simulateSessionPattern` merges child `run.observation`. It does not sum the retained event list. A child with no observation uses the retained events and is marked `legacyEventFallback` with coverage `incomplete`. A merge that includes a legacy or missing child reports money and action status `missing`.

A reward is a positive applied or flushed amount. A zero apply is not a reward. `maxNoRewardGapSec` uses the span start and end, the first and last reward times, and the interior max. Merging two spans takes the cross-boundary gap `right.firstRewardT - left.lastRewardT` when both spans contain a reward. A reward at t=2 on [0, 10] and a reward at t=18 on [10, 20] merge to 16. That is not the max of the two piece gaps.

Milestone and goal samples have separate caps. A drop makes coverage `partial`. A cap limits the retained samples, not the observer: a dropped milestone key or met goal still reaches `onMilestone` or `onGoal` once. That includes the action-derived `action.<id>.firstApplied` and `progress.first-upgrade` keys. An unreached goal has no `t`. A reached goal stores the step end. `runScenario` also checks goals on its start state, so a goal that already holds there stores the start time, even when the run stops before any step. `goal.met` sees a clone of the committed state. Observer callbacks receive plain facts. A callback throw becomes `ObservationError`, and that run does not return a successful result. Reset transitions are not observed here. That wiring is `PR-10`.

`createEventBuffer` remains the event log. `createBoundedLog` is only the optional trace and action-row budget. `simulateSessionPattern` applies `trace.maxPoints` and `trace.maxActions` to the whole session and reports `traceLog` and `actionsLogMeta` the way a single run does. Its action rows include actions an offline policy applied during a gap, in time order with the active rows, and a row an offline gap dropped under its own budget counts in `totalSeen` and `dropped`. An unlimited trace still ends through `finishTrace`: the first state, the final state, and no duplicate final.

The executed test is `keepsStatsIndependentOfRetention` in `packages/core/src/sim/observation.test.ts`. The repro label is `0x7105`. The runs do not draw from that label.

This requirement does not change CLI `?? 0` coercion.
