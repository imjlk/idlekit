# Source audit at 265c6ed

Korean version: [source-audit_ko.md](./source-audit_ko.md)

Policy: [analysis contracts](../adr/analysis-contracts.md).

Baseline commit: `265c6ed1dad56e474a9b8acd847be42aaa3faa51` (`main`, 2026-09-30). The commit date recorded by git is 2026-04-12. This file separates what this session read in source from risks that still need a runtime fixture. It does not record a `bun test` result. Planned files and commands below are absent on purpose.

`bun tools/analysis-baseline-check.ts` checks that the cited paths exist. The table below is the `PR-00` snapshot at `265c6ed`. Live pins after `TC-01` are in [Toolchain pins](../toolchain.md). `TC-01` updates the host pins in the check when it unifies them. `TC-02` switches package check and money/core emit to `ttsc`; the snapshot table stays at `265c6ed`.

## What already exists

Export or command presence is not a finished analysis.

| Surface | Where | What it is today |
|---|---|---|
| ETA | `packages/core/src/sim/analysis/eta.ts`, `idk eta` | Exported estimate. Analytic mode narrows both the gap and the income with `Engine.toNumber`. |
| Prestige cycle | `packages/core/src/sim/analysis/prestigeCycle.ts`, `idk prestige-cycle` | One scenario run per interval. `cycles` is copied from the request. `stability` is `cycles >= 5`. |
| Growth | `packages/core/src/sim/analysis/growth.ts`, `idk growth` | Log-slope buckets named `stall`, `softcap`, `exp`, `super-exp`. |
| Session | `packages/core/src/sim/session.ts`, `idk experience` | Preset blocks, offline gaps, seeded session runs. |
| Monte Carlo | `packages/core/src/sim/monteCarlo.ts` | Seeded draws. Each draw clones `initial` and shares `model` and `strategy`. |
| Tuner | `packages/core/src/sim/strategy/opt/tuneSpec.ts`, `idk tune` | Strategy `baseParams` and `space`. |
| Evaluate | `packages/cli/src/commands/evaluate.ts` | In-process validate, simulate, experience, and ltv. |
| Review | `packages/cli/src/commands/groups/review.ts` and the `review*.ts` commands | Existing doctor, evaluate, and compare flows. |
| KPI / replay | `idk kpi`, `packages/cli/src/commands/kpiRegress.ts`, `idk replay` | Existing regression and replay gates. |
| Doctor | `packages/cli/src/commands/doctor.ts` | Environment and setup diagnosis. Economic judgment is a later judge, not this command. |
| Large numbers | `createBreakInfinityEngine` | Real adapter. `createBreakEternityEngine` throws from every method. |

CLI registration in `packages/cli/src/main.ts` includes `validate`, `simulate`, `eta`, `prestige-cycle`, `growth`, `experience`, `evaluate`, `tune`, `compare`, `ltv`, `report`, `calibrate`, `doctor`, `setup`, and the `models`, `strategies`, `objectives`, `init`, `replay`, `kpi`, and `review` groups.

Also present and meant to be reused: `stepOnce`, `Engine` `divN` / `cmp` / `absLog10`, strategy snapshot/restore, `deepClonePreservingPrototype`, `eventBuffer`, `OUTPUT_CONTRACT_VERSION`, and the Sampo, compat, replay, and KPI gates.

`packages/core/src/sim/simulator.ts` still applies a full `stepSec` on each loop iteration when `fast` is set. A fast flag in that function is not an analytic time skip.

## Source facts read in this session

These are control-flow facts. No fixture in this change executed them.

1. **Prestige cycle is an interval scan.** `analyzePrestigeCycle` runs the original scenario once per interval with `durationSec` set to that interval. It does not repeat resets. `breakEvenSec` is `Math.min(interval, horizonSec)`. `netWorthPerHour` and `pointsPerHour` are `Engine.toNumber` divided by hours. Follow-up: `PR-10`, `PR-11`.
2. **Bulk settlement can charge the single-action cost.** `stepOnce` subtracts `action.cost(ctx, next)` and then calls `action.apply(ctx, next, bulkSize)`. `Action.bulk()` returns `BulkQuote.cost` per size, and `stepOnce` does not read it. Follow-up: `PR-01`. A concrete underpayment fixture is still required.
3. **`runScenario` steps a whole `stepSec` and checks `maxSteps` before the stop conditions.** The duration check uses `state.t` before the step. A horizon that is not a multiple of `stepSec` therefore continues through the step that crosses it. `maxSteps` throws when `steps >= maxSteps` before the duration or `until` check. `applyOfflineSeconds` splits a remainder instead. Follow-up: `PR-02`.
4. **Planner rollout keeps the first decision with `node.firstDecision ?? decision`.** An unset first decision and an explicit no-op are the same missing value, so a later action can replace the first wait. Rollout calls `stepOnce` with the live `ctx`. Follow-up: `PR-04`.
5. **Monte Carlo shares model and strategy objects.** Only `initial` is passed through `deepClonePreservingPrototype`. A strategy that stores a cursor in a closure is shared across draws. Follow-up: `PR-03`.
6. **Session stats are rebuilt from retained events.** `runScenario` accumulates stats from each step's events, then returns `eventBuffer`'s retained `events`. `simulateSessionPattern` calls `statsAcc.push(run.events)` on that retained list. Child `run.stats` is not what the session sums. Offline catch-up inside the session sets `useStrategy: true`. Follow-up: `PR-05`, `PR-06`.
7. **Offline catch-up advances `state.t` by economic time.** `resolveOfflineSeconds` can clamp and decay `seconds` into `effectiveSec`. The following loop steps `effectiveSec`, including a remainder. The returned `offline.requestedSec` keeps the caller's seconds. Session scheduling then reads `state.t`. Follow-up: `PR-06`.
8. **Analytic ETA narrows both sides to `number`.** `etaAnalytic` parses the target with `E.from`, converts the income and the gap with `E.toNumber`, and divides. `constant` income is the high-confidence hint. Follow-up: `PR-09`.
9. **Growth regime is a slope threshold.** `classify` maps slope `< 1e-6` to `stall`, `< 0.01` to `softcap`, `< 0.1` to `exp`, and the rest to `super-exp`. `valueOfState` passes the amount through `Number(...)`. Follow-up: `PR-12`.
10. **`evaluate` does not pass one run configuration to every stage.** The command constructs `createNumberEngine()`. The simulate stage receives `overrideStrategy`, `flags.step`, and `flags.fast`. `collectExperienceSnapshot` receives `seededScenario` without that strategy or those run overrides. Follow-up: `PR-07`.
11. **A missing first visible change becomes a duration or zero in the Monte Carlo summary.** `summarizeExperienceMonteCarlo` uses `firstVisibleChangeSec ?? session.summary.totalActiveSec ?? 0` before quantile summary. Follow-up: `PR-13`.
12. **KPI regression fills some missing guardrail numbers with zero.** Horizons are fixed to `at7d`, `at30d`, and `at90d`. `stallRatio`, `droppedRate`, `visibleChangesPerMinute`, and `maxNoRewardGapSec` use `Number(value ?? 0)`. Follow-up: `PR-17`.
13. **The tuner spec is strategy parameters.** `TuneSpec` carries `strategy.baseParams` and `strategy.space`. Follow-up: `PR-14`, as a separate experiment spec rather than a replacement tuner.

`packages/core/src/scenario/compile.ts` does not contain `Number(rawRight)` at this commit. A suffix-versus-runtime comparison bug is not a confirmed defect here. `PR-07` still has to re-read amount comparison before treating it as one.

## Risks that still need a runtime fixture

- Bulk size greater than 1 against an action whose `bulk()` quote differs from `cost()`.
- Horizon `10` with `stepSec` `6`, and a goal reached on the step that also hits `maxSteps`.
- Two Monte Carlo draws with one scripted strategy cursor.
- Session stats with `eventLog.maxEvents` set low enough to drop events.
- Offline cap or decay where the next session block should follow wall time.
- An amount and a rate that do not fit in `number` while their ratio does.
- Slow and fast exponential series that `classify` currently labels differently.
- `idk evaluate --strategy` compared with the experience stage of the same command.

Do not freeze the current numbers into a new golden file as the expected correct result.

## Host baseline

| Fact | Value at this commit |
|---|---|
| Root `packageManager` | `bun@1.3.10` |
| Root TypeScript range | `^5.8.3` |
| Root `@types/node` | `^24.3.0` |
| `@idlekit/core` typia | `^9.7.2` |
| CI Bun pin | `1.3.9` in `ci.yml`, `codeql.yml`, `docs-verify.yml`, `release.yml` |
| Compiler scripts | `tsc` for money, core, and CLI check. CLI build is Bunli. |
| ttsc / Evidence / Graph | Not installed. `docs/requirements/` does not exist. |

There is no root `tsconfig.json`. Package configs extend `tsconfig.base.json`.

## Outside this track

- Implementing `breakEternity`.
- Sobol or Morris global sensitivity, and a worker pool (`DX-05` only if selected later).
- A general production-network runtime. `PR-15` is observation and diagnosis.
- Treating simulation progress as business revenue or retention.
- Node or browser as a supported product runtime.
- Publishing to npm from this planning change.

## Planned names that are not in the tree

At `265c6ed` none of these existed. `toolchain:doctor` and `toolchain:prepare` arrived in `TC-01`. `evidence:check`, `evidence:smoke`, and `docs/requirements/active/` arrived in `TC-03`. `graph:check` and `tsconfig.graph.json` arrived in `TC-04`. `test:conformance` arrived in `DX-01`. Still targets: `contracts:generate`, `contracts:check`, `idk inspect`, `idk analyze`, `ExecutionPlan`, `RunInstance`, and `AnalyzerRegistry`.
