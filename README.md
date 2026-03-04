# idlekit

Bun workspace 기반의 범용 경제 시뮬레이터입니다.

- `@idlekit/core`: 엔진 어댑터, 화폐 정책, 시나리오 컴파일, 시뮬레이션, 분석, 리포트
- `@idlekit/cli`: `idk` CLI (`bunli` 기반)

## 빠른 시작

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
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
- [튜토리얼(2트랙) 스텝바이스텝](./docs/tutorial-step-by-step.md)
- [시나리오/튜닝 명세 가이드](./docs/scenario-and-tuning.md)
- [플러그인/어댑터 패턴 가이드](./docs/plugin-and-adapter.md)
- [테스트 운영 가이드](./docs/testing.md)
- [어댑터 예제 프로젝트](./examples/adapter-pattern/README.md)
- [플러그인 예제 프로젝트](./examples/plugins/README.md)
- [튜토리얼 예제 세트](./examples/tutorials/README.md)

## 현재 구현 범위 메모

- `planner` 전략은 `stepOnce` 기반 롤아웃을 사용합니다.
- `compare` 명령은 현재 시나리오를 실제 실행한 측정값(endMoney/endNetWorth/droppedRate/etaToTargetWorth)으로 비교합니다.
- `idk tune` 출력은 `json` 사용을 권장합니다. (`md/csv`는 중첩 객체 가독성이 낮을 수 있음)
