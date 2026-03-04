# 시나리오와 튜닝 명세 가이드

## 1. ScenarioV1 최소 예시

```json
{
  "schemaVersion": 1,
  "unit": { "code": "COIN" },
  "policy": { "mode": "drop" },
  "model": { "id": "linear", "version": 1 },
  "initial": {
    "wallet": { "unit": "COIN", "amount": "0" }
  },
  "clock": { "stepSec": 1, "durationSec": 600 }
}
```

## 2. 핵심 필드 설명

- `unit`: 기본 결제 화폐
- `policy`: `drop | accumulate`, `maxLogGap`
- `model`: 모델 식별자와 버전
- `initial.wallet`: 시작 재화
- `initial.vars`: 모델 상태(모델별 스키마)
- `clock.stepSec`: 틱 간격(초)
- `clock.durationSec`: 총 시뮬레이션 시간
- `clock.untilExpr`: 조기 종료 조건식(안전 파서 문법: `<path> <op> <value>` + `&&`, `||`)
- `clock` 종료 조건: `durationSec` 또는 `untilExpr` 중 최소 1개는 필수
- `strategy`: 전략 id + params
- `analysis`: ETA/성장/프레스티지 분석 옵션
- `sim.fast`: log-domain fast 모드 사용 여부
- `sim.eventLog.enabled`: `false`면 이벤트 저장 비활성화(통계는 계속 계산)
- `sim.eventLog.maxEvents`: 최근 N개 이벤트만 보관(ring buffer)
- `outputs.report`: trace/checkpoint/UX 포함 여부

## 3. 전략 파라미터 기본 주입 규칙

`compileScenario` 규칙:

1. `rawParams = scenario.strategy.params ?? strategyFactory.defaultParams ?? {}`
2. `paramsSchema`가 있으면 2단계 검증
3. 검증 통과 시 `factory.create(rawParams)`

즉, 시나리오에 `strategy.params`를 생략해도 내장 `defaultParams`로 실행됩니다.

`untilExpr` 보안 노트:

- 기본값은 안전 파서만 허용합니다.
- 허용 문법: `t >= 600 && money >= 1e6`
- JS 표현식(삼항/함수호출 등)은 기본 차단됩니다.
- 레거시 호환이 필요하면 `compileScenario(..., opts: { allowUnsafeUntilExpr: true })`를 명시해야 합니다.

## 4. 내장 전략 파라미터

### 4.1 scripted

- `schemaVersion: 1`
- `program: [{ actionId, bulkSize? }]`
- `onCannotApply: "skip" | "stop"`
- `loop: boolean`

### 4.2 greedy

- `objective: "maximizeIncome" | "minPayback" | "maximizeNetWorth"`
- `maxPicksPerStep`
- `bulk.mode: "size1" | "bestQuote" | "maxAffordable"`
- `payback.capSec`, `payback.useEquivalentCost`
- `netWorth.horizonSec`, `netWorth.series`

### 4.3 planner

- `horizonSteps`
- `beamWidth`
- `objective: "maximizeNetWorthAtEnd" | "minTimeToTargetWorth" | "maximizePrestigePerHour"`
- `targetWorth` (`minTimeToTargetWorth`에서 사용)
- `maxBranchingActions`
- `useFastPreview`

## 5. TuneSpecV1 예시

```json
{
  "schemaVersion": 1,
  "strategy": {
    "id": "greedy",
    "baseParams": {
      "schemaVersion": 1,
      "objective": "minPayback"
    },
    "space": [
      {
        "path": "objective",
        "space": {
          "kind": "choice",
          "values": ["maximizeIncome", "minPayback", "maximizeNetWorth"]
        }
      },
      {
        "path": "maxPicksPerStep",
        "space": { "kind": "int", "min": 1, "max": 3 }
      }
    ]
  },
  "objective": { "id": "endNetWorthLog10" },
  "runner": {
    "seeds": [1, 2, 3],
    "budget": 40,
    "overrideDurationSec": 1200,
    "topK": 5
  }
}
```

## 6. 튜닝 실행 순서

1. 시나리오 검증
2. TuneSpec 검증
3. 시나리오 compile
4. 후보 params 샘플링/평가(`runScenario` 반복)
5. objective 점수 평균(시드별)
6. 상위 후보 리포트 반환

## 7. 튜닝 팁

- 초기에는 `budget`을 작게(예: 20~50) 시작
- 수렴 확인 후 multi-stage로 확대
- 시드 수(`runner.seeds`)는 3~7 정도 권장
- 로그 스케일 objective(`*Log10`)를 우선 사용하면 큰 수 영역에서 안정적

레벨 디자인 KPI용 내장 objective 예시:

- `growthLog10PerHour`: 시간당 log 성장량
- `etaToTargetWorthNegSec`: 목표 worth 도달 시간(빠를수록 점수 높음)
- `pacingBalancedLog10`: endWorth + 액션빈도/드롭율 균형 점수

## 8. 튜토리얼 예제 파일 참조

튜토리얼용 가상 시나리오/튜닝 파일:

- `examples/tutorials/01-cafe-baseline.json`
- `examples/tutorials/02-cafe-fast.json`
- `examples/tutorials/03-cafe-compare-b.json`
- `examples/tutorials/04-cafe-tune.json`

실전 플러그인 트랙은 아래 예제를 재사용합니다:

- `examples/plugins/plugin-scenario.json`
- `examples/plugins/plugin-tune.json`
