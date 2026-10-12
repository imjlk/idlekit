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

`.mcp.json.example`은 Claude Code 프로젝트 MCP 형식이고 로컬 bin을 가리킨다. POSIX `command`는 `node_modules/.bin/ttsc-graph`다. Windows에서는 `windowsCommand`인 `node_modules/.bin/ttsc-graph.exe`를 그 `command`에 넣고 복사한다. `.codex/config.toml.example`은 Codex 프로젝트 설정의 `command`, `args`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`이고 같은 Windows `.exe` 경로를 적는다. 근거는 <https://learn.chatgpt.com/codex/extend/mcp> (2026-09-30). 프로젝트 로컬 파일로 복사한다. `~/.codex/config.toml`은 이 변경에서 고치지 않는다. handshake 다음에 인덱스가 만들어지므로 Codex tool timeout을 기본 60초보다 늘린다.

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

## TC-05 호출자

commit `8bdef6fdc6c9f763e4f4e946ff16c67d88d129c4`에서 macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`로 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `validateScenarioStructure`를 `packages/core/src/scenario/scenarioContract.ts:64`, `buildContractDocument`를 `packages/core/src/scenario/scenarioContract.ts:205`, `writeContracts`를 `tools/contract-files.ts:42`, `createPlannerStrategy`를 `packages/core/src/sim/strategy/planner.ts:286`, `stepOnce`를 `packages/core/src/sim/step.ts:356`에 둔다. 이 revision에서 `validateScenarioV1` lookup은 그 이름을 돌려주지 않았다. 소스 확인상 선언은 `packages/core/src/scenario/validate.ts:777`이다.

`validateScenarioStructure`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/scenario/scenarioContract.probe.ts:17`, `packages/core/src/scenario/scenarioContract.probe.ts:18`, `packages/core/src/scenario/scenarioContract.test.ts:214`의 `keepsSemanticValidation`을 가리킨다. 같은 trace는 `packages/core/src/scenario/scenarioContract.test.ts:218`과 `packages/core/src/scenario/scenarioContract.test.ts:300` span을 포함한다.

`buildContractDocument`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `tools/contract-files.ts:34`의 `renderedContracts`, `packages/core/src/scenario/scenarioContract.test.ts:109`의 `keepsTypedContractSingleSource`, `tools/contract-files.ts:42`의 `writeContracts`, `tools/contract-files.ts:49`의 `compareContracts`, `tools/contracts-check.ts:15`의 호출을 가리킨다.

`writeContracts`의 reverse execution trace(`maxDepth` 2, `maxNodes` 16)는 선언만 가리킨다. 소스 확인상 호출은 `tools/generate-contracts.ts:15`다. 그 줄은 리뷰다. graph hop이 아니다. `contracts:generate`와 `contracts:check` 패키지 스크립트는 graph에 없다.

`createPlannerStrategy`의 forward execution trace(`maxDepth` 3, `maxNodes` 32)는 여전히 `stepOnce`를 가리키지 않는다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:358`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

`bun run graph:check`는 종료 코드 0이다. 이 변경에서 `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`는 실행하지 않았다.

## PR-08 호출자

macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `buildAnalysisArtifact`를 `packages/core/src/sim/analysis/metrics.ts:332`에 둔다. 같은 lookup은 `packages/core/src/sim/analysis/contracts.ts:135`의 `buildAnalysisArtifactJsonSchema`, `tools/contract-files.ts:53`의 `buildAnalysisContractDocument`, `packages/core/src/sim/analysis/contracts.ts:141`의 `analysisArtifactJsonSchema`도 가리킨다. `AnalysisArtifactV1`은 `packages/core/src/sim/analysis/contracts.ts:99`, `parseAnalysisArtifact`는 `packages/core/src/sim/analysis/contracts.ts:131`에 선언되어 있다. `evaluateGoalForEta` lookup은 `packages/core/src/sim/analysis/metrics.ts:278`과 함께 `packages/cli/src/lib/designObjectives.ts`의 `evaluateMilestoneTime`, `evaluateVisibleProgress`를 돌려준다. 뒤의 둘은 이 계약이 아니다.

`evaluateGoal`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/core/src/sim/analysis/metrics.ts:278`의 `evaluateGoalForEta`, `metrics.ts:286`의 `evaluateGoalForExperiment`, `metrics.ts:294`의 `evaluateGoalForCheck`, `analysisContract.test.ts:61`의 `agree`, `analysisContract.test.ts:89`의 `sharesDefaultGoalEvaluation`, `analysisContract.test.ts:144`의 `registersCustomMetric`, `analysisContract.test.ts:237`의 `roundTripsAnalysisArtifact`를 가리킨다.

`buildAnalysisArtifact`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `analysisContract.test.ts:237`의 `roundTripsAnalysisArtifact`와 `analysisContract.test.ts:292`의 호출을 가리킨다.

이 변경의 후속 실행은 macOS arm64, Bun `1.4.2`이다. `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`는 종료 코드 0이다. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run readme:smoke`, `bun run install:smoke`, `bun run review:smoke`도 종료 코드 0이다. `packages/core`의 `bun test --timeout 120000 src/sim/analysis/analysisContract.test.ts`와 `bun test --cwd packages/cli --timeout 120000 src/io/analysisArtifact.test.ts`도 종료 코드 0이다. 계약 fixture에는 RNG가 없다. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, Linux host, CI는 실행하지 않았다.

## PR-09 호출자

macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `etaAnalytic`을 `packages/core/src/sim/analysis/eta.ts:441`, `etaSimulate`를 `eta.ts:381`, `etaSecondsFromEngineRatio`를 `eta.ts:140`에 둔다. `etaAnalytic` lookup은 `eta.ts:56`의 `EtaEstimateV1`, `eta.ts:179`의 `etaGoalForTarget`, `tools/contract-files.ts:62`의 `etaSourceDigests`도 가리킨다. 같은 lookup이 돌려주는 `evaluateGoalForEta`는 이 추정이 아니다. lookup은 `readEtaOutput`을 `packages/cli/src/io/etaOutput.ts:7`에 둔다. 같은 lookup의 다른 `read*` 이름은 이 reader가 아니다.

`etaAnalytic`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `eta.semantics.test.ts:85`의 `keepsEngineRatioBeforeNarrowing`, `eta.semantics.test.ts:137`의 `separatesExactAndLocalEta`, `eta.semantics.test.ts:225`의 `censorsUnreachedHorizon`, `packages/core/src/testkit/conformance.test.ts:2017`의 `keepsFormulaSecondsApartFromExecutedEtaResults`를 가리킨다. CLI command는 가리키지 않는다. 소스 확인상 호출은 `packages/cli/src/commands/eta.ts:91`과 `eta.ts:103`이다. 그 줄은 리뷰다. graph hop이 아니다.

`etaSimulate`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `eta.ts:441`의 `etaAnalytic`과 같은 네 테스트를 가리킨다. CLI command는 가리키지 않는다.

`etaSecondsFromEngineRatio`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `eta.ts:253`의 `analyticEstimate`, `eta.ts:381`의 `etaSimulate`, `eta.ts:441`의 `etaAnalytic`, 같은 네 테스트를 가리킨다.

`etaAnalytic`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `analyticEstimate`, `etaSimulate`, `etaSecondsFromEngineRatio`, `etaGoalForTarget`, `metrics.ts:236`의 `evaluateGoal`, `simulator.ts:28`의 `runScenario`, `types.ts:81`의 `assertHorizonReached`, `types.ts:91`의 `runElapsedSec`, `types.ts:205`의 `Model.income`, `types.ts:217`의 `Model.netWorth`에 닿는다.

`etaSimulate`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `simulator.ts:28`의 `runScenario`, `step.ts:356`의 `stepOnce`, `timeBoundary.ts:55`의 `nextBoundary`, `timeBoundary.ts:71`의 `assertSimulationClock`, `assertHorizonReached`, `runElapsedSec`에 닿는다. 위에 적은 이름이 그 trace의 모든 hop은 아니다.

`readEtaOutput`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 선언만 가리킨다. 소스 확인상 호출은 `packages/cli/src/io/etaOutput.test.ts:47`이다. 그 줄은 리뷰다. graph hop이 아니다.

`createPlannerStrategy`에서 `stepOnce`로 가는 trace(`maxDepth` 3, `maxNodes` 32)는 양 끝 symbol만 나열하고 hop은 없다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:358`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

RNG는 없다. PR-09 fixture는 `packages/core/src/sim/analysis/eta.semantics.test.ts`의 리터럴이다. 이전 사례는 `eta.test.ts`에 남는다. 그 파일의 `it.each` 제목은 printf 형식이라 정적 runner 등록이 아니다. 이 변경의 후속 실행은 macOS arm64, Bun `1.4.2`이다. `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, `bun run test:conformance`, `bun run public:check`는 종료 코드 0이다. 첫 `bun run readme:smoke`는 pack 중에 CLI build가 `packages/core/package.json` 변경을 보아 종료 코드 1이다. 재실행은 종료 코드 0이다. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run install:smoke`, `bun run review:smoke`도 종료 코드 0이다. `bun test --cwd packages/core --timeout 120000 src/sim/analysis/eta.semantics.test.ts`와 `bun test --cwd packages/cli --timeout 120000 src/io/etaOutput.test.ts`도 종료 코드 0이다. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, Linux host, CI는 실행하지 않았다.

## PR-10 호출자

macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `executeResetCycles`를 `packages/core/src/sim/analysis/resetCycle.ts:269`, `applyDecisions`를 `packages/core/src/sim/step.ts:403`, `emitCommittedResets`를 `packages/core/src/sim/observation.ts:94`, `resetAdapterFor`를 `resetCycle.ts:229`, `stepOnce`를 `step.ts:618`에 둔다. `createPlannerStrategy` lookup은 `packages/core/src/sim/strategy/planner.ts:286`이다. `applyDecisions` lookup이 함께 돌려주는 `applyOfflineSeconds`, `applySheetCsv`, `applyAccumulatePolicy`는 이 결제 helper가 아니다.

`executeResetCycles`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `resetCycle.test.ts:176`의 `runsThreeCommittedResets`, `resetCycle.test.ts:384`의 `recordsRejectedResetWithoutReward`, `resetCycle.test.ts:491`의 `excludesOpeningRewardFromDelta`를 가리킨다. CLI command는 가리키지 않는다. 소스 확인상 `packages/cli/src/commands/prestigeCycle.ts`는 여전히 `analyzePrestigeCycle`을 부른다. 그 호출은 리뷰다. `executeResetCycles`로 가는 hop이 아니다.

`applyDecisions`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 선언만 이름으로 가리키고 호출 span을 돌려준다. `resetCycle.ts:392`, `stepOnce` 안의 `step.ts:625`, `stepOnce` 호출인 `simulator.ts:104`와 `offline.ts:199`, `resetCycle.test.ts:210`, `step.bulk.test.ts:123`, `planner.regression.test.ts:125`다. 적은 span이 그 trace의 전부는 아니다.

`emitCommittedResets`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 선언만 이름으로 가리키고 `simulator.ts:115`, `offline.ts:219`, `resetCycle.ts:430`, `resetCycle.test.ts:222`의 호출 span을 돌려준다. 소스 확인도 그 세 production 호출과 같다.

`resetAdapterFor`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `executeResetCycles`와 같은 세 테스트를 가리킨다.

`createPlannerStrategy`에서 `stepOnce`로 가는 trace(`maxDepth` 3, `maxNodes` 32)는 양 끝 symbol만 나열하고 hop은 없다. `applyDecisions`를 위로 뽑아냈으므로 lookup은 `stepOnce`를 `step.ts:618`에 둔다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:358`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

reset cycle 재현 seed는 `packages/core/src/sim/analysis/resetCycle.test.ts`의 `0x7110`이다. 이 변경의 후속 실행은 macOS arm64, Bun `1.4.2`이다. `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, `bun run test:conformance`, `bun run public:check`는 종료 코드 0이다. `bun run typecheck`는 `evidence:check`와 `format:check`를 포함하며 둘 다 통과했다. 그 검사 전에 `bun run contracts:generate`는 종료 코드 0이다. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run readme:smoke`, `bun run install:smoke`, `bun run review:smoke`도 종료 코드 0이다. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, Linux host, CI는 실행하지 않았다.

## PR-12 호출자

macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`에서 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `fitGrowth`를 `packages/core/src/sim/analysis/growthFit.ts:627`, `fitGrowthFromRun`을 `growthFit.ts:722`, `analyzeGrowth`를 `packages/core/src/sim/analysis/growth.ts:79`, `legacyGrowthSpeedBucket`을 `growth.ts:68`에 둔다. `createPlannerStrategy` lookup은 `packages/core/src/sim/strategy/planner.ts:286`, `stepOnce` lookup은 `packages/core/src/sim/step.ts:618`이다.

`fitGrowth`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `growthFit.ts:722`의 `fitGrowthFromRun`, `growth.fit.test.ts:119`의 `fitSpec`, `growth.fit.test.ts:205`의 `separatesShapeFromSpeed`, `growth.fit.test.ts:285`의 `refusesDisguisedDomains`, `growth.fit.test.ts:384`의 `preservesLegacyNetWorthFallback`을 가리킨다. CLI command는 가리키지 않는다. 소스 확인상 `packages/cli/src/commands/growth.ts:61`, `packages/cli/src/commands/report.ts:100`, `packages/cli/src/lib/experience.ts:265`는 여전히 `analyzeGrowth`를 부른다. 그 줄은 리뷰다. `fitGrowth`로 가는 hop이 아니다.

`fitGrowthFromRun`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 같은 세 테스트를 가리킨다. CLI command는 가리키지 않는다.

`analyzeGrowth`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `experience.ts:249`의 `snapshotFromSession`, `separatesShapeFromSpeed`, `preservesLegacyNetWorthFallback`, `designObjectives.ts:52`의 `evaluateVisibleProgress`, `designObjectives.ts:95`의 `evaluateMilestoneTime`, `designObjectives.ts:144`의 `evaluateExperienceBalanced`, `experience.ts:309`의 `collectExperienceSnapshot`을 가리킨다. 위 이름이 그 trace의 모든 span은 아니다. `commands/growth.ts`와 `commands/report.ts`는 가리키지 않는다. 소스 확인상 호출은 `packages/cli/src/commands/growth.ts:61`과 `packages/cli/src/commands/report.ts:100`이다. 그 줄은 리뷰다. graph hop이 아니다. 32 node 상한이 모든 호출자는 아니다.

`legacyGrowthSpeedBucket`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `growth.ts:75`의 `classify`, `growthFit.ts:425`의 `classifyPositive`, `growth.ts:79`의 `analyzeGrowth`, `growthFit.ts:513`의 `classifySlice`, `growthFit.ts:627`의 `fitGrowth`, `experience.ts:249`의 `snapshotFromSession`, `separatesShapeFromSpeed`, `preservesLegacyNetWorthFallback`을 가리킨다. CLI 이름은 `analyzeGrowth`를 거쳐 닿는다. bucket helper의 직접 호출이 아니며, CLI에서 `fitGrowth`로 가는 hop도 아니다.

`fitGrowth`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `growthFit.ts:184`의 `assertSampling`, `growthFit.ts:222`의 `preparePoints`, `growthFit.ts:233`의 `evenKeep`, `growthFit.ts:379`의 `irregularSpacing`, `growthFit.ts:576`의 `baseArtifact`, `growthFit.ts:402`의 `blankWindow`, `pushBreak`, `growthFit.ts:534`의 `slicesOf`, `growthFit.ts:513`의 `classifySlice`, `GrowthFitRejected`, `readPoint`, `rollup`, `domainOf`, `growthFit.ts:425`의 `classifyPositive`에 닿는다.

`fitGrowthFromRun`의 forward execution trace(`maxDepth` 2, `maxNodes` 32)는 `fitGrowth`, `growthFit.ts:708`의 `softcapOf`, `types.ts:217`의 `Model.netWorth`, `types.ts:219`의 `Model.analytic`, 그리고 위 `fitGrowth`의 첫 단계 callee에 닿는다.

`createPlannerStrategy`에서 `stepOnce`로 가는 trace(`maxDepth` 3, `maxNodes` 32)는 양 끝 symbol만 나열하고 hop은 없다. rollout 호출은 `packages/core/src/sim/strategy/planner.ts:358`의 `PlannerDeps.d.stepOnce`다. 그 edge는 미관측이다.

RNG는 없다. growth shape 재현 fixture는 `fixtures/conformance/growth-shapes.json`, generator version 1, slope tolerance `0.0001`이다. PR-12 사례는 `packages/core/src/sim/analysis/growth.fit.test.ts`에 있다. `analyzeGrowth` 사례는 `growth.test.ts`에 남는다. 그 파일의 `it.each` 제목은 printf 형식이라 정적 runner 등록이 아니다. 이 변경의 후속 실행은 macOS arm64, Bun `1.4.2`이다. `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run test:conformance`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, `bun run public:check`는 종료 코드 0이다. `bun run typecheck`는 `evidence:check`와 `format:check`를 포함하며 둘 다 통과했다. 그 검사 전에 `bun run contracts:generate`는 종료 코드 0이다. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run review:smoke`도 종료 코드 0이다. 첫 `bun run install:smoke`와 처음 두 번의 `bun run readme:smoke`는 core pack이 `packages/core/package.json`을 고쳐 쓰는 동안 CLI build가 그 변경을 보아 ttsc unstable-generation 오류로 종료 코드 1이다. install 재실행과 그다음 두 번의 readme 실행은 종료 코드 0이다. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, Linux host, CI는 실행하지 않았다.
## PR-11 호출자

이 변경의 tree에서 macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`로 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. lookup은 `analyzeResetPolicies`를 `packages/core/src/sim/analysis/resetOptimization.ts:749`, `executeResetCycles`를 `packages/core/src/sim/analysis/resetCycle.ts:321`에 둔다. 소스 확인상 `runScenario`는 `packages/core/src/sim/simulator.ts:28`, `applyDecisions`는 `packages/core/src/sim/step.ts:403`, `stepOnce`는 `packages/core/src/sim/step.ts:618`, `sessionActiveBlocks`는 `packages/core/src/sim/session.ts:215`이다.

`analyzeResetPolicies`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `resetOptimization.test.ts:126`의 `matchesTheoreticalRewardRate`, `resetOptimization.test.ts:206`의 `separatesEmpiricalStability`, `resetOptimization.test.ts:283`의 `reportsRecoveryCrossing`, `resetOptimization.test.ts:346`의 `keepsManualResetInsideSession`, `resetOptimization.test.ts:391`의 `ranksScanWithoutNumberCollapse`를 가리킨다. CLI command는 가리키지 않는다. 소스 확인상 `packages/cli/src/commands/prestigeCycle.ts:60`은 여전히 `analyzePrestigeCycle`을 부른다. 그 호출은 리뷰다. `analyzeResetPolicies`로 가는 hop이 아니다.

`commitReset`의 forward execution trace(`maxDepth` 2, `maxNodes` 16)는 `step.ts:403`의 `applyDecisions`, `constraints.ts:68`의 `recordPrestigeReset`, `observation.ts:94`의 `emitCommittedResets`를 가리킨다.

`executeResetCycles`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `resetOptimization.ts:583`의 `evaluateAlwaysActive`, `analyzeResetPolicies`, reset policy 테스트 다섯 개, `resetCycle.test.ts`의 `runsThreeCommittedResets`, `recordsRejectedResetWithoutReward`, `excludesOpeningRewardFromDelta`를 가리킨다. `resetOptimization.ts:637`의 `evaluateSession`은 가리키지 않는다. 소스 확인상 session 경로는 `resetOptimization.ts:401`의 `commitReset`으로 커밋한다. 그 호출은 리뷰다. `executeResetCycles`로 가는 hop이 아니다.

RNG는 없다. reset policy 재현 fixture는 `fixtures/conformance/reset-policy-rate.json`이다. 기대 비율은 완료된 cycle 시간 기준 `0.1`이다. fixture 일치는 정상 상태 증명이 아니다. `provedSteadyState`는 false로 남는다. 이 변경의 gate는 pull request에 적는다.
## PR-13 호출자

이 변경의 tree에서 macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`로 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. 소스 확인상 `analyzeDistribution`은 `packages/core/src/sim/analysis/distribution.ts:367`, `firstVisibleDistributionSample`은 `distribution.ts:228`, `summarizeExperienceMonteCarlo`는 `packages/cli/src/lib/experience.ts:342`, `simulateMonteCarlo`는 `packages/core/src/sim/monteCarlo.ts:74`이다.

`analyzeDistribution`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `experience.ts:342`의 `summarizeExperienceMonteCarlo`, `distribution.test.ts:63`의 `separatesCensoringFromObservedQuantiles`, `distribution.test.ts:131`의 `fixesQuantileRanksAndKeys`, `distribution.test.ts:290`의 `checksSeededDropAndZeroVariance`, `distribution.test.ts:327`의 `separatesMeansAndCensorsMissingVisibleChange`를 가리킨다.

`firstVisibleDistributionSample`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `summarizeExperienceMonteCarlo`와 `separatesMeansAndCensorsMissingVisibleChange`를 가리킨다. CLI 호출은 `packages/cli/src/lib/experience.ts:396`이다.

`summarizeExperienceMonteCarlo`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 선언만 가리킨다. 소스 확인상 호출은 `packages/cli/src/commands/experience.ts:113`과 `packages/cli/src/commands/evaluate.ts:217`이다. 그 줄은 리뷰다. graph hop이 아니다.

`simulateMonteCarlo`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `packages/cli/src/lib/designObjectives.ts`의 `evaluateVisibleProgress`, `evaluateMilestoneTime`, `evaluateExperienceBalanced`, `summarizeExperienceMonteCarlo`, `experience.ts:459`의 `summarizeComparableExperienceMetric`, `packages/core/src/sim/runFactory.test.ts:161`의 `isolatesIndependentRuns`, `distribution.test.ts:245`의 `keepsLogicalDrawsIndependentOfOrder` 안 `run` helper를 가리킨다.

분포 재현 fixture는 `fixtures/conformance/independent-drop.json`, seed `28947`(`0x7113`), 10000 draws, 확률 `0.01`, 절대 허용 오차 `0.005`다. 상태가 있는 logical draw 검사도 같은 seed를 쓴다. 이 변경의 실행은 로컬이다. worker 수는 seed의 입력이 아니다. 이 변경의 gate는 pull request에 적는다.
## PR-14 호출자

이 변경의 tree에서 macOS arm64, Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`로 조회했다. 생성 식별자는 없다. 서버 cwd는 이 작업 트리이고 프로그램은 `tsconfig.graph.json`이다. 소스 확인상 `runExperiment`는 `packages/core/src/sim/analysis/experiment.ts:712`, `normalizeSpec`은 `experiment.ts:336`, `requireSpec`은 `experiment.ts:358`이다.

`runExperiment`의 reverse execution trace(`maxDepth` 3, `maxNodes` 32)는 `experiment.test.ts:161`의 `runWith`, `experiment.test.ts:192`의 `checksLocalElasticityDirection`, `experiment.test.ts:334`의 `rejectsUnsafeParametersBeforeRun`, `experiment.test.ts:470`의 `keepsCandidateOrderAndScenario`, `experiment.test.ts:572`의 `skipsCensoredHorizonForSensitivity`, `experiment.test.ts:637`의 `matchesHandPareto`, `experiment.test.ts:750`의 `startsCandidatesFromScenario`, `experiment.test.ts:841`의 `keepsLargeEngineAmounts`, `packages/core/src/testkit/conformance.ts:132`의 적합성 관계 `checkConstantIncomeExperiment`, `packages/core/src/testkit/conformance.test.ts:2122`의 corpus 테스트 `replaysConstantIncomeExperimentAcrossTheSeedCorpus`를 가리킨다. CLI command는 가리키지 않는다. 소스 확인상 호출은 `packages/cli/src/commands/experiment.ts:80`다. 그 줄은 리뷰다. graph hop이 아니다.

상수 수입 예제에는 RNG가 없다. parameter experiment 재현 fixture는 `fixtures/conformance/parameter-experiment.json`, seed `28948`이다. 한 번에 하나씩 보는 국소 민감도는 전역 민감도가 아니며 Sobol index도 아니다. 이 변경의 gate는 pull request에 적는다.
