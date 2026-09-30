# 265c6ed 소스 감사

English version: [source-audit.md](./source-audit.md)

정책: [분석 계약](../adr/analysis-contracts_ko.md).

기준 커밋: `265c6ed1dad56e474a9b8acd847be42aaa3faa51` (`main`, 2026-09-30). git이 기록한 커밋 날짜는 2026-04-12다. 이 파일은 이번 세션이 소스에서 읽은 사실과, 아직 런타임 fixture가 필요한 위험을 구분한다. `bun test` 결과를 적지 않는다. 아래의 계획된 파일과 명령은 일부러 없다.

`bun tools/analysis-baseline-check.ts`는 인용한 경로가 있는지 확인한다. 아래 표는 `265c6ed`의 `PR-00` 스냅샷이다. `TC-01` 이후의 pin은 [툴체인 pin](../toolchain_ko.md)에 있다. `TC-01`이 host pin을 맞출 때 그 검사의 pin도 같이 고친다. `TC-02`는 패키지 check와 money/core emit을 `ttsc`로 바꾼다. 스냅샷 표는 `265c6ed`에 둔다.

## 이미 있는 것

export나 명령이 있다는 것은 분석이 끝났다는 뜻이 아니다.

| 표면 | 위치 | 현재 의미 |
|---|---|---|
| ETA | `packages/core/src/sim/analysis/eta.ts`, `idk eta` | export된 추정. analytic 모드는 차액과 수입을 모두 `Engine.toNumber`로 줄인다. |
| Prestige cycle | `packages/core/src/sim/analysis/prestigeCycle.ts`, `idk prestige-cycle` | interval마다 scenario를 한 번 실행한다. `cycles`는 요청값을 복사한다. `stability`는 `cycles >= 5`다. |
| Growth | `packages/core/src/sim/analysis/growth.ts`, `idk growth` | log slope 구간 이름 `stall`, `softcap`, `exp`, `super-exp`. |
| Session | `packages/core/src/sim/session.ts`, `idk experience` | preset block, 오프라인 간격, seeded session 실행. |
| Monte Carlo | `packages/core/src/sim/monteCarlo.ts` | seeded draw. draw마다 `initial`만 clone하고 `model`과 `strategy`는 공유한다. |
| Tuner | `packages/core/src/sim/strategy/opt/tuneSpec.ts`, `idk tune` | strategy `baseParams`와 `space`. |
| Evaluate | `packages/cli/src/commands/evaluate.ts` | 프로세스 안에서 validate, simulate, experience, ltv를 호출한다. |
| Review | `packages/cli/src/commands/groups/review.ts`와 `review*.ts` 명령 | 기존 doctor, evaluate, compare 흐름. |
| KPI / replay | `idk kpi`, `packages/cli/src/commands/kpiRegress.ts`, `idk replay` | 기존 회귀와 replay gate. |
| Doctor | `packages/cli/src/commands/doctor.ts` | 환경과 설정 진단. 경제 판단은 이후 judge이며 이 명령이 아니다. |
| 큰 수 | `createBreakInfinityEngine` | 실제 adapter. `createBreakEternityEngine`은 모든 메서드에서 throw한다. |

`packages/cli/src/main.ts`에 등록된 명령은 `validate`, `simulate`, `eta`, `prestige-cycle`, `growth`, `experience`, `evaluate`, `tune`, `compare`, `ltv`, `report`, `calibrate`, `doctor`, `setup`과 `models`, `strategies`, `objectives`, `init`, `replay`, `kpi`, `review` 그룹이다.

재사용할 것도 있다. `stepOnce`, `Engine`의 `divN` / `cmp` / `absLog10`, strategy snapshot/restore, `deepClonePreservingPrototype`, `eventBuffer`, `OUTPUT_CONTRACT_VERSION`, Sampo, compat, replay, KPI gate.

`packages/core/src/sim/simulator.ts`는 마지막 짧은 틱을 포함해 매 틱 `stepOnce`를 호출한다. `fast`는 그 루프를 건너뛰지 않는다. 해석적 시간 건너뛰기가 아니다.

## 이번 세션에서 읽은 소스 사실

아래는 제어 흐름 사실이다. 2번과 3번은 그 경로를 지금 실행하는 fixture를 가리킨다. 나머지 항목은 그 fixture가 실행하지 않았다.

1. **Prestige cycle은 interval scan이다.** `analyzePrestigeCycle`은 interval마다 `durationSec`를 그 간격으로 두고 원래 scenario를 한 번 실행한다. reset을 반복하지 않는다. `breakEvenSec`는 `Math.min(interval, horizonSec)`다. `netWorthPerHour`와 `pointsPerHour`는 `Engine.toNumber`를 시간으로 나눈 값이다. 후속: `PR-10`, `PR-11`.
2. **벌크 결제는 현재 견적을 한 번 낸다.** `PR-01`이 `stepOnce`를 바꿨다. `bulkSize`가 없거나 `1`이면 여전히 `Action.cost`를 한 번 뺀다. 그보다 큰 정수는 현재 상태에서 `Action.bulk`를 다시 읽고 그 `BulkQuote.cost`를 한 번 뺀 다음 `apply`를 한 번 호출한다. size가 없거나 중복이거나, 정수가 아니거나, 유한하지 않거나, 음수이거나, 단위가 다른 견적은 `apply` 전에 거부한다. 단건 비용만 빼고 `bulkSize`를 적용하던 이전 경로는 지금 제어 흐름이 아니다. Fixture: `packages/core/src/sim/step.bulk.test.ts`.
3. **`runScenario`와 `applyOfflineSeconds`는 경제 horizon에서 멈춘다.** `PR-02`가 둘을 바꿨다. 마지막 틱은 `min(stepSec, horizon 안에 남은 시간)`이다. 이미 참인 duration이나 `until`은 `maxSteps`보다 먼저 끝난다. horizon을 요청했는데 `maxSteps`가 먼저이면 `stop.reason: "budget"`을 반환한다. duration과 `until`이 없고 `maxSteps`만 있으면 여전히 throw한다. 그 throw는 끝이 없는 루프에 대한 가드다. Fixture: `packages/core/src/sim/simulator.time.test.ts`. 이 변경이 정확한 동치로 다루는 dt 분할은 상수 수입뿐이다.
4. **Planner rollout은 `node.firstDecision ?? decision`으로 첫 결정을 유지한다.** 첫 결정이 없는 상태와 명시적 no-op이 같은 빈 값이라, 이후 행동이 첫 대기를 바꿀 수 있다. rollout은 살아있는 `ctx`로 `stepOnce`를 호출한다. 후속: `PR-04`.
5. **Monte Carlo는 model과 strategy 객체를 공유한다.** `deepClonePreservingPrototype`에 들어가는 것은 `initial`뿐이다. closure에 cursor를 두는 strategy는 draw 사이에 공유된다. 후속: `PR-03`.
6. **Session 통계는 보관된 이벤트에서 다시 합산된다.** `runScenario`는 step 이벤트로 stats를 쌓은 뒤 `eventBuffer`가 보관한 `events`를 반환한다. `simulateSessionPattern`은 그 보관 목록에 `statsAcc.push(run.events)`를 한다. session이 합치는 값은 child `run.stats`가 아니다. session 안의 오프라인 catch-up은 `useStrategy: true`다. 후속: `PR-05`, `PR-06`.
7. **오프라인 catch-up은 경제 시간만큼 `state.t`를 진행한다.** `resolveOfflineSeconds`는 `seconds`를 clamp와 decay로 `effectiveSec`로 줄일 수 있다. 이후 루프는 나머지를 포함해 `effectiveSec`를 step한다. 반환값 `offline.requestedSec`는 호출자가 준 seconds를 유지한다. session 일정은 그 다음 `state.t`를 읽는다. 후속: `PR-06`.
8. **Analytic ETA는 양쪽을 `number`로 줄인다.** `etaAnalytic`은 목표를 `E.from`으로 읽고, 수입과 차액을 `E.toNumber`로 바꾼 뒤 나눈다. `constant` 수입이 high-confidence hint다. 후속: `PR-09`.
9. **Growth regime은 slope 임계값이다.** `classify`는 slope `< 1e-6`을 `stall`, `< 0.01`을 `softcap`, `< 0.1`을 `exp`, 나머지를 `super-exp`로 둔다. `valueOfState`는 양을 `Number(...)`에 통과시킨다. 후속: `PR-12`.
10. **`evaluate`는 모든 단계에 하나의 실행 구성을 넘기지 않는다.** 명령은 `createNumberEngine()`을 만든다. simulate 단계는 `overrideStrategy`, `flags.step`, `flags.fast`를 받는다. `collectExperienceSnapshot`은 그 strategy와 run override가 없는 `seededScenario`를 받는다. 후속: `PR-07`.
11. **첫 가시 변화가 없으면 Monte Carlo 요약에서 구간 길이 또는 0이 된다.** `summarizeExperienceMonteCarlo`는 분위수 요약 전에 `firstVisibleChangeSec ?? session.summary.totalActiveSec ?? 0`을 쓴다. 후속: `PR-13`.
12. **KPI 회귀는 빠진 일부 guardrail 숫자를 0으로 채운다.** horizon은 `at7d`, `at30d`, `at90d`로 고정된다. `stallRatio`, `droppedRate`, `visibleChangesPerMinute`, `maxNoRewardGapSec`는 `Number(value ?? 0)`을 쓴다. 후속: `PR-17`.
13. **Tuner spec은 strategy 파라미터다.** `TuneSpec`은 `strategy.baseParams`와 `strategy.space`를 가진다. 후속: `PR-14`. 기존 tuner를 교체하는 대신 별도 실험 spec으로 확장한다.

이 커밋의 `packages/core/src/scenario/compile.ts`에는 `Number(rawRight)`가 없다. suffix와 런타임 비교 버그는 여기서 확정된 결함이 아니다. `PR-07`은 금액 비교를 다시 읽고 결함인지 판단한다.

## 아직 런타임 fixture가 필요한 위험

- `bulk()` 견적이 `cost()`와 다른 action에서 size가 1보다 큰 경우.
- horizon `10`, `stepSec` `6`은 `PR-02` fixture다. `until`과 budget이 같은 틱에서 만나는 목표는 아직 별도 fixture가 필요하다.
- scripted strategy cursor 하나를 두 Monte Carlo draw가 쓰는 경우.
- `eventLog.maxEvents`가 이벤트를 버릴 만큼 작을 때의 session stats.
- 다음 session block이 벽시계를 따라야 하는 오프라인 상한 또는 감쇠.
- 양과 속도는 `number`에 들어가지 않고 비율은 유한한 경우.
- `classify`가 현재 다른 이름을 붙이는 느린 지수와 빠른 지수.
- `idk evaluate --strategy`와 같은 명령의 experience 단계 비교.

현재 숫자를 새 golden 파일의 정답으로 고정하지 않는다.

## Host 기준

| 사실 | 이 커밋의 값 |
|---|---|
| Root `packageManager` | `bun@1.3.10` |
| Root TypeScript 범위 | `^5.8.3` |
| Root `@types/node` | `^24.3.0` |
| `@idlekit/core` typia | `^9.7.2` |
| CI Bun pin | `ci.yml`, `codeql.yml`, `docs-verify.yml`, `release.yml`의 `1.3.9` |
| Compiler script | money, core, CLI check는 `tsc`. CLI build는 Bunli. |
| ttsc / Evidence / Graph | 설치되어 있지 않다. `docs/requirements/`는 없다. |

root `tsconfig.json`은 없다. 패키지 설정은 `tsconfig.base.json`을 확장한다.

## 이 트랙 밖

- `breakEternity` 구현.
- Sobol 또는 Morris 전역 민감도, worker pool. `DX-05`는 나중에 선택할 때만.
- 일반 생산 네트워크 런타임. `PR-15`는 관측과 진단이다.
- 시뮬레이션 진행을 사업 매출이나 리텐션으로 해석하는 것.
- 지원 제품 런타임으로서의 Node 또는 브라우저.
- 이 계획 변경에서 npm에 배포하는 것.

## 트리에 없는 계획 이름

`265c6ed`에는 아래 이름이 없었다. `toolchain:doctor`와 `toolchain:prepare`는 `TC-01`에서 생겼다. `evidence:check`, `evidence:smoke`, `docs/requirements/active/`는 `TC-03`에서 생겼다. `graph:check`와 `tsconfig.graph.json`은 `TC-04`에서 생겼다. `test:conformance`는 `DX-01`에서 생겼다. 아직 목표인 것: `contracts:generate`, `contracts:check`, `idk inspect`, `idk analyze`, `ExecutionPlan`, `RunInstance`, `AnalyzerRegistry`.
