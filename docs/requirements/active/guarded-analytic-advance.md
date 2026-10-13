# Guarded analytic advance

## Unclear boundaries stay on fixed-step {#req-pr16-guarded-fallback}

Requirement `REQ-PR16-GUARDED-FALLBACK`. `PR-16` owns it.

`advanceGuardedFallback` is `unclear-boundary-uses-fixed-step`. Fixed-step remains the reference runner. `run.advance` is opt-in. Omitting it does not change the fast flag. An evolve callback, a purchase action, a strategy, a reset spec, a milestone callback, a capacity soft cap, a scheduled session clock, a context `emit` callback, or a money bucket that is not exactly empty refuses the chunk and runs that step with `stepOnce`. The report contract is `idlekit.advance.v1`. `externalProvider` is false. `seedSchedule` stays `unchanged`. The structural schema is `typia.json.schema<AdvanceReportV1, "3.1">()`. `validateAdvanceReport` is `typia.createValidate<AdvanceReportV1>()`. An approximation request is not applied. Its observation claim is `degraded`. Seed `16` labels `examples/analysis/advance-constant.json`. The reported capability is read once from the start state with the context the gate uses on the first tick, scenario constraints and the step length included.

The executed test is `fallsBackOnUnclearBoundaries` in `packages/core/src/sim/advance.test.ts`.

## Constant income matches the reference {#req-pr16-exact-match}

Requirement `REQ-PR16-EXACT-MATCH`. `PR-16` owns it.

`advanceExactMatch` is `constant-income-matches-reference`. A constant income with no threshold, no purchase, and no evolve may cross several reference steps in one chunk. The final wallet, vars, goal time, money counters, and reward gap match the fixed-step run. Changing the chunk size does not change that result. The chunk stops at the goal, the horizon, or the step budget. It does not skip the goal by jumping to the duration end. Each chunk step comes from `nextBoundary` on the runner's summed clock, so the horizon epsilon and a partial last tick are the fixed-step ones. A chunk takes whole reference steps, at least one, and does not split a step at `chunkSec`. A reward is an exactly positive applied amount, as in `stepOnce`. Each chunk step is handed to the runner as it is taken, and the chunk does not hold its steps, so chunk memory does not grow with `chunkSec`. A certified step applies the income its guard read instead of reading it again, so the exact path reads `model.income` twice per reference step, once at the step's state and once at the projected state. No income is carried to the next step, which reads it after the runner's callbacks, as fixed-step does.

The conformance harness runs this relation as `checkGuardedAdvance` in `packages/core/src/testkit/conformance.ts`. It runs each case with `run.advance` omitted and enabled, online and offline, and compares the economy, every traced state, stats, the observation, and the stop. Case `0` is the fixture case. The other cases draw fractional steps, a partial or near-epsilon last tick, chunks off the step grid, goals, step budgets, both tick policies, and `fast`. `bun run test:conformance` runs eight cases and `test:conformance:extended` runs `200`.

The executed tests are `matchesReferenceWalletAndGoal` in `packages/core/src/sim/advance.test.ts` and `replaysGuardedAdvanceAcrossTheSeedCorpus` in `packages/core/src/testkit/conformance.test.ts`.

## A tick threshold is not one large delta {#req-pr16-policy-boundary}

Requirement `REQ-PR16-POLICY-BOUNDARY`. `PR-16` owns it.

`advancePolicyThreshold` is `threshold-is-not-composed`. Drop and accumulate with `maxLogGap` can disagree between many small ticks and one large delta. Those runs stay on fixed-step. The fallback reason names the threshold. Wallet and counters still match the reference.

The executed test is `refusesPolicyThresholds` in `packages/core/src/sim/advance.test.ts`.

## A seeded model stays on fixed-step {#req-pr16-stochastic}

Requirement `REQ-PR16-STOCHASTIC`. `PR-16` owns it.

`advanceStochasticSeed` is `seed-without-capability-stays-fixed`. A context seed does not take an analytic chunk. `exactSteps` stays 0. The seed schedule is not rewritten. `advanceResult("statically-known")` without a run is `insufficient-data`. `advanceResult("unsupported")` is `unsupported` and does not say stable.

The executed test is `keepsSeededModelsOnFixedStep` in `packages/core/src/sim/advance.test.ts`.

## Fast omission keeps observation facts {#req-pr16-observation-facts}

Requirement `REQ-PR16-OBSERVATION-FACTS`. `PR-16` owns it.

`advanceFactsKept` is `fast-events-keep-observation-facts`. `fast.disableMoneyEvents` still counts applied money facts. An exact chunk records those facts for each reference step. A missing money event is not stored as a measured zero. The money status stays `observed`.

The executed test is `keepsFactsWhenEventsAreOmitted` in `packages/core/src/sim/advance.test.ts`.

## Long horizons are measured {#req-pr16-measured-bench}

Requirement `REQ-PR16-MEASURED-BENCH`. `PR-16` owns it.

`advanceMeasuredBench` is `no-unmeasured-speedup`. The bench runs a 30 day horizon and a 90 day horizon at a one hour reference step. It records fixed-step duration, exact-chunk duration, and process rss. It does not state a speedup multiple. The wallets match.

The executed test is `measuresLongHorizons` in `packages/core/src/sim/advance.test.ts`.
