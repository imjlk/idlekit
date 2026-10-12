# Reset cycle analysis

## Reward rate uses completed cycle time {#req-pr11-reward-rate}

Requirement `REQ-PR11-REWARD-RATE`. `PR-11` owns it.

`resetPolicyRewardRate` in `packages/core/src/sim/analysis/resetOptimization.ts` is `completed-cycle-time-denominator`. `analyzeResetPolicies` ranks committed reset deltas. Opening points of 100 stay in `finalPoints` and stay out of `realizedReward`. Income is 1 coin per second. Each reset grants 1 point and does not clear money. The horizon is 45 seconds and the interval is 10. Four resets realize `"4"`. Completed cycle time is 40 seconds, so the rate is `"0.1"`. The last 5 seconds are an incomplete span. The reset that was not committed is unrealized `"1"` and is not added to the objective. Opening money of 50 plus 45 seconds of income is final net worth `"95"`. That stock is not the objective.

`fixtures/conformance/reset-policy-rate.json` is the known rate. Its expected rate is `"0.1"` and its denominator is `completed-cycle-time`. A match is an empirical comparison. It is not a proof of a steady state.

The same horizon of 40 seconds compares intervals 10 and 20. Realized rewards are `"4"` and `"2"`. Final point stocks are `"104"` and `"102"`. The best interval is 10. Both candidates start from opening points 100.

`analyzePrestigeCycle` still returns `breakEvenSec`. This artifact does not carry that field. `packages/cli/src/commands/prestigeCycle.ts` still calls `analyzePrestigeCycle`.

The executed test is `matchesTheoreticalRewardRate` in `packages/core/src/sim/analysis/resetOptimization.test.ts`.

## Empirical stability is not a cycle count {#req-pr11-empirical-stability}

Requirement `REQ-PR11-EMPIRICAL-STABILITY`. `PR-11` owns it.

`resetPolicyEmpiricalStability` is `window-tolerance-not-cycle-count`. Stability uses the requested minimum cycle count, at least two trailing windows, and both an absolute and a relative tolerance. `cycles >= 5` is not a stable result. `provedSteadyState` is false. Window agreement is not a mathematical steady state. The report records the windows, tolerances, and horizon that were requested.

A multiplier that increases by 1 on every reset, for 6 cycles, is `drifting`. The reward deltas stay `"1"`. The windows are 3 and 5. Absolute tolerance is `"0"` and relative tolerance is 0. Eight cycles whose rewards alternate `"1"` and `"3"` are `oscillating`. Two constant cycles with `minObservedCycles` 5 are `insufficient-data`.

The executed test is `separatesEmpiricalStability` in `packages/core/src/sim/analysis/resetOptimization.test.ts`.

## Recovery is a crossing or censored {#req-pr11-recovery-crossing}

Requirement `REQ-PR11-RECOVERY-CROSSING`. `PR-11` owns it.

`resetPolicyRecoveryCrossing` is `threshold-crossing-or-censored`. The recovery metric is selected by the caller. This fixture uses pre-reset income. Income starts at 25. A reset sets it to 0. It climbs by 1 per second and crosses 25 at 25 seconds. Interval 10 and horizon 80 report seconds 25. That is not `min(interval, horizon)`. Interval 10 and horizon 20 do not cross. Status is `censored` and seconds is null. The result is not `min(10, 20)`.

The executed test is `reportsRecoveryCrossing` in `packages/core/src/sim/analysis/resetOptimization.test.ts`.

## Manual reset stays inside the session {#req-pr11-session-reset}

Requirement `REQ-PR11-SESSION-RESET`. `PR-11` owns it.

`resetPolicySessionReset` is `manual-reset-only-while-active`. A twice-daily pattern for one day has active wall spans `[0, 1800)` and `[43200, 45000)`. The horizon is 86400. Interval 2000 and delay 0 commit a reset at wall 43200 only. Wall 2000 is outside both blocks and is not a reset. Interval 400 and delay 500, with a cycle budget of 3, commit walls 400, 900, and 1400. Those stay inside the morning block. The delay is the caller input. It is not inferred.

The executed test is `keepsManualResetInsideSession` in `packages/core/src/sim/analysis/resetOptimization.test.ts`.

## Scan rank uses engine compare {#req-pr11-scan-rank}

Requirement `REQ-PR11-SCAN-RANK`. `PR-11` owns it.

`resetPolicyScanRank` is `engine-compare-scan-range`. A step of 0, a negative step, a non-finite horizon, and a cycle budget of 0 throw before `createScenario`. Each candidate starts from that factory. `globalOptimum` is false and `scope` is `scan-range`. The best object includes the objective, the scan range, the session assumption, and the observation status.

Break-infinity income of `1e400` per second, one reset, and horizon 20 compares intervals 10 and 20. Both realized rewards are infinite after `toNumber`. `Engine.cmp` still ranks the later interval higher. The best interval is 20.

A point goal of 1 is reached at the first reset. Interval 10 reaches at 10 seconds and beats interval 20. Horizon 15 cannot hold interval 20, so goal seconds stay null rather than 15. A model with no reset adapter is `unsupported`.

The structural schema is `typia.json.schema<ResetPolicyArtifactV1, "3.1">()` registered as `idlekit.reset-policy.v1`. Legacy output is not converted into this schema.

The executed test is `ranksScanWithoutNumberCollapse` in `packages/core/src/sim/analysis/resetOptimization.test.ts`.
