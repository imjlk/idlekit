# Worker execution backend

Korean version: [worker-execution_ko.md](./worker-execution_ko.md)

`DX-05` adds an optional Bun worker pool for independent analysis trials. The core contract submits, cancels, and bounds a batch. It does not construct `Bun.Worker`, read files, or call the network. The CLI adapter owns the pool. The default selection is `local-default`. A caller that wants workers passes an explicit count. No `idk` command selects the pool in this release: it is an internal adapter in the CLI package, and wiring a command to it is later work. DX-04 has no measurement that a small analysis batch is cheaper on workers, so nothing in this change auto-selects a pool.

A task is a versioned JSON descriptor: scenario parameters, logical index, seed, step budget, engine id, and plugin path, root, and digest lists. The worker rebuilds a fresh run from the trusted linear factory and the existing serde. A trial without plugin paths runs on the built-in registries. The worker entry hands the trial the CLI plugin loader, and a trial with plugin paths but no loader fails closed as `plugin-trust`. It does not receive a compiled closure, a function, or a native decimal instance. The draw seed is `logicalDrawSeed(base, logicalIndex)`. Worker count and completion order are not seed inputs. Reproduction label is `19`.

Results are sorted by logical index before the money total. The total is an exact decimal-string sum that also accepts the scientific serde strings break-infinity end money uses. Completion order is not the addition order. `fullDistribution` is true only when every outcome is `ok`. Abort is `cancelled`. Timeout and the queue bound are `incomplete`. `taskTimeoutMs` is a per-task window in both backends, with no batch-wide deadline. A step budget that stops a trial before its horizon is `incomplete`. A retry keeps the same task id and seed, is count-limited, and does not retry `plugin-trust`. A thrown local trial and a posted worker failure both retry. A refused or cyclic task fails alone; a shared acyclic reference is fine. A failed attempt past its window is a timeout and is not retried. A worker that exits on its own is a crash, a spawn that throws settles the batch as `worker-spawn`, and `plugin-trust` is a loader refusal rather than a message match. `serializedBytes` is UTF-8 bytes. A worker count above `budget.maxWorkers` and a task step budget above `budget.stepBudget` are refused, each plugin trial runs in a fresh worker, the local backend cannot stop a synchronous runner that never returns (the worker pool can), and shutdown leaves no timer or replacement worker behind. The worker copies the parent plugin roots and digests. An empty root list does not allow every file.

The JS bundle entry list includes `src/runtime/workers/entry.ts`, and that entry is built with the same transform plugin as the CLI. The bundle root is `src`, so `dist/main.js` stays the bin and the worker is `dist/runtime/workers/entry.js`. Every dev worker receives the same preload list. The entry does not branch on a preload variable. Native compile stays a single entry. Node `worker_threads`, a Cloudflare runner, a multi-machine queue, and paid execution are out of scope.

The sample descriptor is [examples/analysis/worker-trial.json](../examples/analysis/worker-trial.json). Requirements are [worker-execution-backend.md](./requirements/active/worker-execution-backend.md). Performance budgets stay in [performance-budget.md](./performance-budget.md).

Node.js and browser runtimes are not part of the v1 compatibility contract.

## Verification

Commands below were run from this worktree on macOS arm64 with Bun 1.4.2 and ttsc 0.30.4. Requirement file sha256 `6d1789d2c2e00d29d85b5104842f8efaa845a4c067afc279c4380c08800fa7d2`. `typecheck`, `test`, `build`, `compat:check`, `replay:verify`, and `docs:verify` are unrun.

| Command | Exit |
|---|---|
| `bun install --frozen-lockfile` | 0 |
| `bun test src/sim/executionBackend.test.ts` (from `packages/core`) | 0 |
| `bun test --timeout 90000 src/runtime/workers/pool.test.ts` (from `packages/cli`) | 0 |
| `bun run evidence:check` | 0 |
| `bun run format:check` | 0 |
| `bun run graph:check` | 0 |
| graph query (cwd is this worktree) | 0 |
| `bun run runtime:check` | 0 |
| `bun run public:check` | 0 |

The first `evidence:check` exited 2 on placeholder reviews and two missing handler citations. The next exited 2 on those handler reviews. The rerun exited 0. `graph:check` left `createPlannerStrategy` to `stepOnce` unobserved at hops 0.

The PR #223 review fixes changed the requirement file to sha256 `a3ec097d9064581c0651834eebcd3e46845f5a3559d90a8be07722704df13d1c`. That revision ran `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, `executionBackend.test.ts` from `packages/core`, and `pool.test.ts` from `packages/cli`.

## Graph

Queried with `ttsc-graph` 0.30.4 on `tsconfig.graph.json`, protocol `2025-11-25`, no generation identifier, shutdown 0. Lookup places `runLocalBatch` at `packages/core/src/sim/executionBackend.ts:241`, `finalizeBatch` at `packages/core/src/sim/executionBackend.ts:198`, `runWorkerPool` at `packages/cli/src/runtime/workers/pool.ts:46`, and `runAnalysisTrial` at `packages/cli/src/runtime/workers/trial.ts:101`. A reverse execution trace (`maxDepth` 2, `maxNodes` 32) of `runWorkerPool` names the pool hosts in `pool.test.ts`. The same trace of `finalizeBatch` names `runLocalBatch` and `runWorkerPool`. `graph:check` reported `ok unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })`. The forward trace (`maxDepth` 2, `maxNodes` 12) listed both declarations and did not add a call edge. Hops 0 is not conformance.
