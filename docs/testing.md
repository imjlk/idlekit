# 테스트 운영 가이드

## 1. 실행 명령

전체:

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run bench:sim
bun run bench:sim:suite
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
```

패키지별:

```bash
bun run --cwd packages/core test
bun run --cwd packages/cli test
```

## 2. 현재 테스트 범위

Core:

- `stepOnce` 전이 규칙
- `runScenario` 루프/trace/actionsLog
- `compileScenario` 전략 기본 파라미터 주입
- `greedy`/`planner` 결정론과 기본 선택
- `simState` 구조 검증/역직렬화 에러 매핑
- `scripted` 전략 상태 snapshot/restore(재개 결정론)

CLI:

- list 명령 정렬/출력 스키마
- md/json/csv 렌더링
- `simulate` 저장/재개 + 오프라인/fast/strategy 조합 회귀
- `simulate/compare/ltv/tune` replay artifact 표준 포맷 검증
- `replay verify` 재실행 드리프트 검증
- 출력 계약(schema) 검증: `output-schema.test.ts`
- artifact 계약(schema) 검증: `artifact-schema.test.ts`
- contract 호환성 검증: `outputMeta.compat.test.ts`
- `calibrate` CSV 파서 엣지 케이스 + correlation 추정 + confidence/shrinkage 진단

## 3. 변경 시 필수 테스트 추가 규칙

시뮬레이션 루프/결제 정책 변경:

- `packages/core/src/sim/step.test.ts`
- `packages/core/src/sim/simulator.test.ts`

전략/목표 변경:

- 해당 전략 테스트(`greedy.test.ts`, `planner.test.ts`)
- objective/튜너 변경 시 `opt` 계열 테스트 파일 추가

CLI 출력 변경:

- `packages/cli/src/commands/listing.test.ts` 확장
- 필요한 경우 `writeOutput` 단위 테스트 추가

## 4. 회귀 방지 체크리스트

PR/커밋 전에:

1. `bun run typecheck`
2. `bun run test`
3. `bun run build`
4. `bun run docs:verify:quick`

CI(`.github/workflows/ci.yml`)는 typecheck/test/build + docs quick + 성능 체크 + KPI A/B 리포트 + KPI 리그레션 게이트를 실행합니다.

성능 리그레션은 `bench:sim:check`에서 평균/`p95` 실행시간 임계값으로 추가 검증합니다.
`tools/bench-sim.ts`는 시나리오 경로를 저장소 루트 기준 절대경로로 정규화해 cwd 차이로 인한 오탐을 줄입니다.
다중 시나리오 성능 스모크는 `bench:sim:suite`로 수행하며,
`bench:sim:suite:check`는 평균/p95 + RSS delta 임계값까지 게이트합니다.
suite는 `30m/2h/24h/7d/30d/90d` 장기 구간 시나리오를 포함합니다.

## 5. 권장 커밋 단위

- `feat(core): ...` 구현
- `test(core): ...` 회귀 테스트
- `docs: ...` 사용 문서

기능 구현과 테스트/문서를 분리하면 변경 추적과 릴리즈 노트 작성이 쉬워집니다.
