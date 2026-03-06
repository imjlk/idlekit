# idlekit 사용 가이드

이 문서는 모든 CLI 명령을 훑어보는 레퍼런스입니다.

먼저 아래에서 출발점을 고르세요.

1. 내 게임을 바로 시작하고 싶다: [start-here-cli-designer.md](./start-here-cli-designer.md)
2. 명령 흐름만 빠르게 익히고 싶다: [tutorial-step-by-step.md](./tutorial-step-by-step.md)
3. 플러그인/다중 요소 설계 예시가 먼저 필요하다: [virtual-scenario-design.md](./virtual-scenario-design.md)

역할 기준 시작점:

- 내 게임을 바로 시작: `examples/tutorials/11-my-game-v1.json`
- 명령만 빠르게 체험: `examples/tutorials/01-cafe-baseline.json`
- 플러그인 설계 예시: `examples/tutorials/05-idle-design-v1.json`, `06-idle-design-balance-b.json`, `07-idle-design-tune.json`

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

시나리오 템플릿 생성:

```bash
bun run --cwd packages/cli dev -- init scenario --track intro --out ../../tmp/new-scenario.json
bun run --cwd packages/cli dev -- init scenario --track design --out ../../tmp/design-scenario.json
bun run --cwd packages/cli dev -- init scenario --track personal --out ../../tmp/my-game-v1.json
```

## 3. 기본 워크플로우

### 3.0 목적별 시작점

무엇을 하려는지에 따라 시작 파일을 먼저 고르는 편이 빠릅니다.

- 내 게임 초안 바로 실행: `examples/tutorials/11-my-game-v1.json`
- 개인용 대조군 비교: `examples/tutorials/12-my-game-compare-b.json`
- 개인용 튜닝 시작점: `examples/tutorials/13-my-game-tune.json`
- 명령 체험: `examples/tutorials/01-cafe-baseline.json`
- 설계 예시 분석: `examples/tutorials/05-idle-design-v1.json`
- 대조군 비교: `examples/tutorials/06-idle-design-balance-b.json`
- 전략 파라미터 탐색: `examples/tutorials/07-idle-design-tune.json`
- 설명 문서: [start-here-cli-designer.md](./start-here-cli-designer.md), [virtual-scenario-design.md](./virtual-scenario-design.md)

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

신뢰 파일 기반 정책(권장 2):

```bash
cat > ./tmp/plugin-trust.json <<'JSON'
{
  "plugins": {
    "../../examples/plugins/custom-econ-plugin.ts": "<sha256>"
  }
}
JSON

bun run --cwd packages/cli dev -- validate ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --plugin-root ../../examples/plugins \
  --plugin-trust-file ./tmp/plugin-trust.json
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

리플레이 아티팩트 저장(표준 포맷):

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json \
  --duration 1800 \
  --seed 42 \
  --run-id sim-run-001 \
  --artifact-out ../../tmp/sim.artifact.json \
  --format json
```

artifact에는 재실행 커맨드(`replay.commandLine`)와 검증 키(`runId/seed/scenarioHash/gitSha/pluginDigest/resultHash`)가 함께 기록됩니다.

artifact 재현성 검사:

```bash
bun run --cwd packages/cli dev -- replay verify ../../tmp/sim.artifact.json --format json
```

오프라인 보상(catch-up)만 먼저 반영하고 이어서 시뮬레이션하려면 `--offline-seconds`를 사용합니다.
출력에는 `offline` 요약과 `totalElapsedSec`가 함께 포함됩니다.
또한 `run.id`, `run.seed`, `run.generatedAt`, `summaries.eventLog/offline`가 표준 관측 필드로 포함됩니다.
JSON 출력에는 `_meta`가 추가되어 `cliVersion/gitSha/scenarioHash`를 함께 기록합니다.

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
- `meta.cliVersion`, `meta.gitSha`, `meta.scenarioHash`
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

재현성 고정 + artifact 저장:

```bash
bun run --cwd packages/cli dev -- compare ../../examples/tutorials/01-cafe-baseline.json ../../examples/tutorials/03-cafe-compare-b.json \
  --metric endNetWorth \
  --seed 17 \
  --run-id compare-run-001 \
  --artifact-out ../../tmp/compare.artifact.json \
  --format json
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

`tune --artifact-out`도 동일한 replay artifact 표준(`idk.replay.artifact`)을 사용합니다.

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

artifact 저장:

```bash
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/05-idle-design-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --seed 19 \
  --run-id ltv-run-001 \
  --artifact-out ../../tmp/ltv.artifact.json \
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
- `horizons[].guardrails.growthLog10PerDay`

### 3.10 실데이터 캘리브레이션

```bash
bun run --cwd packages/cli dev -- calibrate ./tmp/telemetry.csv \
  --input-format csv \
  --format json
```

캘리브레이션 결과의 `diagnostics`에는 아래 상관 진단이 포함됩니다.

- `estimatedCorrelationRaw`: 원시 상관 추정치
- `estimatedCorrelation`: 신뢰도 기반 shrinkage(0으로 수축) 적용값
- `correlationConfidence`: 샘플 수/분산 기반 신뢰도(0~1)
- `correlationDiagnostics`: pair별 `raw/value/confidence/sampleSize/variance`

## 3.11 KPI 리그레션 게이트

`kpi:report` 생성물과 baseline을 비교해 장기 지표 회귀를 CI에서 막습니다.

```bash
bun run kpi:report
bun run kpi:regress
```

CLI 명령(동등 동작):

```bash
bun run --cwd packages/cli dev -- kpi regress \
  --baseline ../../examples/bench/kpi-baseline.json \
  --current ../../tmp/kpi-report.json \
  --format json
```

기본 게이트 항목:

- `at7d/at30d/at90d.endNetWorth` 최소 비율(`--min-worth-ratio`, 기본 `0.97`)
- `stallRatio` 증가 한계(`--max-stall-delta`, 기본 `0.03`)
- `droppedRate` 증가 한계(`--max-dropped-delta`, 기본 `0.03`)

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

Replay:

```bash
bun run --cwd packages/cli dev -- replay verify ../../tmp/sim.artifact.json --format json
```

KPI:

```bash
bun run --cwd packages/cli dev -- kpi regress --baseline ../../examples/bench/kpi-baseline.json --current ../../tmp/kpi-report.json --format json
```

## 5. 출력 계약(JSON Schema)

CLI JSON 출력 계약은 아래 스키마를 기준으로 관리됩니다.

- `docs/schemas/simulate.output.schema.json`
- `docs/schemas/eta.output.schema.json`
- `docs/schemas/compare.output.schema.json`
- `docs/schemas/tune.output.schema.json`
- `docs/schemas/ltv.output.schema.json`
- `docs/schemas/calibrate.output.schema.json`
- `docs/schemas/artifact.v1.schema.json`
- `docs/schemas/replay.verify.output.schema.json`
- `docs/schemas/kpi.regress.output.schema.json`

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
