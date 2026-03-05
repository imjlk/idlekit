# idlekit 사용 가이드

권장 학습 순서:

1. 설계 우선: [virtual-scenario-design.md](./virtual-scenario-design.md)
2. 실행 중심: [tutorial-step-by-step.md](./tutorial-step-by-step.md)
3. 이후 이 문서를 레퍼런스로 사용

## 1. 개발 환경 준비

필수:

- Bun 1.3+
- TypeScript(워크스페이스 dev dependency로 이미 포함)

설치와 기본 검증:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

## 2. CLI 실행 방식

개발 중(권장):

```bash
bun run --cwd packages/cli dev -- --help
```

빌드 결과 실행:

```bash
bun run --cwd packages/cli build
bun packages/cli/dist/main.js --help
```

설치형 실행:

```bash
bun link --cwd packages/cli
idk --help
```

네이티브 바이너리 빌드:

```bash
bun run --cwd packages/cli build:bin
```

## 3. 기본 워크플로우

### 3.0 설계 우선(가상 시나리오) 시작점

재화/요소/액션을 먼저 설계하려면 아래 트랙을 권장합니다.

- 시나리오: `examples/tutorials/05-idle-design-v1.json`
- 대조군: `examples/tutorials/06-idle-design-balance-b.json`
- 튜닝: `examples/tutorials/07-idle-design-tune.json`
- 설명 문서: [virtual-scenario-design.md](./virtual-scenario-design.md)

### 3.1 시나리오 검증

```bash
bun run --cwd packages/cli dev -- validate ../../examples/simple-linear.json
```

플러그인 포함 검증:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/simple-linear.json --plugin ./my-plugin.ts --allow-plugin true
```

플러그인 신뢰 정책(권장):

```bash
SHA=$(shasum -a 256 ../../examples/plugins/custom-econ-plugin.ts | awk '{print $1}')
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --plugin-root ../../examples/plugins \
  --plugin-sha256 ../../examples/plugins/custom-econ-plugin.ts=$SHA
```

### 3.2 시뮬레이션

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json
```

오버라이드:

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json \
  --duration 1800 \
  --step 1 \
  --strategy greedy \
  --offline-seconds 3600 \
  --seed 42 \
  --state-out ../../tmp/sim-state.json \
  --fast true \
  --event-log-enabled true \
  --event-log-max 2000 \
  --format json
```

오프라인 보상(catch-up)만 먼저 반영하고 이어서 시뮬레이션하려면 `--offline-seconds`를 사용합니다.
출력에는 `offline` 요약과 `totalElapsedSec`가 함께 포함됩니다.
또한 `run.id`, `run.seed`, `run.generatedAt`, `summaries.eventLog/offline`가 표준 관측 필드로 포함됩니다.

저장 상태에서 재개:

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json \
  --resume ../../tmp/sim-state.json \
  --duration 600 \
  --format json
```

상태 파일(`--state-out`) 표준 필드:

- `v`, `unit`, `t`, `wallet`, `maxMoneyEver`, `prestige`, `vars`
- `meta.scenarioPath`, `meta.savedAt`, `meta.runId`, `meta.seed`
- `strategy.id`, `strategy.state` (전략이 상태 snapshot을 지원할 때)

재개(`--resume`) 규칙:

- state json은 실행 전에 구조 검증됩니다. 깨진 파일은 `Invalid sim state json: ...`으로 실패합니다.
- 저장된 `unit`과 현재 시나리오 단위가 다르면 `Sim state unit mismatch`로 실패합니다.
- state에 `strategy`가 있으면 현재 실행 전략과 `id`가 같아야 하며, 다르면 `Resume strategy mismatch`로 실패합니다.
- state에 전략 상태가 있는데 해당 전략이 restore를 지원하지 않으면 실패합니다.

권장:

- 재현 가능한 리플레이/튜닝 비교가 필요하면 `--resume` 실행 시 `--strategy` override를 생략하고, 시나리오 기본 전략을 그대로 사용하세요.
- 내장 `scripted` 전략은 cursor 상태를 저장/복원하므로 연속 실행과 분할 재개 결과를 맞출 수 있습니다.

### 3.3 ETA 분석

돈 목표:

```bash
bun run --cwd packages/cli dev -- eta ../../examples/simple-linear.json \
  --target-money 1e6 \
  --mode simulate
```

순자산(net worth) 목표 + analytic 비교:

```bash
bun run --cwd packages/cli dev -- eta ../../examples/simple-linear.json \
  --target-worth 1e6 \
  --mode analytic \
  --diff simulate
```

simulate 상세 run payload가 필요할 때만:

```bash
bun run --cwd packages/cli dev -- eta ../../examples/simple-linear.json \
  --target-worth 1e6 \
  --mode simulate \
  --include-run true \
  --format json
```

### 3.4 성장 구간 분석

```bash
bun run --cwd packages/cli dev -- growth ../../examples/simple-linear.json \
  --window 60 \
  --series money \
  --trace-every 1
```

### 3.5 프레스티지 사이클 분석

```bash
bun run --cwd packages/cli dev -- prestige-cycle ../../examples/simple-linear.json \
  --scan 300..1800 \
  --step 60 \
  --horizon 3600 \
  --cycles 10 \
  --objective netWorthPerHour
```

### 3.6 리포트 생성

```bash
bun run --cwd packages/cli dev -- report ../../examples/simple-linear.json \
  --checkpoints 60,300,900,3600 \
  --include-growth true \
  --include-ux true \
  --format md
```

### 3.7 시나리오 비교

```bash
bun run --cwd packages/cli dev -- compare ../../examples/simple-linear.json ../../examples/simple-linear.json \
  --metric endNetWorth
```

ETA 비교(목표 worth 지정):

```bash
bun run --cwd packages/cli dev -- compare ../../examples/simple-linear.json ../../examples/simple-linear.json \
  --metric etaToTargetWorth \
  --target-worth 1e6 \
  --max-duration 86400
```

주의:

- `etaToTargetWorth` metric은 `--target-worth`가 필수입니다.

### 3.8 전략 튜닝

```bash
bun run --cwd packages/cli dev -- tune ../../examples/simple-linear.json \
  --tune ../../examples/tune-simple.json \
  --artifact-out ../../tmp/tune-latest.json \
  --format json
```

주의:

- `tune` 결과는 구조상 중첩 객체가 많으므로 `json` 출력 권장

회귀 비교:

```bash
bun run --cwd packages/cli dev -- tune ../../examples/simple-linear.json \
  --tune ../../examples/tune-simple.json \
  --baseline-artifact ../../tmp/tune-baseline.json \
  --regression-tolerance 0.05 \
  --fail-on-regression true \
  --artifact-out ../../tmp/tune-latest.json \
  --format json

bun run tune:regress --baseline ../../tmp/tune-baseline.json --current ../../tmp/tune-latest.json --tolerance 0.05
```

### 3.9 LTV 구간 스냅샷

요청 구간(30m/2h/24h/7d/30d/90d) KPI를 한 번에 계산:

```bash
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/05-idle-design-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --value-per-worth 0.001 \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

`--value-per-worth`를 주면 `economyValueProxy`가 함께 출력됩니다.
값을 주지 않으면 `netWorth` 중심 KPI 테이블만 출력됩니다.

주요 출력 필드:

- `horizons[].monetization.cumulativeLtvPerUser`
- `horizons[].monetization.cumulativeLtvQuantiles` (uncertainty 활성 시)
- `horizons[].guardrails.timeToFirstUpgradeSec`
- `horizons[].guardrails.stallRatio`
- `horizons[].guardrails.actionMix`

### 3.10 실데이터 캘리브레이션

```bash
bun run --cwd packages/cli dev -- calibrate ./tmp/telemetry.csv \
  --input-format csv \
  --format json
```

CSV 권장 컬럼:

- `user_id`
- `day`
- `revenue` (iap)
- `ad_revenue`
- `acquisition_cost` (선택)
- `active` (선택)

## 4. 레지스트리 조회 명령

모델:

```bash
bun run --cwd packages/cli dev -- models list --format md
```

전략:

```bash
bun run --cwd packages/cli dev -- strategies list --format md
```

목표(Objective):

```bash
bun run --cwd packages/cli dev -- objectives list --format md
```

공통 규칙:

- `--format` 기본값은 `md`
- `--out`을 주지 않으면 stdout
- 정렬은 id 기준 오름차순(모델은 id + version)

## 5. 출력 포맷과 파일 저장

공통 옵션:

- `--format json|md|csv`
- `--out <path>`

예:

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json \
  --format json \
  --out ../../tmp/sim-result.json
```

## 6. 내장 구성요소

기본 모델:

- `linear@1`

내장 전략:

- `scripted`
- `greedy`
- `planner`

내장 objective:

- `endMoneyLog10`
- `endNetWorthLog10`
- `netWorthPerHourLog10`
- `prestigePointsPerHourLog10`
- `growthLog10PerHour`
- `etaToTargetWorthNegSec`
- `pacingBalancedLog10`

## 7. 자주 겪는 문제

`Scenario invalid`:

- `model.id/version`이 레지스트리에 없는 경우
- `initial.wallet.amount`가 문자열이 아닌 경우
- `clock.stepSec <= 0`

`Unknown strategy/objective`:

- 플러그인 경로 누락
- 플러그인 export 형식 불일치

ETA analytic 정확도:

- 모델이 `analytic()` 힌트를 충분히 제공하지 않으면 simulate 대비 오차가 커질 수 있습니다.

`validate`에서 migration notice가 출력될 수 있음:

- `schemaVersion` 누락/legacy `ltv` 블록이 자동 정규화된 경우 안내 메시지가 출력됩니다.

## 8. 플러그인 실전 예제

아래 예제로 커스텀 model/strategy/objective를 한 번에 확인할 수 있습니다.

- [examples/plugins/README.md](../examples/plugins/README.md)

빠른 실행:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true

bun run --cwd packages/cli dev -- simulate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

## 9. 화폐 라이브러리 단독 사용(@idlekit/money)

시뮬레이터(`@idlekit/core`)와 분리해서 화폐 처리만 사용할 수 있습니다.

```bash
bun run --cwd packages/money typecheck
bun run --cwd packages/money test
bun examples/money-package/run.ts
```

상세 API/정책 설명:

- [money-library.md](./money-library.md)
