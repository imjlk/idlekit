# idlekit

Bun workspace 기반의 범용 경제 시뮬레이터입니다.

- `@idlekit/core`: 엔진 어댑터, 시나리오 컴파일, 시뮬레이션, 분석, 리포트
- `@idlekit/money`: 화폐/표기/정책/직렬화 전용 라이브러리
- `@idlekit/cli`: `idk` CLI (`bunli` 기반)

## 3분 시작

처음 저장소를 열었다면 `11-my-game-v1.json`부터 실행하면 됩니다. 그 다음 단계는 `12-my-game-compare-b.json`, `13-my-game-tune.json` 순서로 이어집니다.

```bash
bun install

bun run --cwd packages/cli dev -- validate ../../examples/tutorials/11-my-game-v1.json
bun run --cwd packages/cli dev -- simulate ../../examples/tutorials/11-my-game-v1.json --format json
bun run --cwd packages/cli dev -- ltv ../../examples/tutorials/11-my-game-v1.json \
  --horizons 30m,2h,24h,7d,30d,90d \
  --step 600 \
  --fast true \
  --format json
```

설치형 실행(선택):

```bash
bun link --cwd packages/cli
idk validate examples/tutorials/11-my-game-v1.json
idk simulate examples/tutorials/11-my-game-v1.json --format json
```

내 파일 세트를 바로 만들고 싶다면:

```bash
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json
bun run --cwd packages/cli dev -- init scenario --track personal --preset builder --out ../../tmp/my-game-v1.json --name "Space Miner"
bun run --cwd packages/cli dev -- init scenario --track personal --preset session --out ../../tmp/my-session-game.json
bun run --cwd packages/cli dev -- init scenario --track personal --preset longrun --out ../../tmp/my-longrun-game.json
```

## 시작 경로

- 처음 자기 게임을 만들기: [CLI 디자이너 시작 문서](./docs/start-here-cli-designer.md)
- 명령 흐름만 빠르게 익히기: [튜토리얼(2트랙) 스텝바이스텝](./docs/tutorial-step-by-step.md)
- 재화/액션/KPI를 먼저 설계하기: [가상 시나리오 설계 가이드](./docs/virtual-scenario-design.md)
- 모든 명령을 레퍼런스로 보기: [사용 가이드](./docs/usage-guide.md)

## 예제 흐름

- 기본 시작점: [11-my-game-v1.json](./examples/tutorials/11-my-game-v1.json)
- 개인용 A/B 루프: [12-my-game-compare-b.json](./examples/tutorials/12-my-game-compare-b.json), [13-my-game-tune.json](./examples/tutorials/13-my-game-tune.json)
- 명령 체험용: [01-cafe-baseline.json](./examples/tutorials/01-cafe-baseline.json)
- 설계 예시용: [05-idle-design-v1.json](./examples/tutorials/05-idle-design-v1.json), [06-idle-design-balance-b.json](./examples/tutorials/06-idle-design-balance-b.json), [07-idle-design-tune.json](./examples/tutorials/07-idle-design-tune.json)
- 장르 분기 템플릿: [08-idle-design-city-factory.json](./examples/tutorials/08-idle-design-city-factory.json), [09-idle-design-loot-camp.json](./examples/tutorials/09-idle-design-loot-camp.json), [10-idle-design-space-port.json](./examples/tutorials/10-idle-design-space-port.json)

## 기여자/운영자 체크

저장소 품질 게이트와 운영 확인은 아래 순서로 돌리면 됩니다.

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run replay:verify
bun run release:plan
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run release:dry-run
```

## 문서

- [CLI 디자이너 시작 문서](./docs/start-here-cli-designer.md)
- [튜토리얼(2트랙) 스텝바이스텝](./docs/tutorial-step-by-step.md)
- [가상 시나리오 설계 가이드](./docs/virtual-scenario-design.md)
- [사용 가이드](./docs/usage-guide.md)
- [시나리오/튜닝 명세 가이드](./docs/scenario-and-tuning.md)
- [머니 라이브러리 가이드](./docs/money-library.md)
- [플러그인/어댑터 패턴 가이드](./docs/plugin-and-adapter.md)
- [출력 JSON 스키마](./docs/schemas/)
- [테스트 운영 가이드](./docs/testing.md)
- [릴리즈 운영 규약](./docs/release-process.md)
- [Sampo 변경 로그/릴리즈 설정](./.sampo/README.md)
- [Sampo GitHub Release Workflow](./.github/workflows/release.yml)
- [Changeset 작성 규칙](./.sampo/README.md#changeset-authoring-rules)
- [튜토리얼 예제 세트](./examples/tutorials/README.md)
- [플러그인 예제 프로젝트](./examples/plugins/README.md)
- [머니 라이브러리 예제](./examples/money-package/README.md)
- [어댑터 예제 프로젝트](./examples/adapter-pattern/README.md)

## 현재 구현 범위 메모

- `planner` 전략은 `stepOnce` 기반 롤아웃을 사용합니다.
- `compare`는 실제 실행한 측정값(`endMoney/endNetWorth/droppedRate/etaToTargetWorth`)으로 비교합니다.
- `simulate --state-out/--resume`는 state 구조를 검증하고 전략 상태를 저장/복원합니다.
- `replay verify`는 artifact의 `runId/seed/scenarioHash/gitSha/pluginDigest/resultHash`를 다시 확인합니다.
