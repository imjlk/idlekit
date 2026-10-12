# 시나리오 inspect

영문 원문: [scenario-inspect.md](./scenario-inspect.md)

`DX-03`은 `idk inspect <scenario> --format json|md`를 더한다. 실행될 resolved plan을 설명한다. `doctor`가 아니다. 기본 경로는 tick하지 않고, Jev를 호출하지 않고, 네트워크를 쓰지 않는다.

설명과 실제 실행은 `prepareResolvedRun`의 `planFor`를 공유한다. stage plan을 읽고 `fresh`는 호출하지 않는다. `scenario.engine`은 metadata다. 기본 엔진은 `number`다. `breakInfinity`는 명시적 플래그이며 `Number`로 통과시키지 않는다. `breakEternity`는 거절된다. JSON 보고서는 남고 프로세스는 0이 아닌 코드로 끝난다.

고정 duration은 `nextBoundary`로 마지막 짧은 틱까지 센다. `durationSec`가 없는 until-only 시계의 step 수는 `unknown`이다. 100만 틱을 넘는 수는 `unknown`이고, 시나리오 duration이 아니라 일정을 도는 session stage도 `unknown`이다. planner expansion은 horizon, beam, branch 상한에서 나온 상한이며, 각 노드의 action 옆에 대기 branch를 더하고 rollout budget 256까지로 자른다. `measuredDurationSec`는 null이다. 경고는 budget 제안이며 측정된 소요 시간이 아니다. `sim.eventLog`가 없으면 runner처럼 켜진 무제한 로그로 보고, cadence 없는 trace는 매 step 기록한다. 각 stage는 실행할 fast 모드와 그 출처(command 또는 scenario)를 적는다. inspect는 시나리오를 compile하지 않고 stage 계획만 읽으므로 model이나 strategy factory를 만들지 않는다. experience와 같은 `--session-pattern`, `--days` 플래그를 쓰고, `--step`은 유한한 양수여야 한다. 내장 id를 대체한 plugin도 load된 것으로 보고하고, plugin strategy와 analyzer는 `strategy:<id>`, `analyzer:<id>@<version>`으로 적는다. 건너뛴 plugin만 가진 model이나 strategy의 시나리오도 보고서를 받고, `plugin-skipped`가 그것을 적는다. plugin `planner`에는 내장 planner 상한을 붙이지 않는다. decimal 경고는 엔진에 들어가는 구역만 읽고 `meta`는 읽지 않는다. trace가 있는 실행은 trace cadence만큼 촘촘한 관측 창을 제공한다. model과 strategy id는 식별자이므로 decimal은 params에서만 읽는다. custom engine은 `numericDomain.exact: "unknown"`이며 decimal 경고도 받는다. 보고서에는 evaluate와 ltv가 여는 ltv stage도 들어가고 그 수는 unknown이다. compileScenario가 거부할 `untilExpr`는 계획 단계에서도 거부한다.

분석 adapter가 없으면 builtin 모델 capability는 `unknown`이다. `unsupported`는 선언된 불가이다. 로드하지 않은 plugin은 `unknown`이다. `--resolve-plugins`만 plugin을 import하며, 기존의 allow, root, sha256 검사 뒤에만 한다. 이 모드는 사용자 코드가 실행될 수 있다고 경고한다. 보고서는 factory id와 version을 남긴다. plugin 원문, secret, 환경 값은 넣지 않는다.

진단은 code와 근거 값을 가진다. 잘못된 엔진은 error다. decimal range, missing reset, 부족한 관측, 단위 불일치, 무제한 trace, planner 비용은 warning이며 종료 코드는 0이다.

`DX-02`에 등록된 analyzer는 관측 요구와, 설정된 supply가 그 요구를 충족하는지만 붙인다. analyzer body는 실행하지 않는다.

Node.js와 browser 런타임은 v1 호환 계약에 포함되지 않는다.

## 검증

아래 명령은 이 worktree에서 macOS arm64, Bun 1.4.2, ttsc 0.30.4로 실행했다. `contracts:check`는 미실행이다.

| 명령 | 종료 |
|---|---|
| `packages/core`에서 `bun test --timeout 120000 src/sim/analysis/inspect.test.ts` | 0 |
| `packages/cli`에서 `bun run generate`와 `bun run generate:check` | 0 |
| `packages/cli`에서 `bun test --timeout 60000 src/commands/inspect.test.ts` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |

첫 core 실행은 1로 끝났다. 첫 두 CLI 실행은 1로 끝났다. 첫 `evidence:check`는 placeholder review 때문에 2로 끝났다. 다시 실행한 값은 0이다. `graph:check`는 `createPlannerStrategy`에서 `stepOnce`까지 hops 0으로 관측하지 않았다. `contracts:check`는 미실행이다.
