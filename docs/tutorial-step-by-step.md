# 튜토리얼: 2트랙 스텝바이스텝 (입문 15분 + 실전 60분)

이 문서는 idlekit를 실제로 써보는 가장 빠른 경로입니다.

- 입문 트랙(약 15분): 내장 모델/전략으로 기본 분석 루프 체험
- 실전 트랙(약 60분): 플러그인 + 튜닝 + KPI 비교 루프 체험

설계 우선으로 시작하려면 먼저 아래 문서를 진행하세요:

- [virtual-scenario-design.md](./virtual-scenario-design.md)

기준 경로:

- 명령은 **프로젝트 루트**에서 실행
- 개발형 표준: `bun run --cwd packages/cli dev -- ...`
- 설치형 동등 명령: `idk ...` (보조로 병기)

## 1) 튜토리얼 목표와 완주 기준

목표:

- 시나리오를 검증하고, 실행하고, ETA/리포트/비교/튜닝까지 한 번에 수행
- (설계 우선 트랙) 재화/요소/액션 의사결정을 시나리오 JSON으로 옮길 수 있다.

완주 기준:

- 입문 트랙: compare 결과에서 `detail.source = "measured"` 확인
- 실전 트랙: tune 결과에서 `report.best` 확인
- 설계 트랙: `05-idle-design-v1`에서 재화/요소/액션 선택 이유를 설명할 수 있음

사전 체크(권장 10분):

- `docs/virtual-scenario-design.md`의 0번 섹션(가상 시나리오 캔버스) 먼저 작성
- 최소 결정 항목: 재화 2종(`COIN/GEM`), 핵심 액션 3종(`buy.producer/buy.upgrade/exchange.gem`)

성공 조건:

- 입문/실전 트랙의 최종 출력 JSON에 핵심 필드가 채워진다.

실패 대응:

- 명령어 경로 오류 시 현재 위치를 프로젝트 루트로 이동 후 재실행

## 2) 준비 (install/typecheck/test/build)

```bash
bun install
bun run typecheck
bun run test
bun run build
```

선택(설치형 CLI 등록):

```bash
bun link --cwd packages/cli
idk --help
```

성공 조건:

- `typecheck/test/build` 모두 성공하고 `idk --help`가 출력된다.

실패 대응:

- `idk: command not found`이면 `bun link --cwd packages/cli`를 다시 실행

## 3) 입문 트랙: 시나리오 검증

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/01-cafe-baseline.json
```

동등 명령:

```bash
idk validate examples/tutorials/01-cafe-baseline.json
```

성공 조건:

- `OK: ...01-cafe-baseline.json` 출력

실패 대응:

- `Scenario invalid`면 오류 path 기준으로 JSON 필드 타입/필수값 수정

## 4) 입문 트랙: 시뮬레이션 실행

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/01-cafe-baseline.json --format json
```

동등 명령:

```bash
idk simulate examples/tutorials/01-cafe-baseline.json --format json
```

선택(상태 저장/재개 확인):

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/01-cafe-baseline.json \
  --duration 30 \
  --state-out ../../tmp/tutorial-state.json \
  --format json

bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/01-cafe-baseline.json \
  --resume ../../tmp/tutorial-state.json \
  --duration 10 \
  --format json
```

성공 조건:

- JSON에 `endMoney`, `endNetWorth`, `stats`가 존재
- 상태 저장/재개 실행 시 두 번째 결과의 `startT`가 첫 실행의 `endT`와 일치

실패 대응:

- `Unknown strategy`면 scenario의 `strategy.id` 또는 plugin 옵션 확인
- `Invalid sim state json`이면 state 파일 손상/수정 여부 확인 후 재생성

## 5) 입문 트랙: ETA 분석

```bash
bun run --cwd packages/cli dev -- eta ../../examples/tutorials/01-cafe-baseline.json \
  --target-worth 1e5 \
  --mode analytic \
  --diff simulate \
  --max-duration 7200 \
  --format json
```

동등 명령:

```bash
idk eta examples/tutorials/01-cafe-baseline.json --target-worth 1e5 --mode analytic --diff simulate --max-duration 7200 --format json
```

성공 조건:

- JSON에 `reached`, `seconds`, `mode`가 존재

실패 대응:

- `Exactly one target is required`면 `--target-money`/`--target-worth` 중 하나만 사용

## 6) 입문 트랙: 리포트 생성

```bash
bun run --cwd packages/cli dev -- report ../../examples/tutorials/01-cafe-baseline.json \
  --checkpoints 60,300,900,1200 \
  --include-growth true \
  --include-ux true \
  --format md \
  --out ../../tmp/tutorial-report.md

bun run --cwd packages/cli dev -- report ../../examples/tutorials/01-cafe-baseline.json \
  --format json \
  --out ../../tmp/tutorial-report.json
```

동등 명령:

```bash
idk report examples/tutorials/01-cafe-baseline.json --format md --out tmp/tutorial-report.md
```

성공 조건:

- `tmp/tutorial-report.md`, `tmp/tutorial-report.json` 파일 생성

실패 대응:

- out 경로 오류면 상대경로 기준(루트 기준) 재확인

## 7) 입문 트랙: compare (measured 확인)

```bash
bun run --cwd packages/cli dev -- compare \
  ../../examples/tutorials/01-cafe-baseline.json \
  ../../examples/tutorials/03-cafe-compare-b.json \
  --metric etaToTargetWorth \
  --target-worth 1e5 \
  --max-duration 7200 \
  --format json
```

동등 명령:

```bash
idk compare examples/tutorials/01-cafe-baseline.json examples/tutorials/03-cafe-compare-b.json \
  --metric etaToTargetWorth --target-worth 1e5 --max-duration 7200 --format json
```

성공 조건:

- `detail.source`가 `measured`
- `measured.a`, `measured.b`가 채워짐

실패 대응:

- `metric=etaToTargetWorth requires --target-worth`면 target 옵션 추가

## 8) 실전 트랙: 플러그인 로딩 확인

```bash
bun run --cwd packages/cli dev -- models list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
bun run --cwd packages/cli dev -- strategies list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
bun run --cwd packages/cli dev -- objectives list --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
```

동등 명령:

```bash
idk models list --plugin examples/plugins/custom-econ-plugin.ts --allow-plugin true --format json
```

성공 조건:

- `plugin.generators`, `plugin.producerFirst`, `plugin.gemsAndWorthLog10` 노출

실패 대응:

- `Cannot find module`이면 plugin 경로를 루트 기준 상대경로로 수정

## 9) 실전 트랙: tune 실행 + best params 해석

```bash
bun run --cwd packages/cli dev -- tune ../../examples/plugins/plugin-scenario.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --tune ../../examples/plugins/plugin-tune.json \
  --format json
```

동등 명령:

```bash
idk tune examples/plugins/plugin-scenario.json \
  --plugin examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --tune examples/plugins/plugin-tune.json \
  --format json
```

성공 조건:

- JSON에 `report.best`, `report.top`, `report.tried` 존재

실패 대응:

- `Invalid strategy baseParams` 또는 `Invalid objective params`면 tune spec 스키마 확인

## 10) 실전 트랙: 반복 루프 (수정 -> 재실행 -> KPI 비교)

반복 템플릿:

1. 시나리오/튜닝 파라미터 한 항목만 변경
2. `simulate` 재실행
3. `compare --metric endNetWorth` 또는 `--metric etaToTargetWorth` 재확인
4. 필요 시 `tune` 재실행 후 `report.best` 갱신

추천 KPI objective:

- `growthLog10PerHour`
- `etaToTargetWorthNegSec`
- `pacingBalancedLog10`

성공 조건:

- 변경 전/후 측정값이 `measured`로 비교 가능하고 의사결정 근거를 기록할 수 있다.

실패 대응:

- 수치가 흔들리면 `runner.seeds`를 늘리고 `budget`/`stages`를 단계적으로 확대

## 부록) 설계 우선 가상 시나리오 트랙

아래 3개 파일은 "아이들 게임 초기 기획(재화/요소/액션)"을 바로 실험하기 위한 세트입니다.

- `examples/tutorials/05-idle-design-v1.json`
- `examples/tutorials/06-idle-design-balance-b.json`
- `examples/tutorials/07-idle-design-tune.json`

설계 의도:

- 재화
  - `COIN`: 기본 결제/수입 재화
  - `GEM`: 장기 가치 재화(`vars.gems`)
- 요소
  - `producers`: 기본 생산력
  - `upgrades`: 배율 강화
- 액션
  - `buy.producer`
  - `buy.upgrade`
  - `exchange.gem`

실행 순서:

```bash
bun run --cwd packages/cli dev -- validate ../../examples/tutorials/05-idle-design-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true

bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/05-idle-design-v1.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json

bun run --cwd packages/cli dev -- compare \
  ../../examples/tutorials/05-idle-design-v1.json \
  ../../examples/tutorials/06-idle-design-balance-b.json \
  --metric endNetWorth \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json

bun run --cwd packages/cli dev -- tune ../../examples/tutorials/05-idle-design-v1.json \
  --tune ../../examples/tutorials/07-idle-design-tune.json \
  --plugin ../../examples/plugins/custom-econ-plugin.ts \
  --allow-plugin true \
  --format json
```

상세 설계 설명:

- [virtual-scenario-design.md](./virtual-scenario-design.md)

LTV 구간 스냅샷(30m/2h/24h/7d/30d/90d):

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

실데이터가 있으면 캘리브레이션 후 재실행:

```bash
bun run --cwd packages/cli dev -- calibrate ./tmp/telemetry.csv --input-format csv --format json
```
