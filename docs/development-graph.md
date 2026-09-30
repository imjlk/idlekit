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

`tsconfig.graph.json` is noEmit. It includes money, core, and CLI sources (CLI keeps `jsx: react-jsx` and `jsxImportSource: @opentui/react`), CLI scripts, generated `.bunli` output, and top-level `tools/*.ts`. `@ttsc/lint` is `enabled: false` on this program so the evidence graph is not applied here. Package `tsconfig.json` files stay authoritative when the aggregate program would only expose a `.d.ts` boundary. There is no root `tsconfig.json`.

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
