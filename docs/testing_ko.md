# 테스트 운영 가이드

v1 공식 지원 범위는 Bun `>=1.3`입니다. Node.js와 브라우저 런타임은 v1 호환성 계약에 포함하지 않습니다.

## 1. 실행 명령

전체:

```bash
bun run typecheck
bun run runtime:check
bun run test
bun run test:conformance
bun run test:conformance:extended
bun run build
bun run docs:verify:quick
bun run docs:verify
bun run templates:check
bun run install:smoke
bun run readme:smoke
bun run review:smoke
bun run compat:check
bun run replay:verify
bun run bench:sim
bun run bench:sim:suite
bun run bench:sim:check
bun run bench:sim:suite:check
bun run kpi:report
bun run kpi:regress
bun run tune:regress --baseline ./tmp/tune-baseline.json --current ./tmp/tune-latest.json --tolerance 0.05
bun tools/analysis-baseline-check.ts
```

패키지별:

```bash
bun run --cwd packages/core test
bun run --cwd packages/cli test
```

## 2. 현재 테스트 범위

테스트 런타임 규약:

- 테스트 러너는 `bun:test`를 기본으로 사용합니다.
- CLI 테스트의 파일/프로세스 I/O는 가능한 한 `packages/cli/src/testkit/bun.ts`를 사용합니다.
- `packages/*/src` 비테스트 런타임 코드와 `tools/` 스크립트는 `node:` import 대신 Bun API를 우선 사용합니다.
- 이 규칙은 `bun run runtime:check`로 확인합니다.
- Node.js/브라우저 실행은 별도 명시가 없는 한 v1 공식 지원 범위에 포함하지 않습니다.

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
- `init scenario` preset matrix + `--name` 규칙 검증
- CLI 에러 계약 검증: `cli-error-contract.test.ts`
- 출력 계약(schema) 검증: `output-schema.test.ts`
- artifact 계약(schema) 검증: `artifact-schema.test.ts`
- contract 호환성 검증: `outputMeta.compat.test.ts`
- `calibrate` CSV 파서 엣지 케이스 + correlation 추정 + confidence/shrinkage 진단
- `review doctor`, `review evaluate`, `review compare` interactive smoke

## 2-1. Interactive review smoke

`bun run review:smoke`는 사람용 review 경로를 확인하는 maintainer 전용 체크입니다.

- lazy-loaded `review doctor`, `review evaluate`, `review compare`를 테스트 renderer에 실제로 mount합니다.
- 공통 loading shell이 먼저 뜨는지 확인합니다.
- lazy follow-up work 이후에도 각 dashboard가 안정적으로 내용을 표시하는지 확인합니다.

## 2-2. Compatibility fixture 정책

compatibility fixture는 `fixtures/compat/v1/` 아래에 둡니다.

- additive contract 확장일 때만 fixture를 추가
- 기존 fixture 수정은 compatibility 정책 재검토 없이는 하지 않음
- fixture를 추가하거나 갱신한 뒤에는 `bun run compat:check` 실행

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
2. `bun run runtime:check`
3. `bun run test`
4. `bun run build`
5. `bun run docs:verify:quick`
6. `bun run templates:check`
7. `bun run install:smoke`

CI(`.github/workflows/ci.yml`)는 typecheck/runtime import check/test/build + replay verify gate + 성능 체크 + KPI A/B 리포트 + KPI 리그레션 게이트를 실행합니다. 문서 검증은 `.github/workflows/docs-verify.yml`의 `docs:verify` 한 번으로 돌고, quick 모드는 그 안에 포함됩니다.
패키지 배포 스모크는 `bun run install:smoke`로 tarball 설치 + Bun import + `idk validate`까지 함께 확인합니다.

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

## 6. 분석 기준

`265c6ed`에서 저장소 compiler는 `tsc`였고, 테스트는 `bun test`였으며, CLI 번들은 Bunli였다. Root Bun은 `1.3.10`이었고 CI는 Bun `1.3.9`를 pin했다. `TC-01`이 CI를 Bun `1.3.10`으로 맞추고 ttsc를 pin한다. `TC-02`는 패키지 check와 money/core emit을 `ttsc`로 실행하고, 같은 변환을 Bun source, `bun test`, CLI bundle, packed artifact에 적용한다. 현재 pin은 [툴체인 pin](./toolchain_ko.md)에 있다.

`bun tools/analysis-baseline-check.ts`는 [소스 감사](./implementation/source-audit_ko.md)가 인용한 경로와 현재 host pin을 확인한다.

`evidence:check`, `evidence:smoke`, `format:check`는 `TC-03` 이후의 저장소 명령이다. `graph:check`는 `TC-04` 명령이다. `test:conformance`는 `DX-01` 명령이다. `contracts:generate`와 `contracts:check`는 아직 아니다. `toolchain:doctor`와 `toolchain:prepare`는 `TC-01` host 명령이다.

## 시뮬레이션 적합성

`packages/core/src/testkit/conformance.ts`와 `packages/money/src/testkit/compareAmounts.ts`는 테스트 전용이다. 패키지 barrel은 이들을 export하지 않고, production build는 `src/testkit`을 제외한다.

`PR-01`은 동등성을 선언한 고정 단가에 `checkBulk`를 쓰고, 중간 보너스가 있는 모델은 선언하지 않는다. 테스트 seed는 사례 생성을 맡고, 게임 RNG seed는 그 스트림을 소비하지 않는 `gameSeedForCase`로 따로 만든다. 실패는 더 작은 값으로 축소되며 `fixtures/conformance/shrink-gap.json`으로 같은 경로를 다시 실패시킨다. 같은 tick 일정의 replay/resume, 관측 보관과 경제 상태의 분리, 상수 수입에서만 같은 step 비교, 동등성을 선언한 bulk, 부채를 금지한 결제, 유한 log 거리의 엔진 비교만 검사한다. 수식 초와 실행된 `etaSimulate`/`etaAnalytic` 결과는 라벨로 구분한다. `test:conformance`는 짧은 사례 수이고, `test:conformance:extended`는 주간 확장 corpus다. 변환/evidence/graph가 빠진 확인은 작업 트리를 고치지 않는 임시 복사본으로 한다.

DX-01 검증은 macOS arm64, Bun `1.3.10`, `ttsc 0.30.4 (Version 7.0.2)`, commit `87ae394de944c86b2c59c62c257414ea3f814e5e`(부모 `51dfd43bccfc7d29d18c5b51cb463d66c34d0c51`)에서 했다. `evidence:check`, `format:check`, money/core `typecheck`와 `build`, `analysis-baseline-check`, `runtime:check`는 종료 코드 0이다. 그 커밋의 `bun run test:conformance`는 적합성 단위 테스트와 shrink replay가 0이었고, negative runner의 `transform-present`가 `TtscUnstableGenerationError`로 끝나 스크립트 전체는 1이다. 짧은 게이트는 이제 단위 테스트와 shrink replay만 실행하고, negative runner는 `bun run test:conformance:negative`로 따로 둔다. 전체 `bun run test`, `bun run build`, `test:conformance:extended`는 미실행이다. Graph lookup은 project `tsconfig.graph.json`에서 `conformanceGeneratorVersion`을 `packages/core/src/testkit/conformance.ts:10`에서 찾았고, reverse trace는 `conformance.test.ts:191`의 테스트에 닿았다. 생성 식별자는 없었다.

이후 분석 작업의 공유 의미는 [분석 계약](./adr/analysis-contracts_ko.md)에 있다.
