# Development graph

Korean version: [development-graph_ko.md](./development-graph_ko.md)

`TC-04` connects the pinned `@ttsc/graph` `0.30.4` server to this repository. The bin is `node_modules/.bin/ttsc-graph`. The server is a local stdio process. It does not upload source to a remote graph service. `@ttsc/graph` stays a root devDependency. `@idlekit/money`, `@idlekit/core`, and `@idlekit/cli` do not depend on it, and `idk` bundle output does not import it.

## Reproduce a query

From the repository root, with Bun `1.3.10`:

```bash
bun tools/graph-query.ts --question "Where is runScenario declared?" --request '{"type":"lookup","query":"runScenario"}'
```

`graph-query.ts` starts `ttsc-graph --cwd <root> --tsconfig tsconfig.graph.json`, performs MCP `initialize`, reads `inspect_typescript_graph` from `tools/list`, and sends only fields that schema publishes. Wrapper fields (`question`, `draft`, `review`, `request`) come from that schema. A field that is not in the live branch exits the process. The printed lines are symbol, file, and line. A span that carries a declaration signature prints that signature after the location. A trace also prints `from -> to` hop lines, using symbol names rather than node ids. The output is not a raw dump.

`bun run graph:check` is the gate. It checks initialize, tool discovery, lookup, caller and callee traces, workspace source spans, scratch rename / signature / citation updates, one signature edit read by the session that was already open, and stdin shutdown. `--help` alone is not a pass.

## Program

`tsconfig.graph.json` is noEmit. It includes money, core, and CLI sources, CLI scripts, and top-level `tools/*.ts`. `@ttsc/lint` is `enabled: false` on this program so the evidence graph is not applied here. Package `tsconfig.json` files stay authoritative when the aggregate program would only expose a `.d.ts` boundary. There is no root `tsconfig.json`.

## Agent config

`.mcp.json.example` matches Claude Code's project MCP file, pointed at the local bin. Its POSIX `command` is `node_modules/.bin/ttsc-graph`. On Windows, copy `windowsCommand` (`node_modules/.bin/ttsc-graph.cmd`) into that `command` before use. `.codex/config.toml.example` matches the Codex project config keys documented at <https://learn.chatgpt.com/codex/extend/mcp> (`command`, `args`, `cwd`, `startup_timeout_sec`, `tool_timeout_sec`) and names the same Windows `.cmd` path. Copy them into the project-local file. Do not edit `~/.codex/config.toml` from this change. The Codex tool timeout is raised because the first `inspect_typescript_graph` call builds the index after the handshake.

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
