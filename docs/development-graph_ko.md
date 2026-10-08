# 개발 그래프

영어 버전: [development-graph.md](./development-graph.md)

`TC-04`는 pin된 `@ttsc/graph` `0.30.4` 서버를 이 저장소에 연결한다. bin은 `node_modules/.bin/ttsc-graph`다. 서버는 로컬 stdio 프로세스다. 소스를 원격 그래프 서비스로 올리지 않는다. `@ttsc/graph`는 root devDependency로 남는다. `@idlekit/money`, `@idlekit/core`, `@idlekit/cli`는 여기에 의존하지 않고, `idk` 번들도 이것을 import하지 않는다.

## 조회 재현

저장소 루트에서 Bun `1.4.2`으로 실행한다.

```bash
bun tools/graph-query.ts --question "Where is runScenario declared?" --request '{"type":"lookup","query":"runScenario"}'
```

`graph-query.ts`는 `ttsc-graph --cwd <root> --tsconfig tsconfig.graph.json`을 띄우고, MCP `initialize` 다음 `tools/list`에서 `inspect_typescript_graph`의 schema를 읽는다. 그 schema가 공개한 필드만 보낸다. `question`, `draft`, `review`, `request`는 schema에서 온다. live branch에 없는 필드는 프로세스를 끝낸다. 출력은 symbol, 파일, 줄이다. 선언 signature가 있는 span은 위치 뒤에 그 signature를 찍는다. trace는 node id 대신 symbol 이름으로 `from -> to` hop 줄도 찍는다. raw dump는 아니다.

`bun run graph:check`가 gate다. initialize, tool discovery, lookup, caller/callee trace, workspace source span, scratch의 rename / signature / citation, 이미 열린 세션이 읽는 signature 수정, stdin 종료를 확인한다. `--help`만으로는 통과가 아니다.

## 프로그램

`tsconfig.graph.json`은 noEmit이다. money, core, CLI 소스와 CLI scripts, 최상위 `tools/*.ts`를 포함한다. 이 프로그램의 `@ttsc/lint`는 `enabled: false`라서 evidence graph를 적용하지 않는다. 합본이 `.d.ts` 경계만 보여 주면 패키지 `tsconfig.json`이 authoritative다. root `tsconfig.json`은 없다.

## 에이전트 설정

`.mcp.json.example`은 Claude Code 프로젝트 MCP 형식이고 로컬 bin을 가리킨다. POSIX `command`는 `node_modules/.bin/ttsc-graph`다. Windows에서는 `windowsCommand`인 `node_modules/.bin/ttsc-graph.cmd`를 그 `command`에 넣고 복사한다. `.codex/config.toml.example`은 Codex 프로젝트 설정의 `command`, `args`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`이고 같은 Windows `.cmd` 경로를 적는다. 근거는 <https://learn.chatgpt.com/codex/extend/mcp> (2026-09-30). 프로젝트 로컬 파일로 복사한다. `~/.codex/config.toml`은 이 변경에서 고치지 않는다. handshake 다음에 인덱스가 만들어지므로 Codex tool timeout을 기본 60초보다 늘린다.

## 미관측

JSON/YAML 시나리오, shell과 package script, `packages/cli/src/plugin/load.ts`의 동적 플러그인 로드, `package.json` exports, bunfig preload는 checker 밖이다. 파일을 읽는다. 그래프 순위는 전체 테스트를 빼는 이유가 아니다.

## TC-04 검증

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`, commit `3e16237ec6e5b3c9a5ab6e35e3bf962ab97eef9f`에서 조회했다. generation 필드는 없었다. scratch 수정은 새 프로세스에서 다시 읽었고, 이미 열린 세션은 signature 수정 뒤 `quotaHost`를 `(): 4`로 보고했다. `bun run graph:check`는 exit 0이다. tour payload에도 아래 `runScenario`와 `stepOnce` span이 있다.

| Symbol | Span | 결과 |
|---|---|---|
| `runScenario` | `packages/core/src/sim/simulator.ts:6` | lookup |
| `stepOnce` | `packages/core/src/sim/step.ts:50` | `runScenario`에서의 forward trace와 역방향 trace |
| `compileScenario` | `packages/core/src/scenario/compile.ts:490` | lookup |
| `tickMoney` | `packages/money/src/policy/tickMoney.ts:8` | lookup. workspace 소스이며 `.d.ts` 경계가 아니다 |
| `createPlannerStrategy` | `packages/core/src/sim/strategy/planner.ts:189` | lookup. `stepOnce`까지 path hop은 0 |
| `runScenario`의 CLI caller | `packages/cli/src` | 역방향 실행 trace. 같은 config의 이후 trace가 `commands/compare.ts`, `commands/ltv.ts`, `commands/tune.ts`, `lib/designObjectives.ts`, `lib/experience.ts`를 지목했다. 32 node cap은 모든 caller가 아니다 |

`createPlannerStrategy`는 `d.stepOnce(...)`를 호출한다. 기본 인자는 `({ stepOnce } as PlannerDeps)`다. `tools/graph-preflight.ts`는 그 기본값을 함수 선언에서 읽는다. 이 그래프는 그 binding을 hop으로 돌려주지 않았다. 소스 줄이 검토 기록이다. 이 행은 통과한 call edge가 아니라 미관측이다.

같은 gate가 `fixtures/graph/base`를 임시 디렉터리로 복사했다. lookup은 `src/host.ts:5`의 `quotaHost`를 찾았다. `quotaHostRenamed`로 바꾼 뒤의 새 프로세스는 그 이름을 반환했다. 반환 타입을 `4`로 바꾸면 `details`에 보였다. `@evidence docs/spec.md#quota`를 `docs/spec.md#quota-next`로 바꾸면 `docTags` 텍스트가 바뀌고, 이전 target은 exact tag가 아니었다. stdin shutdown은 exit 0이다.

이후 조회와 `graph:check`는 node id를 저장하지 않는다. `bun run runtime:check`는 exit 0, `bun tools/analysis-baseline-check.ts`는 exit 0이다. `typecheck`, `format:check`, `test`, Linux host, CI `graph:check`는 실행하지 않았다.

## PR-01 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`, commit `d7ac8635ffae3a71fc835ac000cfc82f8c164bb6`에서 저장소 루트의 `tsconfig.graph.json`으로 조회했다. 생성 식별자는 없다. lookup은 `stepOnce`를 `packages/core/src/sim/step.ts:264`, `singleBuySize`를 `packages/core/src/sim/step.ts:53`에 둔다.

`stepOnce`의 reverse execution trace(`focus` execution, `maxDepth` 3, `maxNodes` 32)의 직접 hop은 `packages/core/src/sim/simulator.ts#runScenario`(span `simulator.ts:49`), `packages/core/src/sim/offline.ts#applyOfflineSeconds`(span `offline.ts:139`), `packages/core/src/testkit/conformance.ts#flatBulkSnapshot`, 그리고 `packages/core/src/sim/step.bulk.test.ts`의 `settlesQuotedBulkAndRejectsBadQuotes`, `runFlat`, `runBonus`다. `runScenario`를 통해 `session.ts`, `monteCarlo.ts`, `eta.ts`, `prestigeCycle.ts`, `strategy/opt/runner.ts`, CLI `compare.ts`, `ltv.ts`, `tune.ts`, `lib/designObjectives.ts`, `lib/experience.ts`에 닿았다. 32노드 상한이 모든 호출자는 아니다.

`createPlannerStrategy`는 hop이 아니었다. 여전히 `PlannerDeps`의 `d.stepOnce`를 호출한다. 그 edge는 미관측이다. 그 PR-01 트리의 소스는 `applyOfflineSeconds`가 나머지 step으로 `stepOnce`를 한 번 더 호출함을 보여 줬다. 수정 후 lookup은 `stepOnce`를 `packages/core/src/sim/step.ts:175`에 둔다. `singleBuySize`는 `packages/core/src/sim/step.ts:51`이다.

## PR-02 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `runScenario`를 `packages/core/src/sim/simulator.ts:25`, `applyOfflineSeconds`를 `packages/core/src/sim/offline.ts:94`, `nextBoundary`를 `packages/core/src/sim/timeBoundary.ts:54`, `stepOnce`를 `packages/core/src/sim/step.ts:175`에 둔다. `timeBoundaryEpsilonScale`은 `packages/core/src/sim/timeBoundary.ts:11`의 property다. 그 줄은 소스 선언이며 별도 lookup hit는 아니다.

`runScenario`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `nextBoundary`와 `packages/core/src/sim/step.ts:175`의 `stepOnce`에 닿는다. `stepOnce`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 직접 호출로 `packages/core/src/sim/simulator.ts:80`과 `packages/core/src/sim/offline.ts:162`를 가리킨다. 오프라인 나머지는 두 번째 호출이 아니라 같은 루프다. 그 호스트를 통해 `session.ts`, `monteCarlo.ts`, `eta.ts`, `prestigeCycle.ts`, `strategy/opt/runner.ts`, `conformanceRun.ts`, `simulator.time.test.ts`, CLI `compare.ts`, `ltv.ts`, `tune.ts`, `lib/designObjectives.ts`, `lib/experience.ts`에 닿았다. 32노드 상한이 모든 호출자는 아니다.

`nextBoundary`의 reverse trace는 `packages/core/src/sim/simulator.ts:60`과 `packages/core/src/sim/offline.ts:140`을 가리킨다. `createPlannerStrategy`는 여전히 `stepOnce`까지의 hop이 아니다. 호출은 `PlannerDeps`의 `d.stepOnce`다. 그 edge는 미관측이다.

## PR-03 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `createRunFactory`를 `packages/core/src/sim/runFactory.ts:338`, `cloneRunState`를 `packages/core/src/sim/runFactory.ts:161`, `simulateMonteCarlo`를 `packages/core/src/sim/monteCarlo.ts:41`에 둔다.

`createRunFactory`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/monteCarlo.ts:46`의 호출과 `packages/core/src/sim/runFactory.test.ts`를 가리킨다. `simulateMonteCarlo`를 통해 `isolatesIndependentRuns`, CLI `lib/designObjectives.ts`, `lib/experience.ts`, `commands/compare.ts`에 닿았다. 32노드 상한이 모든 호출자는 아니다.

`simulateMonteCarlo`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/core/src/sim/runFactory.ts:338`의 `createRunFactory`에 닿고, 이어서 `session.ts`와 `simulator.ts`에 닿는다. `cloneRunState`의 reverse execution trace(`maxDepth` 2, `maxNodes` 16)는 `buildInitialState` 안의 `packages/core/src/scenario/compile.ts:388`, `packages/core/src/scenario/compile.ts:491`의 `compileScenario`, 그리고 factory의 `bind`를 가리킨다. `createPlannerStrategy`는 여전히 `stepOnce`까지의 hop이 아니다. 그 edge는 미관측이다.

## PR-05 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `createObservationRecorder`를 `packages/core/src/sim/observation.ts:238`, `mergeObservations`를 `packages/core/src/sim/observation.ts:160`, `observationContract`를 `packages/core/src/sim/observation.ts:11`, `simulateSessionPattern`을 `packages/core/src/sim/session.ts:97`, `runScenario`를 `packages/core/src/sim/simulator.ts:26`에 둔다.

`createObservationRecorder`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/simulator.ts:40`과 `packages/core/src/sim/offline.ts:127`을 가리킨다. 그 호스트를 통해 `session.ts:162`, `prestigeCycle.ts:29`, `strategy/opt/runner.ts:61`, `eta.ts:70`, `monteCarlo.ts:73`, `conformanceRun.ts`, `observation.test.ts:82`, `simulator.time.test.ts:110`, CLI `compare.ts:114`, `ltv.ts:254`, `tune.ts:157`, `lib/designObjectives.ts`, `lib/experience.ts`에 닿았다. 32노드 상한이 모든 호출자는 아니다.

`mergeObservations`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/session.ts:228`을 가리킨다. `simulateSessionPattern`을 통해 `packages/core/src/sim/monteCarlo.ts:41`의 `simulateMonteCarlo`, `packages/cli/src/lib/experience.ts:226`의 `collectExperienceSnapshot`, `isolatesIndependentRuns`, `lib/designObjectives.ts`, `commands/compare.ts:174`에 닿았다.

`simulateSessionPattern`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/core/src/sim/session.ts:228`, `packages/core/src/sim/observation.ts:162`, `packages/core/src/sim/observation.ts:189`, `packages/core/src/sim/observation.ts:378`, `packages/core/src/sim/eventBuffer.ts:83`, `packages/core/src/sim/offline.ts:127`, `packages/core/src/sim/simulator.ts:40`을 포함한다. 그 span은 `stepOnce`를 가리키지 않는다. `createPlannerStrategy`의 forward execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/strategy/planner.ts` 안에 머물고 `stepOnce`를 가리키지 않는다. 그 edge는 미관측이다.

## PR-04 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `createPlannerStrategy`를 `packages/core/src/sim/strategy/planner.ts:253`, `stepOnce`를 `packages/core/src/sim/step.ts:193`, `decidePrestigeCooldown`을 `packages/core/src/sim/constraints.ts:24`, `prestigeCooldownContract`를 `packages/core/src/sim/constraints.ts:10`, `plannerSearchContract`를 `packages/core/src/sim/strategy/planner.ts:48`, `etaSimulate`를 `packages/core/src/sim/analysis/eta.ts:41`, `cmdTune`을 `packages/cli/src/commands/tune.ts:120`에 둔다.

`decidePrestigeCooldown`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/strategy/planner.ts:183`과 `packages/core/src/sim/step.ts:220`을 가리킨다. `stepOnce`를 통해 `packages/core/src/sim/simulator.ts:99`, `packages/core/src/sim/offline.ts:180`, `packages/core/src/sim/analysis/eta.ts:70`, `packages/core/src/sim/strategy/opt/runner.ts:61`에 닿았다.

`etaSimulate`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/core/src/sim/simulator.ts:27`의 `runScenario`와 `packages/core/src/sim/step.ts:193`의 `stepOnce`를 가리킨다. `cmdTune`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/cli/src/commands/tune.ts:157`, `packages/core/src/sim/strategy/opt/runner.ts:8`의 `runCandidateAndScore`, `packages/core/src/sim/strategy/opt/runner.ts:61`을 포함하고 `runScenario`를 가리킨다.

`createPlannerStrategy`의 forward execution trace(`maxDepth` 3, `maxNodes` 32)는 `decidePrestigeCooldown`을 가리키고 `packages/core/src/sim/runFactory.ts:171`의 이름 없는 span을 포함한다. `stepOnce`는 가리키지 않는다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:322`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다. reverse execution trace는 `packages/core/src/sim/strategy/builtins.ts:51`과 `packages/core/src/sim/strategy/planner.regression.test.ts:85`의 `keepsPlannerRolloutFaithful`을 가리킨다.

## PR-06 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `simulateSessionPattern`을 `packages/core/src/sim/session.ts:215`, `applyOfflineSeconds`를 `packages/core/src/sim/offline.ts:135`, `sessionClockContract`를 `packages/core/src/sim/session.ts:16`, `resolveOfflineActionPolicy`를 `packages/core/src/sim/offline.ts:110`, `assertSessionSchedule`을 `packages/core/src/sim/session.ts:145`, `keepsSessionClocksDistinct`를 `packages/core/src/sim/session.test.ts:186`에 둔다.

`simulateSessionPattern`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/monteCarlo.ts:54`, `packages/cli/src/lib/experience.ts:253`의 `collectExperienceSnapshot`, `packages/core/src/sim/session.test.ts:177`의 `runPattern`, `packages/core/src/sim/runFactory.test.ts:151`의 `isolatesIndependentRuns`, `packages/cli/src/lib/designObjectives.ts:48`의 `evaluateVisibleProgress`, `packages/cli/src/commands/compare.ts:174`를 가리킨다. 32노드 상한이 모든 호출자는 아니다.

`simulateSessionPattern`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/core/src/sim/session.ts:273`의 `applyOfflineSeconds`, `packages/core/src/sim/session.ts:326`의 `runScenario`, `packages/core/src/sim/session.ts:378`의 `mergeObservations`, `packages/core/src/sim/session.ts:227`의 `createEventBuffer`를 포함하고, 이어서 `packages/core/src/sim/offline.ts:149`, `packages/core/src/sim/simulator.ts:34`, `packages/core/src/sim/eventBuffer.ts:83`, `packages/core/src/sim/observation.ts:378`에 닿는다.

`applyOfflineSeconds`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/session.ts:273`의 `simulateSessionPattern.appendOffline`, `packages/core/src/sim/session.test.ts:186`의 `keepsSessionClocksDistinct`, `packages/core/src/sim/simulator.time.test.ts:105`의 `stopsOnTheRequestedHorizon`, `packages/core/src/sim/strategy/planner.regression.test.ts:85`의 `keepsPlannerRolloutFaithful`을 가리킨다. forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `packages/core/src/sim/offline.ts:110`의 `resolveOfflineActionPolicy`와 `packages/core/src/sim/timeBoundary.ts:70`의 `assertSimulationClock`을 가리키고 `packages/core/src/sim/step.ts:220`을 포함한다.

`createPlannerStrategy`의 forward execution trace(`maxDepth` 3, `maxNodes` 32)는 여전히 `stepOnce`를 가리키지 않는다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:322`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

## PR-07 호출자

macOS arm64, Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. lookup은 `prepareResolvedRun`을 `packages/cli/src/lib/runConfiguration.ts:331`, `resolvedRunContract`를 `packages/cli/src/lib/runConfiguration.ts:27`, `strategyCreateParams`를 `packages/core/src/scenario/compile.ts:354`, `compileScenario`를 `packages/core/src/scenario/compile.ts:545`, `keepsResolvedRunConfiguration`을 `packages/cli/src/lib/runConfiguration.test.ts:91`, `createRunFactory`를 `packages/core/src/sim/runFactory.ts:369`에 둔다.

`prepareResolvedRun`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/cli/src/lib/runConfiguration.test.ts:91`의 `keepsResolvedRunConfiguration`을 가리킨다. 명령 핸들러는 가리키지 않는다. 소스 확인상 호출은 `packages/cli/src/commands/evaluate.ts:154`, `packages/cli/src/commands/simulate.ts:159`, `packages/cli/src/commands/experience.ts:74`, `packages/cli/src/commands/ltv.ts:475`다. 그 줄은 리뷰다. 추가 graph hop이 아니다.

`prepareResolvedRun`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `resolveEffectiveEngine`, `compileScenario`, `resolveStrategySelection`, `effectiveRunHash`, `pluginDigestValues`, `stagePlan`, `openResolvedStage`, `createNumberEngine`을 가리킨다. `packages/cli/src/lib/runConfiguration.ts:311`의 이름 없는 span이 포함되며, 그 줄은 `openResolvedStage` 안의 `createRunFactory` 호출이다. trace는 `createRunFactory`라는 이름을 주지 않는다.

`createPlannerStrategy`의 forward execution trace(`maxDepth` 3, `maxNodes` 32)는 여전히 `stepOnce`를 가리키지 않는다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:322`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

`bun run graph:check`는 종료 코드 0이다. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`는 실행하지 않았다.
