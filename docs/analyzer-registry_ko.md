# Analyzer 레지스트리

영문 원문: [analyzer-registry.md](./analyzer-registry.md)

`DX-02`는 `ModelAnalysisAdapter` 옆에 `AnalyzerRegistry`를 둔다. 모델 adapter는 그 모델 버전이 무엇을 제공할 수 있는지 말한다. Analyzer 레지스트리는 어떤 알고리즘을, 어떤 관측으로, 어떤 budget 안에서 실행하는지 말한다. 둘은 이름과 메서드 목록을 공유하지 않는다. `Model`에 메서드를 추가하지 않는다.

`growth`와 `eta`는 adapter다. `growth`는 `analyzeGrowth`를 호출하고 legacy 속도 버킷 보고서를 유지한다. adapter 버전은 `growth-report-v1`이다. `fitGrowth`를 호출하지 않는다. `eta`는 `etaSimulate` 또는 `etaAnalytic`을 호출한다. 알고리즘 버전은 `eta-estimate-v1`이다. Jev를 포함한 judge는 analyzer가 아니다.

postprocess analyzer는 이미 있는 run을 읽는다. coverage, window, cadence, metric id가 부족하면 결과는 `insufficient-data`와 재실행 계획이다. 시뮬레이션을 시작하지 않는다. 실행형 analyzer는 `RunFactory`와 명시적 budget을 받는다. `idk analyze eta`는 실행 요청이다. horizon이 `budget-duration`을 넘거나 `budget-runs`가 `0`이면 body를 호출하지 않는다.

session, strategy, horizon, step, seed, 관측 요구가 같을 때만 fresh run 하나를 공유한다. horizon이 다르면 run을 나눈다. 중복 id, 의존 순환, 없는 의존, 잘못된 params는 body 전에 실패한다. 결과는 id, 그다음 version으로 정렬한다.

`idk analyze <id>`는 새 명령이다. analyzer 버전은 `--analyzer-version`으로 고르며 기본값은 `1`이다. `--version`은 CLI 버전으로 남는다. `idk eta`, `idk growth`, `idk prestige-cycle`은 유지한다. custom analyzer는 호출자나 plugin이 등록한다. plugin 모듈은 여전히 `--allow-plugin`과 기존 root, sha256 검사가 필요하다. analyzer 하나 거절이 builtin을 지우지 않는다. 이 레지스트리의 core는 CLI, Jev, 파일시스템, 네트워크를 import하지 않는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 검증

아래 명령은 이 worktree에서 macOS arm64, Bun 1.4.2, ttsc 0.30.4로 실행했다. `contracts:check`는 미실행이다.

| 명령 | 종료 |
|---|---|
| `packages/core`에서 `bun test src/sim/analysis/analyzers.test.ts` | 0 |
| `packages/cli`에서 `bun test --timeout 60000 src/commands/analyze.test.ts src/plugin/load.test.ts` | 0 |
| `packages/cli`에서 `bun run generate`와 `bun run generate:check` | 0 |
| `bun run evidence:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run format:check` | 0 |
| `bun run public:check` | 0 |
