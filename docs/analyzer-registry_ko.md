# Analyzer 레지스트리

영문 원문: [analyzer-registry.md](./analyzer-registry.md)

`DX-02`는 `ModelAnalysisAdapter` 옆에 `AnalyzerRegistry`를 둔다. 모델 adapter는 그 모델 버전이 무엇을 제공할 수 있는지 말한다. Analyzer 레지스트리는 어떤 알고리즘을, 어떤 관측으로, 어떤 budget 안에서 실행하는지 말한다. 둘은 이름과 메서드 목록을 공유하지 않는다. `Model`에 메서드를 추가하지 않는다.

`growth`와 `eta`는 adapter다. `growth`는 `analyzeGrowth`를 호출하고 legacy 속도 버킷 보고서를 유지한다. adapter 버전은 `growth-report-v1`이다. `fitGrowth`를 호출하지 않는다. `eta`는 `etaSimulate` 또는 `etaAnalytic`을 호출한다. 알고리즘 버전은 `eta-estimate-v1`이다. Jev를 포함한 judge는 analyzer가 아니다.

postprocess analyzer는 이미 있는 run을 읽는다. coverage, window, cadence, metric id가 부족하면 결과는 `insufficient-data`와 재실행 계획이다. 레지스트리가 모든 postprocess body 전에 이를 검사한다. 시뮬레이션을 시작하지 않는다. 실행형 analyzer는 `RunFactory`와 명시적 budget을 받는다. `idk analyze eta`는 실행 요청이다. horizon이 `budget-duration`을 넘거나 `budget-runs`가 `0`이면 body를 호출하지 않는다. fresh run과 sample은 batch 전체에 걸쳐 예약하며, capability와 metric 조건으로 실행할 수 있는 analyzer만 예약한다. `missing-scenario` 같은 body 자체의 재실행 이유는 유지한다. `cost.freshRuns`는 `0` 또는 `1`이며, `resolveCost`로 요청마다 정할 수 있다. analytic ETA는 fresh run 비용이 없다. simulate ETA는 실제로 실행하는 길이인 `maxDurationSec`로 검사한다.

session, strategy, horizon, step, seed, 관측 요구가 같을 때만 fresh run 하나를 공유한다. horizon이 다르면 run을 나눈다. grant의 `run()`은 호출자 `RunFactory`로 그 run을 한 번 열고, 그룹의 모든 구성원이 같은 `RunResult`를 받는다. ETA처럼 `sharesRun: false`인 정의는 항상 혼자 그룹이 되고, 막힌 analyzer는 peer로 보고하지 않는다. trace cadence는 내림해서 요구보다 거칠어지지 않는다. step 하나보다 촘촘한 요구는 `insufficient-data`다. 요청하지 않은 의존은 그 의존을 끌어온 analyzer의 semantics로 실행한다. 의존이 막혔거나 `ok`로 끝나지 않으면 그 의존을 가진 analyzer는 실행하지 않는다. 중복 id, 의존 순환, 없는 의존, 불완전한 정의, 잘못된 params는 body 전에 실패한다. 결과는 id, 그다음 version으로 정렬한다.

`idk analyze <id>`는 새 명령이다. analyzer 버전은 `--analyzer-version`으로 고르며 기본값은 `1`이다. `--version`은 CLI 버전으로 남는다. 등록된 실행형 analyzer는 컴파일한 scenario와 `--budget-*` 플래그로 실행한다. 등록된 postprocess analyzer, 또는 postprocess 의존을 가진 analyzer는 `--trace-every` step마다 trace한 scenario run 하나를 `input`으로, 그 cadence의 trace supply와 함께 받는다. `--trace-every`는 step 단위 정수다. 그 run은 fresh run 하나를 쓰고 `--budget-duration` 안에 들어야 한다. 레지스트리는 남은 run을 받고, 남은 run이 없으면 analyzer는 `insufficient-data`다. 그 run은 결과의 `provenance.freshRuns`에 포함되고, until만 있는 scenario는 `--max-duration`으로 제한되며, 닿는 postprocess 요구가 모두 비어 있으면 run을 만들지 않는다. `idk analyze growth`도 같은 경로를 쓰며 `--series`와 `--window`가 params다. params는 어떤 run보다 먼저 검증한다. 관측 run과 각 analyzer run은 scenario를 따로 컴파일하므로, 상태를 가진 plugin model이나 strategy가 한 run의 상태를 다른 run으로 옮기지 않는다. supply는 `money`와 `netWorth`만 나열한다. provenance semantics는 컴파일한 scenario의 strategy, step, seed, duration에서 온다(ETA는 `--max-duration`). JSON `_meta`는 plugin digest를 기록하고, 파일을 다시 읽지 않고 컴파일한 scenario를 hash한다. `idk eta`, `idk growth`, `idk prestige-cycle`은 유지한다. custom analyzer는 호출자나 plugin이 등록한다. plugin 모듈은 여전히 `--allow-plugin`과 기존 root, sha256 검사가 필요하다. analyzer 하나 거절이 builtin을 지우지 않는다. 이 레지스트리의 core는 CLI, Jev, 파일시스템, 네트워크를 import하지 않는다.

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
