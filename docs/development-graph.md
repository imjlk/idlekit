# Development graph

Korean version: [development-graph_ko.md](./development-graph_ko.md)

`TC-04` connects the pinned `@ttsc/graph` `0.30.4` server to this repository. The bin is `node_modules/.bin/ttsc-graph`. The server is a local stdio process. It does not upload source to a remote graph service. `@ttsc/graph` stays a root devDependency. `@idlekit/money`, `@idlekit/core`, and `@idlekit/cli` do not depend on it, and `idk` bundle output does not import it.

## Reproduce a query

From the repository root, with Bun `1.4.2`:

```bash
bun tools/graph-query.ts --question "Where is runScenario declared?" --request '{"type":"lookup","query":"runScenario"}'
```

`graph-query.ts` starts `ttsc-graph --cwd <root> --tsconfig tsconfig.graph.json`, performs MCP `initialize`, reads `inspect_typescript_graph` from `tools/list`, and sends only fields that schema publishes. Wrapper fields (`question`, `draft`, `review`, `request`) come from that schema. A field that is not in the live branch exits the process. The printed lines are symbol, file, and line. A span that carries a declaration signature prints that signature after the location. A trace also prints `from -> to` hop lines, using symbol names rather than node ids. The output is not a raw dump.

`bun run graph:check` is the gate. It checks initialize, tool discovery, lookup, caller and callee traces, workspace source spans, scratch rename / signature / citation updates, one signature edit read by the session that was already open, and stdin shutdown. `--help` alone is not a pass.

## Program

`tsconfig.graph.json` is noEmit. It includes money, core, and CLI sources, CLI scripts, and top-level `tools/*.ts`. `@ttsc/lint` is `enabled: false` on this program so the evidence graph is not applied here. Package `tsconfig.json` files stay authoritative when the aggregate program would only expose a `.d.ts` boundary. There is no root `tsconfig.json`.

## Agent config

`.mcp.json.example` matches Claude Code's project MCP file, pointed at the local bin. Its POSIX `command` is `node_modules/.bin/ttsc-graph`. On Windows, copy `windowsCommand` (`node_modules/.bin/ttsc-graph.exe`) into that `command` before use. `.codex/config.toml.example` matches the Codex project config keys documented at <https://learn.chatgpt.com/codex/extend/mcp> (`command`, `args`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`) and names the same Windows `.exe` path. Copy them into the project-local file. Do not edit `~/.codex/config.toml` from this change. The Codex tool timeout is raised because the first `inspect_typescript_graph` call builds the index after the handshake.

## Unobserved

The checker does not see JSON or YAML scenarios, shell and package scripts, dynamic plugin loads in `packages/cli/src/plugin/load.ts`, `package.json` exports, or bunfig preload. Those stay file reviews. Graph rank is not permission to skip the full test command.

## TC-04 verification

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`, at commit `3e16237ec6e5b3c9a5ab6e35e3bf962ab97eef9f`. No generation field was returned. Scratch edits were re-read in a new process, and the already open session reported `quotaHost` as `(): 4` after the signature edit. `bun run graph:check` exited 0. The tour payload includes the `runScenario` and `stepOnce` spans below.

| Symbol | Span | Graph result |
|---|---|---|
| `runScenario` | `packages/core/src/sim/simulator.ts:6` | lookup |
| `stepOnce` | `packages/core/src/sim/step.ts:50` | forward trace from `runScenario`, and the reverse trace |
| `compileScenario` | `packages/core/src/scenario/compile.ts:490` | lookup |
| `tickMoney` | `packages/money/src/policy/tickMoney.ts:8` | lookup. Workspace source, not a `.d.ts` boundary |
| `createPlannerStrategy` | `packages/core/src/sim/strategy/planner.ts:189` | lookup. Path to `stepOnce` has 0 hops |
| CLI callers of `runScenario` | `packages/cli/src` | reverse execution trace. A later trace in the same config named `commands/compare.ts`, `commands/ltv.ts`, `commands/tune.ts`, `lib/designObjectives.ts`, and `lib/experience.ts`. The 32-node cap is not every caller |

`createPlannerStrategy` calls `d.stepOnce(...)`. The default argument is `({ stepOnce } as PlannerDeps)`. `tools/graph-preflight.ts` reads that default from the function declaration. This graph did not return that binding as a hop. The source lines are the review. That row is unobserved, not a passed call edge.

The same gate copied `fixtures/graph/base` to a temp directory. Lookup found `quotaHost` at `src/host.ts:5`. A fresh process after renaming it to `quotaHostRenamed` returned that name. Changing the return type to `4` showed up in `details`. Changing `@evidence docs/spec.md#quota` to `docs/spec.md#quota-next` changed the `docTags` text. The old target was no longer an exact tag. Stdin shutdown exited 0.

Follow-up queries and `graph:check` do not store node ids. `bun run runtime:check` exited 0. `bun tools/analysis-baseline-check.ts` exited 0. `typecheck`, `format:check`, `test`, a Linux host, and CI `graph:check` were not run.

## PR-01 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`, from the repository root with `tsconfig.graph.json`, at commit `d7ac8635ffae3a71fc835ac000cfc82f8c164bb6`. No generation identifier. Lookup places `stepOnce` at `packages/core/src/sim/step.ts:264` and `singleBuySize` at `packages/core/src/sim/step.ts:53`.

A reverse execution trace of `stepOnce` (`focus` execution, `maxDepth` 3, `maxNodes` 32) has direct hops from `packages/core/src/sim/simulator.ts#runScenario` (span `simulator.ts:49`), `packages/core/src/sim/offline.ts#applyOfflineSeconds` (span `offline.ts:139`), `packages/core/src/testkit/conformance.ts#flatBulkSnapshot`, and `packages/core/src/sim/step.bulk.test.ts` functions `settlesQuotedBulkAndRejectsBadQuotes`, `runFlat`, and `runBonus`. Through `runScenario` it reaches `session.ts`, `monteCarlo.ts`, `eta.ts`, `prestigeCycle.ts`, `strategy/opt/runner.ts`, and CLI `compare.ts`, `ltv.ts`, `tune.ts`, `lib/designObjectives.ts`, and `lib/experience.ts`. The 32-node cap is not every caller.

`createPlannerStrategy` was not a hop. It still calls `d.stepOnce` on `PlannerDeps`. That edge stays unobserved. At that PR-01 tree, source review showed a second `stepOnce` call in `applyOfflineSeconds` for the remainder step. After the edit, lookup places `stepOnce` at `packages/core/src/sim/step.ts:175`. `singleBuySize` is `packages/core/src/sim/step.ts:51`.

## PR-02 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `runScenario` at `packages/core/src/sim/simulator.ts:25`, `applyOfflineSeconds` at `packages/core/src/sim/offline.ts:94`, `nextBoundary` at `packages/core/src/sim/timeBoundary.ts:54`, and `stepOnce` at `packages/core/src/sim/step.ts:175`. `timeBoundaryEpsilonScale` is the property at `packages/core/src/sim/timeBoundary.ts:11`. That line is the source declaration. It was not a separate lookup hit.

A forward execution trace from `runScenario` (`maxDepth` 2, `maxNodes` 32) reaches `nextBoundary` and `stepOnce` at `packages/core/src/sim/step.ts:175`. A reverse execution trace of `stepOnce` (`maxDepth` 3, `maxNodes` 32) names direct calls at `packages/core/src/sim/simulator.ts:80` and `packages/core/src/sim/offline.ts:162`. The offline remainder is the same loop, not a second call. Through those hosts the trace reached `session.ts`, `monteCarlo.ts`, `eta.ts`, `prestigeCycle.ts`, `strategy/opt/runner.ts`, `conformanceRun.ts`, `simulator.time.test.ts`, and CLI `compare.ts`, `ltv.ts`, `tune.ts`, `lib/designObjectives.ts`, and `lib/experience.ts`. The 32-node cap is not every caller.

A reverse trace of `nextBoundary` names `packages/core/src/sim/simulator.ts:60` and `packages/core/src/sim/offline.ts:140`. `createPlannerStrategy` is still not a hop to `stepOnce`. The call remains `d.stepOnce` on `PlannerDeps`. That edge stays unobserved.

## PR-03 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `createRunFactory` at `packages/core/src/sim/runFactory.ts:338`, `cloneRunState` at `packages/core/src/sim/runFactory.ts:161`, and `simulateMonteCarlo` at `packages/core/src/sim/monteCarlo.ts:41`.

A reverse execution trace of `createRunFactory` (`maxDepth` 3, `maxNodes` 32) names the call in `packages/core/src/sim/monteCarlo.ts:46` and `packages/core/src/sim/runFactory.test.ts`. Through `simulateMonteCarlo` it reached `isolatesIndependentRuns`, CLI `lib/designObjectives.ts`, `lib/experience.ts`, and `commands/compare.ts`. The 32-node cap is not every caller.

A forward execution trace of `simulateMonteCarlo` (`maxDepth` 2, `maxNodes` 32) reaches `createRunFactory` at `packages/core/src/sim/runFactory.ts:338`, then `session.ts` and `simulator.ts`. A reverse execution trace of `cloneRunState` (`maxDepth` 2, `maxNodes` 16) names `packages/core/src/scenario/compile.ts:388` inside `buildInitialState`, `compileScenario` at `packages/core/src/scenario/compile.ts:491`, and the factory's own `bind`. `createPlannerStrategy` is still not a hop to `stepOnce`. That edge stays unobserved.

## PR-05 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `createObservationRecorder` at `packages/core/src/sim/observation.ts:238`, `mergeObservations` at `packages/core/src/sim/observation.ts:160`, `observationContract` at `packages/core/src/sim/observation.ts:11`, `simulateSessionPattern` at `packages/core/src/sim/session.ts:97`, and `runScenario` at `packages/core/src/sim/simulator.ts:26`.

A reverse execution trace of `createObservationRecorder` (`maxDepth` 3, `maxNodes` 32) names `packages/core/src/sim/simulator.ts:40` and `packages/core/src/sim/offline.ts:127`. Through those hosts it reached `session.ts:162`, `prestigeCycle.ts:29`, `strategy/opt/runner.ts:61`, `eta.ts:70`, `monteCarlo.ts:73`, `conformanceRun.ts`, `observation.test.ts:82`, `simulator.time.test.ts:110`, and CLI `compare.ts:114`, `ltv.ts:254`, `tune.ts:157`, `lib/designObjectives.ts`, and `lib/experience.ts`. The 32-node cap is not every caller.

A reverse execution trace of `mergeObservations` (`maxDepth` 3, `maxNodes` 32) names `packages/core/src/sim/session.ts:228`. Through `simulateSessionPattern` it reached `simulateMonteCarlo` at `packages/core/src/sim/monteCarlo.ts:41`, `collectExperienceSnapshot` at `packages/cli/src/lib/experience.ts:226`, `isolatesIndependentRuns`, `lib/designObjectives.ts`, and `commands/compare.ts:174`.

A forward execution trace of `simulateSessionPattern` (`maxDepth` 2, `maxNodes` 32) includes `packages/core/src/sim/session.ts:228`, `packages/core/src/sim/observation.ts:162`, `packages/core/src/sim/observation.ts:189`, `packages/core/src/sim/observation.ts:378`, `packages/core/src/sim/eventBuffer.ts:83`, `packages/core/src/sim/offline.ts:127`, and `packages/core/src/sim/simulator.ts:40`. Those spans do not name `stepOnce`. A forward execution trace of `createPlannerStrategy` (`maxDepth` 3, `maxNodes` 32) stays inside `packages/core/src/sim/strategy/planner.ts` and does not name `stepOnce`. That edge stays unobserved.

## PR-04 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `createPlannerStrategy` at `packages/core/src/sim/strategy/planner.ts:253`, `stepOnce` at `packages/core/src/sim/step.ts:193`, `decidePrestigeCooldown` at `packages/core/src/sim/constraints.ts:24`, `prestigeCooldownContract` at `packages/core/src/sim/constraints.ts:10`, `plannerSearchContract` at `packages/core/src/sim/strategy/planner.ts:48`, `etaSimulate` at `packages/core/src/sim/analysis/eta.ts:41`, and `cmdTune` at `packages/cli/src/commands/tune.ts:120`.

A reverse execution trace of `decidePrestigeCooldown` (`maxDepth` 3, `maxNodes` 32) names `packages/core/src/sim/strategy/planner.ts:183` and `packages/core/src/sim/step.ts:220`. Through `stepOnce` it reached `packages/core/src/sim/simulator.ts:99`, `packages/core/src/sim/offline.ts:180`, `packages/core/src/sim/analysis/eta.ts:70`, and `packages/core/src/sim/strategy/opt/runner.ts:61`.

A forward execution trace of `etaSimulate` (`maxDepth` 2, `maxNodes` 32) names `runScenario` at `packages/core/src/sim/simulator.ts:27` and `stepOnce` at `packages/core/src/sim/step.ts:193`. A forward execution trace of `cmdTune` (`maxDepth` 2, `maxNodes` 32) includes `packages/cli/src/commands/tune.ts:157`, `runCandidateAndScore` at `packages/core/src/sim/strategy/opt/runner.ts:8`, `packages/core/src/sim/strategy/opt/runner.ts:61`, and names `runScenario`.

A forward execution trace of `createPlannerStrategy` (`maxDepth` 3, `maxNodes` 32) names `decidePrestigeCooldown` and includes an unnamed span at `packages/core/src/sim/runFactory.ts:171`. It does not name `stepOnce`. The rollout call is `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:322`. That edge stays unobserved. A reverse execution trace names `packages/core/src/sim/strategy/builtins.ts:51` and `keepsPlannerRolloutFaithful` at `packages/core/src/sim/strategy/planner.regression.test.ts:85`.

## PR-06 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `simulateSessionPattern` at `packages/core/src/sim/session.ts:215`, `applyOfflineSeconds` at `packages/core/src/sim/offline.ts:135`, `sessionClockContract` at `packages/core/src/sim/session.ts:16`, `resolveOfflineActionPolicy` at `packages/core/src/sim/offline.ts:110`, `assertSessionSchedule` at `packages/core/src/sim/session.ts:145`, and `keepsSessionClocksDistinct` at `packages/core/src/sim/session.test.ts:186`.

A reverse execution trace of `simulateSessionPattern` (`maxDepth` 3, `maxNodes` 32) names `packages/core/src/sim/monteCarlo.ts:54`, `collectExperienceSnapshot` at `packages/cli/src/lib/experience.ts:253`, `runPattern` at `packages/core/src/sim/session.test.ts:177`, `isolatesIndependentRuns` at `packages/core/src/sim/runFactory.test.ts:151`, `evaluateVisibleProgress` at `packages/cli/src/lib/designObjectives.ts:48`, and `packages/cli/src/commands/compare.ts:174`. The 32-node cap is not every caller.

A forward execution trace of `simulateSessionPattern` (`maxDepth` 2, `maxNodes` 32) includes `applyOfflineSeconds` at `packages/core/src/sim/session.ts:273`, `runScenario` at `packages/core/src/sim/session.ts:326`, `mergeObservations` at `packages/core/src/sim/session.ts:378`, `createEventBuffer` at `packages/core/src/sim/session.ts:227`, then `packages/core/src/sim/offline.ts:149`, `packages/core/src/sim/simulator.ts:34`, `packages/core/src/sim/eventBuffer.ts:83`, and `packages/core/src/sim/observation.ts:378`.

A reverse execution trace of `applyOfflineSeconds` (`maxDepth` 3, `maxNodes` 32) names `simulateSessionPattern.appendOffline` at `packages/core/src/sim/session.ts:273`, `keepsSessionClocksDistinct` at `packages/core/src/sim/session.test.ts:186`, `stopsOnTheRequestedHorizon` at `packages/core/src/sim/simulator.time.test.ts:105`, and `keepsPlannerRolloutFaithful` at `packages/core/src/sim/strategy/planner.regression.test.ts:85`. A forward execution trace (`maxDepth` 2, `maxNodes` 32) names `resolveOfflineActionPolicy` at `packages/core/src/sim/offline.ts:110` and `assertSimulationClock` at `packages/core/src/sim/timeBoundary.ts:70`, and includes `packages/core/src/sim/step.ts:220`.

A forward execution trace of `createPlannerStrategy` (`maxDepth` 3, `maxNodes` 32) still does not name `stepOnce`. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:322`. That edge stays unobserved.

## PR-07 callers

Queried on macOS arm64 with Bun `1.3.10`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. Lookup places `prepareResolvedRun` at `packages/cli/src/lib/runConfiguration.ts:331`, `resolvedRunContract` at `packages/cli/src/lib/runConfiguration.ts:27`, `strategyCreateParams` at `packages/core/src/scenario/compile.ts:354`, `compileScenario` at `packages/core/src/scenario/compile.ts:545`, `keepsResolvedRunConfiguration` at `packages/cli/src/lib/runConfiguration.test.ts:91`, and `createRunFactory` at `packages/core/src/sim/runFactory.ts:369`.

A reverse execution trace of `prepareResolvedRun` (`maxDepth` 3, `maxNodes` 32) names `keepsResolvedRunConfiguration` at `packages/cli/src/lib/runConfiguration.test.ts:91`. It does not name the command handlers. Source review shows the calls at `packages/cli/src/commands/evaluate.ts:154`, `packages/cli/src/commands/simulate.ts:159`, `packages/cli/src/commands/experience.ts:74`, and `packages/cli/src/commands/ltv.ts:475`. Those lines are the review. They are not extra graph hops.

A forward execution trace of `prepareResolvedRun` (`maxDepth` 2, `maxNodes` 32) names `resolveEffectiveEngine`, `compileScenario`, `resolveStrategySelection`, `effectiveRunHash`, `pluginDigestValues`, `stagePlan`, `openResolvedStage`, and `createNumberEngine`. It includes an unnamed span at `packages/cli/src/lib/runConfiguration.ts:311`, which is the `createRunFactory` call inside `openResolvedStage`. The trace does not name `createRunFactory`.

A forward execution trace of `createPlannerStrategy` (`maxDepth` 3, `maxNodes` 32) still does not name `stepOnce`. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:322`. That edge stays unobserved.

`bun run graph:check` exited 0. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, and `test:conformance:extended` were not run.

## TC-05 callers

Queried at commit `8bdef6fdc6c9f763e4f4e946ff16c67d88d129c4` on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `validateScenarioStructure` at `packages/core/src/scenario/scenarioContract.ts:64`, `buildContractDocument` at `packages/core/src/scenario/scenarioContract.ts:205`, `writeContracts` at `tools/contract-files.ts:42`, `createPlannerStrategy` at `packages/core/src/sim/strategy/planner.ts:286`, and `stepOnce` at `packages/core/src/sim/step.ts:356`. The `validateScenarioV1` lookup did not return that name on this revision. Source review places it at `packages/core/src/scenario/validate.ts:777`.

A reverse execution trace of `validateScenarioStructure` (`maxDepth` 3, `maxNodes` 32) names `packages/core/src/scenario/scenarioContract.probe.ts:17`, `packages/core/src/scenario/scenarioContract.probe.ts:18`, and `keepsSemanticValidation` at `packages/core/src/scenario/scenarioContract.test.ts:214`. The same trace includes spans at `packages/core/src/scenario/scenarioContract.test.ts:218` and `packages/core/src/scenario/scenarioContract.test.ts:300`.

A reverse execution trace of `buildContractDocument` (`maxDepth` 3, `maxNodes` 32) names `renderedContracts` at `tools/contract-files.ts:34`, `keepsTypedContractSingleSource` at `packages/core/src/scenario/scenarioContract.test.ts:109`, `writeContracts` at `tools/contract-files.ts:42`, `compareContracts` at `tools/contract-files.ts:49`, and the call in `tools/contracts-check.ts:15`.

A reverse execution trace of `writeContracts` (`maxDepth` 2, `maxNodes` 16) names only its declaration. Source review shows the call at `tools/generate-contracts.ts:15`. That line is the review. It is not a graph hop. Package scripts `contracts:generate` and `contracts:check` are not in the graph.

A forward execution trace of `createPlannerStrategy` (`maxDepth` 3, `maxNodes` 32) still does not name `stepOnce`. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:358`. That edge stays unobserved.

`bun run graph:check` exited 0. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, and `test:conformance:extended` were not run on this change.

## PR-08 callers

Queried on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `buildAnalysisArtifact` at `packages/core/src/sim/analysis/metrics.ts:332`. The same lookup also names `buildAnalysisArtifactJsonSchema` at `packages/core/src/sim/analysis/contracts.ts:135`, `buildAnalysisContractDocument` at `tools/contract-files.ts:53`, and `analysisArtifactJsonSchema` at `packages/core/src/sim/analysis/contracts.ts:141`. `AnalysisArtifactV1` is declared at `packages/core/src/sim/analysis/contracts.ts:99` and `parseAnalysisArtifact` at `packages/core/src/sim/analysis/contracts.ts:131`. Lookup of `evaluateGoalForEta` places it at `packages/core/src/sim/analysis/metrics.ts:278` and also returns `evaluateMilestoneTime` and `evaluateVisibleProgress` in `packages/cli/src/lib/designObjectives.ts`. Those two are not this contract.

A reverse execution trace of `evaluateGoal` (`maxDepth` 3, `maxNodes` 32) names `evaluateGoalForEta` at `packages/core/src/sim/analysis/metrics.ts:278`, `evaluateGoalForExperiment` at `packages/core/src/sim/analysis/metrics.ts:286`, `evaluateGoalForCheck` at `packages/core/src/sim/analysis/metrics.ts:294`, `agree` at `packages/core/src/sim/analysis/analysisContract.test.ts:61`, `sharesDefaultGoalEvaluation` at `packages/core/src/sim/analysis/analysisContract.test.ts:89`, `registersCustomMetric` at `packages/core/src/sim/analysis/analysisContract.test.ts:144`, and `roundTripsAnalysisArtifact` at `packages/core/src/sim/analysis/analysisContract.test.ts:237`.

A reverse execution trace of `buildAnalysisArtifact` (`maxDepth` 3, `maxNodes` 32) names `roundTripsAnalysisArtifact` at `packages/core/src/sim/analysis/analysisContract.test.ts:237` and the call at `packages/core/src/sim/analysis/analysisContract.test.ts:292`.

Follow-up on this change, macOS arm64, Bun `1.4.2`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, and `bun run graph:check` exited 0. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run readme:smoke`, `bun run install:smoke`, and `bun run review:smoke` exited 0. `bun test --timeout 120000 src/sim/analysis/analysisContract.test.ts` from `packages/core` exited 0. `bun test --cwd packages/cli --timeout 120000 src/io/analysisArtifact.test.ts` exited 0. The contract fixture has no RNG. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, a Linux host, and CI were not run.

## PR-09 callers

Queried on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `etaAnalytic` at `packages/core/src/sim/analysis/eta.ts:441`, `etaSimulate` at `packages/core/src/sim/analysis/eta.ts:381`, and `etaSecondsFromEngineRatio` at `packages/core/src/sim/analysis/eta.ts:140`. The `etaAnalytic` lookup also names `EtaEstimateV1` at `packages/core/src/sim/analysis/eta.ts:56`, `etaGoalForTarget` at `packages/core/src/sim/analysis/eta.ts:179`, and `etaSourceDigests` at `tools/contract-files.ts:62`. It also returns `evaluateGoalForEta`. That is not this estimate. Lookup places `readEtaOutput` at `packages/cli/src/io/etaOutput.ts:7`. The same lookup returns other `read*` names. Those are not this reader.

A reverse execution trace of `etaAnalytic` (`maxDepth` 3, `maxNodes` 32) names `keepsEngineRatioBeforeNarrowing` at `packages/core/src/sim/analysis/eta.semantics.test.ts:85`, `separatesExactAndLocalEta` at `packages/core/src/sim/analysis/eta.semantics.test.ts:137`, `censorsUnreachedHorizon` at `packages/core/src/sim/analysis/eta.semantics.test.ts:225`, and `keepsFormulaSecondsApartFromExecutedEtaResults` at `packages/core/src/testkit/conformance.test.ts:2017`. It does not name the CLI command. Source review shows the calls at `packages/cli/src/commands/eta.ts:91` and `packages/cli/src/commands/eta.ts:103`. Those lines are the review. They are not extra graph hops.

A reverse execution trace of `etaSimulate` (`maxDepth` 3, `maxNodes` 32) names `etaAnalytic` at `packages/core/src/sim/analysis/eta.ts:441`, plus the same four tests. It does not name the CLI command.

A reverse execution trace of `etaSecondsFromEngineRatio` (`maxDepth` 3, `maxNodes` 32) names `analyticEstimate` at `packages/core/src/sim/analysis/eta.ts:253`, `etaSimulate` at `packages/core/src/sim/analysis/eta.ts:381`, `etaAnalytic` at `packages/core/src/sim/analysis/eta.ts:441`, and the same four tests.

A forward execution trace of `etaAnalytic` (`maxDepth` 2, `maxNodes` 32) reaches `analyticEstimate`, `etaSimulate`, `etaSecondsFromEngineRatio`, `etaGoalForTarget`, `evaluateGoal` at `packages/core/src/sim/analysis/metrics.ts:236`, `runScenario` at `packages/core/src/sim/simulator.ts:28`, `assertHorizonReached` at `packages/core/src/sim/types.ts:81`, `runElapsedSec` at `packages/core/src/sim/types.ts:91`, `Model.income` at `packages/core/src/sim/types.ts:205`, and `Model.netWorth` at `packages/core/src/sim/types.ts:217`.

A forward execution trace of `etaSimulate` (`maxDepth` 2, `maxNodes` 32) reaches `runScenario` at `packages/core/src/sim/simulator.ts:28`, `stepOnce` at `packages/core/src/sim/step.ts:356`, `nextBoundary` at `packages/core/src/sim/timeBoundary.ts:55`, `assertSimulationClock` at `packages/core/src/sim/timeBoundary.ts:71`, `assertHorizonReached`, and `runElapsedSec`. The named list above is not every hop in that trace.

A reverse execution trace of `readEtaOutput` (`maxDepth` 3, `maxNodes` 32) names only its declaration. Source review shows the call at `packages/cli/src/io/etaOutput.test.ts:47`. That line is the review. It is not a graph hop.

A trace from `createPlannerStrategy` to `stepOnce` (`maxDepth` 3, `maxNodes` 32) lists both endpoint symbols and no hop. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:358`. That edge stays unobserved.

There is no RNG. The PR-09 fixtures are literals in `packages/core/src/sim/analysis/eta.semantics.test.ts`. The older cases stay in `eta.test.ts`, whose `it.each` titles are printf-formatted and are not a static runner registration. Follow-up on this change, macOS arm64, Bun `1.4.2`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, `bun run test:conformance`, and `bun run public:check` exited 0. The first `bun run readme:smoke` exited 1 because the CLI build saw `packages/core/package.json` change during a pack. The retry exited 0. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run install:smoke`, and `bun run review:smoke` exited 0. `bun test --cwd packages/core --timeout 120000 src/sim/analysis/eta.semantics.test.ts` exited 0. `bun test --cwd packages/cli --timeout 120000 src/io/etaOutput.test.ts` exited 0. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, a Linux host, and CI were not run.

## PR-10 callers

Queried on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `executeResetCycles` at `packages/core/src/sim/analysis/resetCycle.ts:269`, `applyDecisions` at `packages/core/src/sim/step.ts:403`, `emitCommittedResets` at `packages/core/src/sim/observation.ts:94`, `resetAdapterFor` at `packages/core/src/sim/analysis/resetCycle.ts:229`, and `stepOnce` at `packages/core/src/sim/step.ts:618`. Lookup of `createPlannerStrategy` places it at `packages/core/src/sim/strategy/planner.ts:286`. The `applyDecisions` lookup also returns `applyOfflineSeconds`, `applySheetCsv`, and `applyAccumulatePolicy`. Those are not this payment helper.

A reverse execution trace of `executeResetCycles` (`maxDepth` 3, `maxNodes` 32) names `runsThreeCommittedResets` at `packages/core/src/sim/analysis/resetCycle.test.ts:176`, `recordsRejectedResetWithoutReward` at `packages/core/src/sim/analysis/resetCycle.test.ts:384`, and `excludesOpeningRewardFromDelta` at `packages/core/src/sim/analysis/resetCycle.test.ts:491`. It does not name a CLI command. Source review shows `packages/cli/src/commands/prestigeCycle.ts` still calls `analyzePrestigeCycle`. That call is the review. It is not a hop to `executeResetCycles`.

A reverse execution trace of `applyDecisions` (`maxDepth` 3, `maxNodes` 32) names only its declaration and returns caller spans: `packages/core/src/sim/analysis/resetCycle.ts:392`, `packages/core/src/sim/step.ts:625` inside `stepOnce`, the `stepOnce` calls at `packages/core/src/sim/simulator.ts:104` and `packages/core/src/sim/offline.ts:199`, `packages/core/src/sim/analysis/resetCycle.test.ts:210`, `packages/core/src/sim/step.bulk.test.ts:123`, and `packages/core/src/sim/strategy/planner.regression.test.ts:125`. The listed spans are not every span in that trace.

A reverse execution trace of `emitCommittedResets` (`maxDepth` 3, `maxNodes` 32) names only its declaration and returns the call spans at `packages/core/src/sim/simulator.ts:115`, `packages/core/src/sim/offline.ts:219`, `packages/core/src/sim/analysis/resetCycle.ts:430`, and `packages/core/src/sim/analysis/resetCycle.test.ts:222`. Source review confirms those three production calls.

A reverse execution trace of `resetAdapterFor` (`maxDepth` 3, `maxNodes` 32) names `executeResetCycles` and the same three tests.

A trace from `createPlannerStrategy` to `stepOnce` (`maxDepth` 3, `maxNodes` 32) lists both endpoint symbols and no hop. Lookup places `stepOnce` at `packages/core/src/sim/step.ts:618` because `applyDecisions` was extracted above it. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:358`. That edge stays unobserved.

The reset-cycle repro seed is `0x7110` in `packages/core/src/sim/analysis/resetCycle.test.ts`. Follow-up on this change, macOS arm64, Bun `1.4.2`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify:quick`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, `bun run test:conformance`, and `bun run public:check` exited 0. `bun run typecheck` includes `evidence:check` and `format:check`, and both passed. `bun run contracts:generate` exited 0 before that check. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, `bun run readme:smoke`, `bun run install:smoke`, and `bun run review:smoke` exited 0. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, a Linux host, and CI were not run.

## PR-12 callers

Queried on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `fitGrowth` at `packages/core/src/sim/analysis/growthFit.ts:627`, `fitGrowthFromRun` at `packages/core/src/sim/analysis/growthFit.ts:722`, `analyzeGrowth` at `packages/core/src/sim/analysis/growth.ts:79`, and `legacyGrowthSpeedBucket` at `packages/core/src/sim/analysis/growth.ts:68`. Lookup of `createPlannerStrategy` places it at `packages/core/src/sim/strategy/planner.ts:286`. Lookup of `stepOnce` places it at `packages/core/src/sim/step.ts:618`.

A reverse execution trace of `fitGrowth` (`maxDepth` 3, `maxNodes` 32) names `fitGrowthFromRun` at `packages/core/src/sim/analysis/growthFit.ts:722`, `fitSpec` at `packages/core/src/sim/analysis/growth.fit.test.ts:119`, `separatesShapeFromSpeed` at `packages/core/src/sim/analysis/growth.fit.test.ts:205`, `refusesDisguisedDomains` at `packages/core/src/sim/analysis/growth.fit.test.ts:285`, and `preservesLegacyNetWorthFallback` at `packages/core/src/sim/analysis/growth.fit.test.ts:384`. It does not name a CLI command. Source review shows `packages/cli/src/commands/growth.ts:61`, `packages/cli/src/commands/report.ts:100`, and `packages/cli/src/lib/experience.ts:265` still call `analyzeGrowth`. Those lines are the review. They are not hops to `fitGrowth`.

A reverse execution trace of `fitGrowthFromRun` (`maxDepth` 3, `maxNodes` 32) names the same three tests. It does not name a CLI command.

A reverse execution trace of `analyzeGrowth` (`maxDepth` 3, `maxNodes` 32) names `snapshotFromSession` at `packages/cli/src/lib/experience.ts:249`, `separatesShapeFromSpeed`, `preservesLegacyNetWorthFallback`, `evaluateVisibleProgress` at `packages/cli/src/lib/designObjectives.ts:52`, `evaluateMilestoneTime` at `packages/cli/src/lib/designObjectives.ts:95`, `evaluateExperienceBalanced` at `packages/cli/src/lib/designObjectives.ts:144`, and `collectExperienceSnapshot` at `packages/cli/src/lib/experience.ts:309`. The named list above is not every span in that trace. It does not name `commands/growth.ts` or `commands/report.ts`. Source review shows those calls at `packages/cli/src/commands/growth.ts:61` and `packages/cli/src/commands/report.ts:100`. Those lines are the review. They are not extra graph hops. The 32-node cap is not every caller.

A reverse execution trace of `legacyGrowthSpeedBucket` (`maxDepth` 3, `maxNodes` 32) names `classify` at `packages/core/src/sim/analysis/growth.ts:75`, `classifyPositive` at `packages/core/src/sim/analysis/growthFit.ts:425`, `analyzeGrowth` at `packages/core/src/sim/analysis/growth.ts:79`, `classifySlice` at `packages/core/src/sim/analysis/growthFit.ts:513`, `fitGrowth` at `packages/core/src/sim/analysis/growthFit.ts:627`, `snapshotFromSession` at `packages/cli/src/lib/experience.ts:249`, `separatesShapeFromSpeed`, and `preservesLegacyNetWorthFallback`. The CLI name is reached through `analyzeGrowth`. It is not a direct call of the bucket helper, and it is not a hop from the CLI to `fitGrowth`.

A forward execution trace of `fitGrowth` (`maxDepth` 2, `maxNodes` 32) reaches `assertSampling` at `packages/core/src/sim/analysis/growthFit.ts:184`, `preparePoints` at `packages/core/src/sim/analysis/growthFit.ts:222`, `evenKeep` at `packages/core/src/sim/analysis/growthFit.ts:233`, `irregularSpacing` at `packages/core/src/sim/analysis/growthFit.ts:379`, `baseArtifact` at `packages/core/src/sim/analysis/growthFit.ts:576`, `blankWindow` at `packages/core/src/sim/analysis/growthFit.ts:402`, `pushBreak`, `slicesOf` at `packages/core/src/sim/analysis/growthFit.ts:534`, `classifySlice` at `packages/core/src/sim/analysis/growthFit.ts:513`, `GrowthFitRejected`, `readPoint`, `rollup`, `domainOf`, and `classifyPositive` at `packages/core/src/sim/analysis/growthFit.ts:425`.

A forward execution trace of `fitGrowthFromRun` (`maxDepth` 2, `maxNodes` 32) reaches `fitGrowth`, `softcapOf` at `packages/core/src/sim/analysis/growthFit.ts:708`, `Model.netWorth` at `packages/core/src/sim/types.ts:217`, and `Model.analytic` at `packages/core/src/sim/types.ts:219`, then the first-level `fitGrowth` callees listed above.

A trace from `createPlannerStrategy` to `stepOnce` (`maxDepth` 3, `maxNodes` 32) lists both endpoint symbols and no hop. The rollout call remains `d.stepOnce` on `PlannerDeps` at `packages/core/src/sim/strategy/planner.ts:358`. That edge stays unobserved.

There is no RNG. The growth-shape repro is `fixtures/conformance/growth-shapes.json`, generator version 1, slope tolerance `0.0001`. The PR-12 cases live in `packages/core/src/sim/analysis/growth.fit.test.ts`. The `analyzeGrowth` cases stay in `growth.test.ts`, whose `it.each` title is printf-formatted and is not a static runner registration. Follow-up on this change, macOS arm64, Bun `1.4.2`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run test:conformance`, `bun run build`, `bun run runtime:check`, `bun run compat:check`, `bun run replay:verify`, `bun run docs:verify`, `bun run templates:check`, `bun run contracts:check`, `bun run graph:check`, and `bun run public:check` exited 0. `bun run typecheck` includes `evidence:check` and `format:check`, and both passed. `bun run contracts:generate` exited 0 before that check. `bun run --cwd packages/cli generate:check`, `bun run --cwd packages/cli doctor:completions`, and `bun run review:smoke` exited 0. The first `bun run install:smoke` and the first two `bun run readme:smoke` runs exited 1 with a ttsc unstable-generation error: the CLI build saw `packages/core/package.json` change while the core pack rewrote it. The install retry and the next two readme runs exited 0. `bench:sim:check`, `bench:sim:suite:check`, `tune:regress`, `kpi:report`, `kpi:regress`, `bunx ttsc -p tsconfig.tools.json`, `bunx ttsc -p tsconfig.examples.json`, `test:conformance:extended`, a Linux host, and CI were not run.
## PR-11 callers

Queried against the tree of this change on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Lookup places `analyzeResetPolicies` at `packages/core/src/sim/analysis/resetOptimization.ts:749` and `executeResetCycles` at `packages/core/src/sim/analysis/resetCycle.ts:321`. Source review places `runScenario` at `packages/core/src/sim/simulator.ts:28`, `applyDecisions` at `packages/core/src/sim/step.ts:403`, `stepOnce` at `packages/core/src/sim/step.ts:618`, and `sessionActiveBlocks` at `packages/core/src/sim/session.ts:215`.

A reverse execution trace of `analyzeResetPolicies` (`maxDepth` 3, `maxNodes` 32) names `matchesTheoreticalRewardRate` at `packages/core/src/sim/analysis/resetOptimization.test.ts:126`, `separatesEmpiricalStability` at `packages/core/src/sim/analysis/resetOptimization.test.ts:206`, `reportsRecoveryCrossing` at `packages/core/src/sim/analysis/resetOptimization.test.ts:283`, `keepsManualResetInsideSession` at `packages/core/src/sim/analysis/resetOptimization.test.ts:346`, and `ranksScanWithoutNumberCollapse` at `packages/core/src/sim/analysis/resetOptimization.test.ts:391`. It does not name a CLI command. Source review shows `packages/cli/src/commands/prestigeCycle.ts:60` still calls `analyzePrestigeCycle`. That call is the review. It is not a hop to `analyzeResetPolicies`.

A forward execution trace of `commitReset` (`maxDepth` 2, `maxNodes` 16) names `applyDecisions` at `packages/core/src/sim/step.ts:403`, `recordPrestigeReset` at `packages/core/src/sim/constraints.ts:68`, and `emitCommittedResets` at `packages/core/src/sim/observation.ts:94`.

A reverse execution trace of `executeResetCycles` (`maxDepth` 3, `maxNodes` 32) names `evaluateAlwaysActive` at `packages/core/src/sim/analysis/resetOptimization.ts:583`, `analyzeResetPolicies`, the five reset-policy tests, and `runsThreeCommittedResets`, `recordsRejectedResetWithoutReward`, and `excludesOpeningRewardFromDelta` in `resetCycle.test.ts`. It does not name `evaluateSession` at `packages/core/src/sim/analysis/resetOptimization.ts:637`. Source review shows the session path commits through `commitReset` at `packages/core/src/sim/analysis/resetOptimization.ts:401`. That call is the review. It is not a hop to `executeResetCycles`.

There is no RNG. The reset-policy repro is `fixtures/conformance/reset-policy-rate.json`. The expected rate is `0.1` over completed cycle time. Matching that fixture is not a steady-state proof. `provedSteadyState` stays false. The gates for this change are listed in its pull request.
## PR-13 callers

Queried against the tree of this change on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Source review places `analyzeDistribution` at `packages/core/src/sim/analysis/distribution.ts:367`, `firstVisibleDistributionSample` at `packages/core/src/sim/analysis/distribution.ts:228`, `summarizeExperienceMonteCarlo` at `packages/cli/src/lib/experience.ts:342`, and `simulateMonteCarlo` at `packages/core/src/sim/monteCarlo.ts:74`.

A reverse execution trace of `analyzeDistribution` (`maxDepth` 3, `maxNodes` 32) names `summarizeExperienceMonteCarlo` at `packages/cli/src/lib/experience.ts:342`, `separatesCensoringFromObservedQuantiles` at `packages/core/src/sim/analysis/distribution.test.ts:63`, `fixesQuantileRanksAndKeys` at `packages/core/src/sim/analysis/distribution.test.ts:131`, `checksSeededDropAndZeroVariance` at `packages/core/src/sim/analysis/distribution.test.ts:290`, and `separatesMeansAndCensorsMissingVisibleChange` at `packages/core/src/sim/analysis/distribution.test.ts:327`.

A reverse execution trace of `firstVisibleDistributionSample` (`maxDepth` 3, `maxNodes` 32) names `summarizeExperienceMonteCarlo` and `separatesMeansAndCensorsMissingVisibleChange`. The CLI call is at `packages/cli/src/lib/experience.ts:396`.

A reverse execution trace of `summarizeExperienceMonteCarlo` (`maxDepth` 3, `maxNodes` 32) names only its declaration. Source review shows the calls at `packages/cli/src/commands/experience.ts:113` and `packages/cli/src/commands/evaluate.ts:217`. Those lines are the review. They are not graph hops.

A reverse execution trace of `simulateMonteCarlo` (`maxDepth` 3, `maxNodes` 32) names `evaluateVisibleProgress`, `evaluateMilestoneTime`, and `evaluateExperienceBalanced` in `packages/cli/src/lib/designObjectives.ts`, `summarizeExperienceMonteCarlo` and `summarizeComparableExperienceMetric` at `packages/cli/src/lib/experience.ts:459`, `isolatesIndependentRuns` at `packages/core/src/sim/runFactory.test.ts:161`, and the `run` helper in `keepsLogicalDrawsIndependentOfOrder` at `packages/core/src/sim/analysis/distribution.test.ts:245`.

The distribution repro is `fixtures/conformance/independent-drop.json`, seed `28947` (`0x7113`), 10000 draws, probability `0.01`, absolute tolerance `0.005`. The stateful logical-draw check uses the same seed. Execution in this change is local. Worker count is not an input to the seed. The gates for this change are listed in its pull request.
## PR-14 callers

Queried against the tree of this change on macOS arm64 with Bun `1.4.2`, `@ttsc/graph` `0.30.4`, protocol `2025-11-25`. No generation identifier. The server cwd was this worktree and the program was `tsconfig.graph.json`. Source review places `runExperiment` at `packages/core/src/sim/analysis/experiment.ts:702`, `normalizeSpec` at `packages/core/src/sim/analysis/experiment.ts:335`, and `requireSpec` at `packages/core/src/sim/analysis/experiment.ts:357`.

A reverse execution trace of `runExperiment` (`maxDepth` 3, `maxNodes` 32) names `runWith` at `packages/core/src/sim/analysis/experiment.test.ts:150`, `checksLocalElasticityDirection` at `packages/core/src/sim/analysis/experiment.test.ts:181`, `rejectsUnsafeParametersBeforeRun` at `packages/core/src/sim/analysis/experiment.test.ts:321`, `keepsCandidateOrderAndScenario` at `packages/core/src/sim/analysis/experiment.test.ts:457`, `skipsCensoredHorizonForSensitivity` at `packages/core/src/sim/analysis/experiment.test.ts:559`, `matchesHandPareto` at `packages/core/src/sim/analysis/experiment.test.ts:624`, `startsCandidatesFromScenario` at `packages/core/src/sim/analysis/experiment.test.ts:743`, `keepsLargeEngineAmounts` at `packages/core/src/sim/analysis/experiment.test.ts:834`, the conformance relation `checkConstantIncomeExperiment` at `packages/core/src/testkit/conformance.ts:132`, and its corpus test `replaysConstantIncomeExperimentAcrossTheSeedCorpus` at `packages/core/src/testkit/conformance.test.ts:2122`. It does not name the CLI command. Source review shows the call at `packages/cli/src/commands/experiment.ts:80`. That line is the review. It is not a graph hop.

The constant-income example has no RNG. The parameter-experiment repro is `fixtures/conformance/parameter-experiment.json`, seed `28948`. One-at-a-time local sensitivity is not global sensitivity and is not a Sobol index. The gates for this change are listed in its pull request.
