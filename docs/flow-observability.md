# Flow observability

Korean version: [flow-observability_ko.md](./flow-observability_ko.md)

`PR-15` reads optional resource and process samples. It reports throughput, capacity, queue, saturation time, material-shortage time, and wait time inside an evidence window. It does not add a production-network runtime, and it does not start a second simulator loop.

A model that does not observe flow stays `unsupported`. `flowResult("statically-known")` without samples is `insufficient-data` with reason `flow observations were not supplied`. A growth stall is not a capacity bottleneck. `stallMapped` stays false.

A confirmed capacity constraint needs a saturated process, a strictly greater upstream offer, slack downstream capacity when that capacity was observed, and a causal model or experiment that names the process. Otherwise the same bind is suspected. Capacity and upstream samples are matched by the resource each edge names and by one evidence window. Downstream slack counts every feed into that destination, and the bind cites the edges and downstream evidence it used. A downstream capacity in another unit proves no slack. Starved time without a bind is a suspected material shortage. Blocked time without a bind is a suspected demand shortage. Each process is judged on its own starved and blocked samples, so one report can carry several hypotheses. Every saturated process is a candidate, bound on its latest saturated window. The causally named bind is confirmed and listed first, and the others stay suspected. A process with both starved and blocked time keeps an `insufficient-data` hypothesis. Each terminal process reports a final throughput for every delivered resource, from its latest window. A nonzero derived amount below the rounding step keeps its own spelling. An upstream offer is read from throughput, or from inflow when throughput is absent. A graph with edges but no terminal process reports no final throughput. Without edges, every throughput series reports one. A lone throughput, with neither capacity nor wait, stays `insufficient-data`.

Little's law runs only when the capability is statically known, both the observation and its window are steady, and the work flow is defined. Ramp-up is `not-applicable`. A consistent result does not itself confirm a cause.

An edge with a different destination unit uses `inflow * numerator / denominator * (1 - loss)`. Queue plus unretained must match that amount in the destination unit. The source unit is not added to the destination unit. Queue and unretained are read for the edge's destination resource in the source sample's window. Every source window is tried, and edges into the same destination resource are summed. An amount or product that overflows a finite number is never a match, and zero matches only zero. When several windows conserve, the latest one is reported. The same document shape covers logistics, crafting, and expedition-slot fixtures. Resource names stay in `examples/analysis/flow-pipeline.json`. Seed `15` labels that file.

Facts and hypotheses are separate. A hypothesis links to samples through `evidenceRefs`. A confirmed capacity constraint also cites `causal`, the record it rests on.

Amounts use the decimal wire spelling with an optional sign and exponent, such as `1e2`. `parseFlowObservation` rejects an amount, edge ratio, or Little's law input that is not a finite non-negative decimal, a sample whose `endSec` is before its `startSec`, a duplicate sample key, a duplicate edge, a zero denominator, and a loss above 1.

The structural contract is `idlekit.flow.v1` at [docs/schemas/flow.v1.schema.json](./schemas/flow.v1.schema.json). The generator also writes [docs/schemas/generated/flow.v1.schema.json](./schemas/generated/flow.v1.schema.json). This does not replace `ScenarioV1` or the money metrics.

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `bf4d2ae94d558af428fcdaabfad590f316827488ca3ea236ff9e847778053874`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, and `docs:verify` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test --timeout 120000 src/sim/analysis/flow.test.ts src/sim/analysis/analysisContract.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 120000 src/scenario/scenarioContract.test.ts` (from `packages/core`) | 0 |
| `bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts` | 0 |
| `bun run contracts:check` | 0 |
| `bun run runtime:check` | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| `bun run public:check` | 0 |

The first two `evidence:check` runs exited 2 on placeholder reviews. The rerun after those reviews exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0.

## Graph

Queried with `ttsc-graph` 0.30.4 on `tsconfig.graph.json`, protocol `2025-11-25`, no generation identifier, shutdown 0. `diagnoseFlow` is declared at `packages/core/src/sim/analysis/flow.ts:392`. `recordFlowSample` is declared at `packages/core/src/sim/observation.ts:132`. An impact trace of `diagnoseFlow` names tests `declaresFlowAdapter`, `diagnosesSteadyPipeline`, `checksFlowConservation`, `leavesUnknownModelsUnsupported`, and `separatesFactsFromCauses`. An impact trace of `recordFlowSample` names `declaresFlowAdapter`. Those tests are the callers the graph sees. The JSON fixture `examples/analysis/flow-pipeline.json` is outside the graph.
