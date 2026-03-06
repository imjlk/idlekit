# idlekit

Bun workspace 기반의 범용 경제 시뮬레이터입니다.

- `@idlekit/core`: 엔진 어댑터, 화폐 정책, 시나리오 컴파일, 시뮬레이션, 분석, 리포트
- `@idlekit/money`: 화폐/표기/정책/직렬화 전용 라이브러리
- `@idlekit/cli`: `idk` CLI (`bunli` 기반)

## 빠른 시작

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
```

CLI 도움말:

```bash
bun run --cwd packages/cli dev -- --help
```

설치형 실행(선택):

```bash
bun link --cwd packages/cli
idk --help
```

## 가장 빠른 실행 예시

```bash
bun run --cwd packages/cli dev -- validate ../../examples/simple-linear.json
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json --duration 600 --strategy greedy
bun run --cwd packages/cli dev -- eta ../../examples/simple-linear.json --target-worth 1e5 --mode analytic
bun run --cwd packages/cli dev -- report ../../examples/simple-linear.json --include-growth true --include-ux true
bun run --cwd packages/cli dev -- init scenario --track intro --out ../../tmp/new-scenario.json
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/05-idle-design-v1.json --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --value-per-worth 0.001 --plugin ../../examples/plugins/custom-econ-plugin.ts --allow-plugin true
bun run --cwd packages/cli dev -- calibrate ./tmp/telemetry.csv --input-format csv --format json
```

Replay artifact 저장(재실행 커맨드 자동 생성):

```bash
bun run --cwd packages/cli dev -- simulate ../../examples/simple-linear.json --seed 42 --run-id smoke-001 --artifact-out ../../tmp/sim.artifact.json --format json
bun run --cwd packages/cli dev -- compare ../../examples/tutorials/01-cafe-baseline.json ../../examples/tutorials/03-cafe-compare-b.json --metric endNetWorth --artifact-out ../../tmp/compare.artifact.json --format json
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/05-idle-design-v1.json --horizons 30m,2h,24h,7d,30d,90d --step 600 --fast true --artifact-out ../../tmp/ltv.artifact.json --format json
```

튜닝 실행:

```bash
bun run --cwd packages/cli dev -- tune ../../examples/simple-linear.json --tune ../../examples/tune-simple.json
```

튜닝 회귀 비교(artifact 기반):

```bash
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
```

## 문서

- [사용 가이드](./docs/usage-guide.md)
- [가상 시나리오 설계 가이드](./docs/virtual-scenario-design.md)
- [머니 라이브러리 가이드](./docs/money-library.md)
- [튜토리얼(2트랙) 스텝바이스텝](./docs/tutorial-step-by-step.md)
- [출력 JSON 스키마](./docs/schemas/)
- [시나리오/튜닝 명세 가이드](./docs/scenario-and-tuning.md)
- [플러그인/어댑터 패턴 가이드](./docs/plugin-and-adapter.md)
- [테스트 운영 가이드](./docs/testing.md)
- [머니 라이브러리 예제](./examples/money-package/README.md)
- [어댑터 예제 프로젝트](./examples/adapter-pattern/README.md)
- [플러그인 예제 프로젝트](./examples/plugins/README.md)
- [튜토리얼 예제 세트](./examples/tutorials/README.md)

## 현재 구현 범위 메모

- `planner` 전략은 `stepOnce` 기반 롤아웃을 사용합니다.
- `compare` 명령은 현재 시나리오를 실제 실행한 측정값(endMoney/endNetWorth/droppedRate/etaToTargetWorth)으로 비교합니다.
- `idk tune` 출력은 `json` 사용을 권장합니다. (`md/csv`는 중첩 객체 가독성이 낮을 수 있음)
- `simulate --state-out/--resume`는 state 구조를 검증하고, 전략 상태를 저장/복원해 재개 결정론을 강화합니다.
