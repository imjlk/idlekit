# 테스트 운영 가이드

## 1. 실행 명령

전체:

```bash
bun run typecheck
bun run test
bun run build
bun run docs:verify:quick
bun run docs:verify
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

CLI:

- list 명령 정렬/출력 스키마
- md/json/csv 렌더링

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

CI(`.github/workflows/ci.yml`)도 같은 순서(typecheck/test/build/docs quick)로 검증합니다.

## 5. 권장 커밋 단위

- `feat(core): ...` 구현
- `test(core): ...` 회귀 테스트
- `docs: ...` 사용 문서

기능 구현과 테스트/문서를 분리하면 변경 추적과 릴리즈 노트 작성이 쉬워집니다.
