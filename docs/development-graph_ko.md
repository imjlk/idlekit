# 개발 그래프

영어 버전: [development-graph.md](./development-graph.md)

`TC-04`는 pin된 `@ttsc/graph` `0.30.4` 서버를 이 저장소에 연결한다. bin은 `node_modules/.bin/ttsc-graph`다. 서버는 로컬 stdio 프로세스다. 소스를 원격 그래프 서비스로 올리지 않는다. `@ttsc/graph`는 root devDependency로 남는다. `@idlekit/money`, `@idlekit/core`, `@idlekit/cli`는 여기에 의존하지 않고, `idk` 번들도 이것을 import하지 않는다.

## 조회 재현

저장소 루트에서 Bun `1.3.10`으로 실행한다.

```bash
bun tools/graph-query.ts --question "Where is runScenario declared?" --request '{"type":"lookup","query":"runScenario"}'
```

`graph-query.ts`는 `ttsc-graph --cwd <root> --tsconfig tsconfig.graph.json`을 띄우고, MCP `initialize` 다음 `tools/list`에서 `inspect_typescript_graph`의 schema를 읽는다. 그 schema가 공개한 필드만 보낸다. `question`, `draft`, `review`, `request`는 schema에서 온다. live branch에 없는 필드는 프로세스를 끝낸다. 출력은 symbol, 파일, 줄이다. raw dump도 node id도 아니다.

`bun run graph:check`가 gate다. initialize, tool discovery, lookup, caller/callee trace, workspace source span, scratch의 rename / signature / citation을 새 프로세스로 확인하고, stdin을 닫아 종료한다. `--help`만으로는 통과가 아니다.

## 프로그램

`tsconfig.graph.json`은 noEmit이다. money, core, CLI 소스(CLI는 `jsx: react-jsx`, `jsxImportSource: @opentui/react`)와 CLI scripts, 생성된 `.bunli`, 최상위 `tools/*.ts`를 포함한다. 이 프로그램의 `@ttsc/lint`는 `enabled: false`라서 evidence graph를 적용하지 않는다. 합본이 `.d.ts` 경계만 보여 주면 패키지 `tsconfig.json`이 authoritative다. root `tsconfig.json`은 없다.

## 에이전트 설정

`.mcp.json.example`은 Claude Code 프로젝트 MCP 형식이고 로컬 bin을 가리킨다. `.codex/config.toml.example`은 Codex 프로젝트 설정의 `command`, `args`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`이다. 근거는 <https://learn.chatgpt.com/codex/extend/mcp> (2026-09-30). 프로젝트 로컬 파일로 복사한다. `~/.codex/config.toml`은 이 변경에서 고치지 않는다. handshake 다음에 인덱스가 만들어지므로 Codex tool timeout을 기본 60초보다 늘린다.

## 미관측

JSON/YAML 시나리오, shell과 package script, `packages/cli/src/plugin/load.ts`의 동적 플러그인 로드, `package.json` exports, bunfig preload는 checker 밖이다. 파일을 읽는다. 그래프 순위는 전체 테스트를 빼는 이유가 아니다.

## TC-04 검증

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. generation 필드는 없었다. scratch 수정은 새 프로세스에서 다시 읽었다. `bun run graph:check`는 exit 0이다.

| Symbol | Span | 결과 |
|---|---|---|
| `runScenario` | `packages/core/src/sim/simulator.ts:6` | lookup |
| `stepOnce` | `packages/core/src/sim/step.ts:50` | `runScenario`에서의 forward trace와 역방향 trace |
| `compileScenario` | `packages/core/src/scenario/compile.ts:490` | lookup |
| `tickMoney` | `packages/money/src/policy/tickMoney.ts:8` | lookup. workspace 소스이며 `.d.ts` 경계가 아니다 |
| `createPlannerStrategy` | `packages/core/src/sim/strategy/planner.ts:189` | lookup. `stepOnce`까지 path hop은 0 |
| `runScenario`의 CLI caller | `packages/cli/src` | 역방향 실행 trace. 같은 config의 이후 trace가 `commands/compare.ts`, `commands/ltv.ts`, `commands/tune.ts`, `lib/designObjectives.ts`, `lib/experience.ts`를 지목했다. 32 node cap은 모든 caller가 아니다 |

`createPlannerStrategy`는 `d.stepOnce(...)`를 호출한다. 기본 인자는 `({ stepOnce } as PlannerDeps)`다. 이 그래프는 그 binding을 hop으로 돌려주지 않았다. 소스 줄이 검토 기록이다. 이 행은 통과한 call edge가 아니라 미관측이다.

같은 gate가 `fixtures/graph/base`를 임시 디렉터리로 복사했다. lookup은 `src/host.ts:5`의 `quotaHost`를 찾았다. `quotaHostRenamed`로 바꾼 뒤의 새 프로세스는 그 이름을 반환했다. 반환 타입을 `4`로 바꾸면 `details`에 보였다. `@evidence docs/spec.md#quota`를 `docs/spec.md#quota-next`로 바꾸면 `docTags` 텍스트가 바뀌고, 이전 target은 exact tag가 아니었다. stdin shutdown은 exit 0이다.

이후 조회와 `graph:check`는 node id를 저장하지 않는다. `bun run runtime:check`는 exit 0, `bun tools/analysis-baseline-check.ts`는 exit 0이다. `typecheck`, `format:check`, `test`, Linux host, CI `graph:check`는 실행하지 않았다.

## PR-01 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. 결제 수정 전 `stepOnce`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 직접 호출로 `packages/core/src/sim/simulator.ts:49`(`runScenario`)와 `packages/core/src/sim/offline.ts:139`(`applyOfflineSeconds`)를 가리켰다. 그 호스트를 통해 `session.ts`, `monteCarlo.ts`, `eta.ts`, `prestigeCycle.ts`, `strategy/opt/runner.ts`, CLI `compare.ts`, `ltv.ts`, `tune.ts`, `lib/designObjectives.ts`, `lib/experience.ts`에 닿았다. 32노드 상한이 모든 호출자는 아니다.

`createPlannerStrategy`는 hop이 아니었다. 여전히 `PlannerDeps`의 `d.stepOnce`를 호출한다. 그 edge는 미관측이다. 소스를 보면 `applyOfflineSeconds`는 나머지 step으로 `packages/core/src/sim/offline.ts:162`에서 `stepOnce`를 한 번 더 호출한다. 수정 후 lookup은 `stepOnce`를 `packages/core/src/sim/step.ts:175`에 둔다. `singleBuySize`는 `packages/core/src/sim/step.ts:51`이다.
