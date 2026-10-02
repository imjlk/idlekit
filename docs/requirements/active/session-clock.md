# Session clocks

## Wall time, reward time, and active time stay distinct {#req-pr06-session-clock}

Requirement `REQ-PR06-SESSION-CLOCK`. `PR-06` owns it.

`sessionClockContract` in `packages/core/src/sim/session.ts` is `idlekit.session-clock`. `TC-05` has not registered that DTO.

`SimState.t` stays the reward clock. A direct `applyOfflineSeconds` call still advances it by the simulated reward seconds, not by the requested absence. `offline.requestedSec` is the caller's seconds. `offline.effectiveSec` is the reward after cap and decay. `offline.simulatedSec` is how much of that reward was stepped. A caller that omits `options.until` does not read `scenario.run.until`. That is the legacy direct contract.

`simulateSessionPattern` schedules blocks on wall time. The origin is the starting `state.t`. A capped or decayed gap does not move the next active block earlier. A 12 hour absence with `maxSec` 3600 credits 3600 reward seconds and reports 43200 elapsed seconds on that gap. A completed one-day pattern reports `summary.elapsedSec` and `summary.horizonSec` of 86400. Those two are not `state.t`.

`summary.activeSec` is time inside active blocks. `summary.offlineElapsedSec` is wall time away. `summary.offlineCreditedSec` is reward time stepped while away. `summary.lostRewardSec` is wall absence minus `effectiveSec`, the reward removed by cap or decay. It is not a step-budget shortfall. `summary.totalActiveSec` remains the active total. `summary.totalOfflineSec` remains the stepped offline reward total. It is not the wall absence when a cap or decay applies. `summary.rewardSec` is `end.t - start.t`.

The five presets are unchanged. `schedule` is an opt-in list of `{ day, startOffsetSec, durationSec }` inside the horizon. Offsets are seconds, not a calendar. An empty list, a negative offset or duration, a non-positive duration, a block past the horizon, or an overlap throws. `ScenarioV1` keeps the five preset ids. The offset list is not a scenario JSON field.

The default offline action policy is `legacy-all`. It calls the strategy, which is the previous session behavior of `useStrategy: true`. `none` does not call `decide`, so a scripted cursor stays put and buy, prestige, and scripted actions are not consumed while away. `allow` calls `decide` and keeps only listed action kinds. Optional `actors` keeps `player` or `automation`. A missing actor does not match an actor filter. When `allow` rejects every decision of a step, the strategy is restored from `snapshotState` when it has one. An empty `decide` is not a rejection and keeps its own state, so a skipped scripted step still advances. A mixed batch applies its listed decisions and does not restore, because a restore would replay them. The rejected decisions of that batch are consumed. `useStrategy: false` still forces `none`.

Segments of one `simulateSessionPattern` call are one continued play. A second call starts fresh only when the caller supplies a new strategy instance. This function does not build that instance. `simulateMonteCarlo` already binds a fresh trial before it calls this function.

An `until` or a met goal stops the session. Later blocks do not run. `summary.stop.reason` is `until`, `goal`, `budget`, or `horizon`. Cap and decay do not stop the schedule. They only add `lostRewardSec`. A step budget stops the session and leaves `lostRewardSec` unchanged.

A model may set `clocks.respondsTo` to `wall`, `reward`, or `active`. The session then passes `ctx.clocks` for that segment. It does not write wall time into `state.t`. A model that omits the declaration does not receive `ctx.clocks`.

`offline-heavy` for one day with `maxSec` 3600 and no decay is 300 active seconds, 86100 seconds away, 3600 credited, and 82500 lost. `state.t` ends at 3900. The elapsed horizon stays 86400. The same preset with linear decay and `floorRatio` 0.25 credits 900 and loses 85200.

The executed test is `keepsSessionClocksDistinct` in `packages/core/src/sim/session.test.ts`. The repro label is `0x7106`. The runs do not draw from that label. Clock totals do not read the retained event log. A truncated log leaves `summary.elapsedSec`, `summary.offlineCreditedSec`, `summary.activeSec`, and `summary.lostRewardSec` unchanged.
