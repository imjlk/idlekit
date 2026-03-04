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
- `strategy`: 전략 id + params
- `analysis`: ETA/성장/프레스티지 분석 옵션
- `sim.fast`: log-domain fast 모드 사용 여부
- `outputs.report`: trace/checkpoint/UX 포함 여부

## 3. 전략 파라미터 기본 주입 규칙

`compileScenario` 규칙:

1. `rawParams = scenario.strategy.params ?? strategyFactory.defaultParams ?? {}`
2. `paramsSchema`가 있으면 2단계 검증
3. 검증 통과 시 `factory.create(rawParams)`

즉, 시나리오에 `strategy.params`를 생략해도 내장 `defaultParams`로 실행됩니다.

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
