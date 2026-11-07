# 고급 분석

English version: [advanced-analysis.md](./advanced-analysis.md)

이 문서는 시드 고정 확률 이벤트, 신뢰구간, 전역 민감도, 파라미터 탐색, 리셋 정책 보고서를 다룬다. 모두 같은 시드에서 결정적이다. `Math.random`은 읽지 않는다.

## 시드 고정 확률 이벤트

`exponential`과 `prestige` 모델은 params에 선택적 `stochastic` 블록을 받는다(`prestige`는 `generator` 아래):

```json
"stochastic": {
  "crit": { "chance": 0.05, "multiplier": 10 },
  "drops": [{ "id": "chest", "ratePerSec": 0.01, "rewardIncomeSec": 120 }],
  "events": [{ "id": "frenzy", "windowSec": 600, "chance": 0.5, "durationSec": 60, "incomeMultiplier": 7 }]
}
```

- `crit`: tick마다 한 번 굴린다. 치명 tick은 그 tick의 수입을 배로 만든다.
- `drops`: 포아송 드롭. `dt`초 tick은 `1 - exp(-ratePerSec * dt)` 확률로 발생하고 tick 기본 수입의 `rewardIncomeSec`초어치를 준다.
- `events`: `windowSec` 창마다 한 번 굴린다. 발동한 이벤트는 창의 처음 `durationSec`초 동안 수입을 배로 만든다.

각 추첨은 run 시드, 스트림 id, tick(또는 창) 번호의 해시다. 상태를 들고 다니지 않으므로 planner preview, 재개한 run, 새 run이 같은 tick에서 같은 운을 본다. Monte Carlo draw처럼 시드를 바꾸면 운이 바뀐다. `stochastic` 블록이 켜져 있으면 모델은 `analytic` 힌트를 내지 않으므로 exact ETA는 시뮬레이션으로 돌아간다. core의 `expectedStochasticIncomeFactor(spec, dt)`는 설계 점검용 장기 평균 배율을 준다.

[`30-lucky-forge-v1.json`](../examples/tutorials/30-lucky-forge-v1.json)은 Monte Carlo draw 16개를 쓰는 예제다.

## 분위수와 신뢰구간

draw가 2개 이상인 `idk experience`는 이제 `monteCarlo.intervals`에 `endNetWorthLog10`, `visibleChangesPerMinute`, `maxNoRewardGapSec`를 더한다. 각각 `SampleSummaryV1`이다: `n`, 평균, 표준편차, 최솟값, 최댓값, 평균의 정규근사 구간, 그리고 분포 가정 없는 순서통계량 구간을 가진 0.1, 0.5, 0.9 분위수. 표본이 요청한 신뢰수준에 비해 작으면 구간은 `null`이다. 유한한 draw가 없으면 필드가 `null`이다. Markdown은 `## Monte Carlo` 아래에 95% 구간을 출력한다.

```bash
bun run --cwd packages/cli dev -- experience ../../examples/tutorials/30-lucky-forge-v1.json --seed 7 --format md
```

core는 다른 보고서용으로 `summarizeSamples`, `quantileInterval`, `normalQuantile`을 export한다.

## 설계 연구 spec

`idk sensitivity`와 `idk optimize`는 같은 spec(JSON 또는 YAML)을 읽는다. 예: [`examples/design-study/forge-study.json`](../examples/design-study/forge-study.json):

- `parameters`: `{ path, min, max, scale?: "linear" | "log", integer? }` 1~32행. `path`는 `model.params.costGrowth` 같은 scenario 안 점 경로다. 부모가 있어야 한다. prototype 세그먼트는 거절한다. 숫자 문자열 leaf는 문자열로 남는다.
- `objectives`: `weight`를 가진 항 1~8개. 점수는 가중합이고 낮을수록 좋다:
  - `milestoneTime`: 첫 마일스톤(또는 `milestoneKey`)까지 `log10(sec + 1)`. censored draw는 horizon + 1로 센다.
  - `sessionPacing`: `|log10(pace / targetVisibleChangesPerMinute)| + max(0, gap / maxNoRewardGapSec - 1)`.
  - `endNetWorthLog10`: 부호를 뒤집어 클수록 좋다.
  - `ltv`: `horizonDays` 동안 monetization 설정으로 추정한 사용자당 LTV, 부호 반전.
- `evaluation`: `sessionPattern`, `days`, `draws`(1~64). 평가마다 패치한 scenario를 컴파일하고 draw마다 `experience`를 한 번 돌려 평균한다.

## 전역 민감도: `idk sensitivity`

```bash
bun run --cwd packages/cli dev -- sensitivity ../../examples/tutorials/26-exponential-forge-v1.json \
  --spec ../../examples/design-study/forge-study.json --method morris --max-runs 40 --format md
```

- `--method morris`(기본): `levels`(기본 4)와 `floor(maxRuns / (k + 1))` 궤적을 쓰는 elementary effects 스크리닝. 파라미터마다 `mu`, `muStar`, `sigma`를 단위 좌표로 보고하므로 범위가 다른 파라미터끼리 비교된다.
- `--method sobol`: `N = floor(maxRuns / (k + 2))` 기준 행으로 Saltelli 1차 `S1`과 Jansen 전체 `ST`, bootstrap 백분위 구간(`--bootstrap`, 기본 200).
- 기본 예산은 Morris `10 (k + 1)`, Sobol `64 (k + 2)`. `--seed`가 설계점을 고정한다.
- 점수와 목표별 지수를 같은 캐시 run에서 계산하므로 목표별 순위에 추가 시뮬레이션이 들지 않는다.
- 힌트는 가장 중요한 파라미터, 고정해도 되는 파라미터, 강한 상호작용을 알려 준다. `idk experiment`는 한 점 주변 one-at-a-time 스윕으로 남는다.

## 파라미터 탐색: `idk optimize`

```bash
bun run --cwd packages/cli dev -- optimize ../../examples/tutorials/26-exponential-forge-v1.json \
  --spec ../../examples/design-study/forge-study.json --method ga --max-runs 60 --seed 1 --format md
```

- `--method grid | random | ga`(기본 `ga`). grid는 파라미터마다 `floor(maxRuns^(1/k))` 수준. GA는 토너먼트 선택, BLX-0.5 교차, 가우시안 변이, 엘리트 1개를 쓰고 `--population`을 받는다.
- 예산: `--max-runs`(기본 60, 최대 10000)와 초 단위 `--time-limit`. 출력은 `stoppedBy`(`max-runs`, `time-limit`, `exhausted`), 시드, 사용한 run 수를 기록한다. 시간 제한으로 멈춘 run은 기계마다 재현되지 않는다. `max-runs`로 멈춘 run은 재현된다.
- 출력: 패치하지 않은 scenario의 기준 평가, 최적 값, 개선폭, 상위 `--top` 후보, 수렴 추이. 범위 끝에 붙은 최적 값에는 범위를 넓히라는 힌트가 붙는다.
- `--write-best <path>`는 최적 값을 패치한 입력 scenario를 쓴다. scenario나 spec을 덮어쓰지 않는다.

## 리셋 정책: `idk reset-policy`

```bash
bun run --cwd packages/cli dev -- reset-policy ../../examples/tutorials/27-prestige-loop-v1.json \
  --scan 600..1800 --step 600 --horizon 5000 --format md
```

`analyzeResetPolicies`([리셋 정책 분석](./reset-cycle-analysis_ko.md) 참고)를 감싸고 `summarizeResetPolicy`의 `insights`를 더한다:

- 간격마다: 시간당 보상, 사이클당 보상, 회복, 안정성, 그리고 리셋하지 않는 run 대비 horizon 순자산인 `roiVsNoReset`(`--skip-baseline`이면 그 run을 생략)
- `optimalIntervalSec`와 최고 보상률의 `--plateau`(기본 5%) 안에 드는 간격의 `timingWindow`
- 좁은 창, 불안정한 승자, 본전을 못 찾는 리셋에 대한 힌트

horizon이 커밋된 리셋에서 끝나면 그 순자산은 새 사이클의 것이라 -100%로 읽히므로 `roiVsNoReset`은 `null`이다. 마지막 리셋 뒤에 꼬리가 남는 horizon을 고른다.

core의 `analyzeResetLayers`는 다층 훅이다: 층마다(1~8개, 고유 id) reset-policy 요청 하나를 돌려 층을 나란히 돌려준다. 중첩 프레스티지 층을 가진 모델이 각 요청을 만든다.

`idk prestige-cycle`은 이제 각 간격 끝에 가능한 리셋을 `pointsPerHour`에 포함하므로, 간격 안에서 리셋을 커밋하지 않는 스캔이 더 이상 0으로 읽히지 않는다.

Node.js와 브라우저 런타임은 v1 호환 계약에 포함되지 않는다.

### 배열 파라미터 경로

`model.params.recipes.0.timeSec`, `model.params.generators.0.incomePerLevel`처럼 기존 배열 원소를 0부터 시작하는 정규 인덱스로 지정할 수 있다. 배열 확장은 허용하지 않으며, 없는 인덱스·`length`·프로토타입 경로·문자열 식별자를 포함한 비수치 말단 값은 평가 전에 거부한다. 숫자 문자열의 타입은 유지하며, 십진수·과학적 표기법·지원하는 접미사 표기법을 허용한다.
