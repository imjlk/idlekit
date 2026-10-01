# 가드된 해석적 전진

영문 원문: [guarded-analytic-advance.md](./guarded-analytic-advance.md)

`PR-16`은 수입 적분이 fixed-step과 맞는 구간에만 선택적 advance를 둔다. fixed-step이 기준 실행기다. `run.advance`를 빼면 기존 fast 플래그는 그대로다. 그 플래그는 화폐 이벤트를 생략할 수 있다. 그것이 이 해석적 건너뛰기는 아니다.

첫 exact 구간은 상수 수입이고 evolve, 구매, strategy, reset, milestone, soft cap, 예약된 세션, 시드, tick threshold, 컨텍스트 `emit` 콜백, 비어 있지 않은 화폐 bucket이 없다. chunk는 목표, horizon, step 예산, 또는 다음 거절 경계에서 멈춘다. chunk의 step은 fixed-step과 같은 `nextBoundary`가 합산 시계로 정하고, chunk는 기준 step을 통째로, 최소 하나 탄다. duration 끝으로 건너뛴 뒤 목표만 확인하지 않는다. approximation 요청은 적용하지 않는다. 그 보고는 `fallback`이고 관측 주장은 `degraded`이며, 실행 자체는 fixed-step이다.

`maxLogGap`이 있는 drop과 accumulate는 fixed-step에 남는다. 작은 tick의 합을 큰 delta 하나로 다루지 않는다. 컨텍스트 시드는 analytic chunk를 타지 않고, 시드 일정은 다시 쓰지 않는다. 실행이 없는 `advanceResult("statically-known")`는 `insufficient-data`이고 이유는 `advance observations were not supplied`다. `advanceResult("unsupported")`는 `unsupported`다.

exact chunk는 기준 step마다 관측 샘플을 하나 기록한다. 목표 시각, 보상 간격, 화폐 카운터가 그 샘플을 따른다. 그 chunk의 이벤트 로그는 tick마다의 전사본이 아니다. 빠진 화폐 이벤트를 측정값 0으로 저장하지 않는다. `fast.disableMoneyEvents`는 보관된 화폐 이벤트를 생략하고 applied 카운터는 유지한다. `seedSchedule`은 `unchanged`다. `externalProvider`는 false다. 두 번째 숫자 엔진은 없다. conformance 관계 `checkGuardedAdvance`가 seed corpus에서 advance 실행과 fixed-step 실행을 비교한다.

시드 `16`이 `examples/analysis/advance-constant.json`을 가리킨다. advance를 뺀 기준과 같은 horizon의 exact chunk 하나를 로컬에서 한 번 재면 다음과 같다.

| Horizon | Step | Fixed-step ms | Exact-chunk ms | rss bytes | Wallet | Exact steps |
|---|---|---|---|---|---|---|
| 30d (`2592000` s) | `3600` | `6.954000000000178` | `3.5305419999999685` | `398163968` | `5184000` | `720` |
| 90d (`7776000` s) | `3600` | `7.608375000000251` | `2.2211669999996957` | `398409728` | `15552000` | `2160` |

두 wallet이 일치했다. 기록은 이 시간과 rss다. 이 문서는 속도 배수를 적지 않는다. `tools/bench-sim.ts`는 fixed-step CLI corpus로 남고, compiler prepare와 분리된다.

구조 계약은 `idlekit.advance.v1`이고 경로는 [docs/schemas/advance.v1.schema.json](./schemas/advance.v1.schema.json)이다. 생성기는 [docs/schemas/generated/advance.v1.schema.json](./schemas/generated/advance.v1.schema.json)도 쓴다. 이것은 `ScenarioV1`이나 화폐 지표를 바꾸지 않는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.
