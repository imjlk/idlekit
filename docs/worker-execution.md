# Worker execution backend

Korean version: [worker-execution_ko.md](./worker-execution_ko.md)

`DX-05` adds an optional Bun worker pool for independent analysis trials. The core contract submits, cancels, and bounds a batch. It does not construct `Bun.Worker`, read files, or call the network. The CLI adapter owns the pool. The default selection is `local-default`. A caller that wants workers passes an explicit count. No `idk` command selects the pool in this release: it is an internal adapter in the CLI package, and wiring a command to it is later work. `@idlekit/cli` publishes only the `idk` bin and no library export, so neither the shipped CLI nor an import of the npm package reaches the pool; the bundled worker asset ships unused until a command selects the pool, and only the packaged pool test runs it. DX-04 has no measurement that a small analysis batch is cheaper on workers, so nothing in this change auto-selects a pool.

A task is a versioned JSON descriptor: scenario parameters, logical index, seed, step budget, engine id, and plugin path, root, and digest lists. The worker rebuilds a fresh run from the trusted linear factory and the existing serde. A trial without plugin paths runs on the built-in registries. The worker entry hands the trial the CLI plugin loader, and a trial with plugin paths but no loader fails closed as `plugin-trust`. It does not receive a compiled closure, a function, or a native decimal instance. The draw seed is `logicalDrawSeed(base, logicalIndex)`. Worker count and completion order are not seed inputs. Reproduction label is `19`.

Results are sorted by logical index before the money total. The total is an exact decimal-string sum that also accepts the scientific serde strings break-infinity end money uses. Completion order is not the addition order. `fullDistribution` is true only when every outcome is `ok`. Abort is `cancelled`. Timeout and the queue bound are `incomplete`. `taskTimeoutMs` is a per-task window in both backends, with no batch-wide deadline. A step budget that stops a trial before its horizon is `incomplete`. A retry keeps the same task id and seed, is count-limited, and does not retry `plugin-trust`. A thrown local trial and a posted worker failure both retry. A refused or cyclic task fails alone; a shared acyclic reference is fine. A failed attempt past its window is a timeout and is not retried. A worker that exits on its own is a crash, a spawn that throws settles the batch as `worker-spawn`, and `plugin-trust` is a loader refusal rather than a message match. `serializedBytes` is UTF-8 bytes. A worker count above `budget.maxWorkers` and a task step budget above `budget.stepBudget` are refused, each plugin trial runs in a fresh worker, the local backend cannot stop a synchronous runner that never returns (the worker pool can), its timeout only relabels an attempt after the runner returns, an abort raised while a local runner runs cancels that attempt once the runner returns, whatever it returned, and shutdown leaves no timer or replacement worker behind. The worker copies the parent plugin roots and digests. An empty root list does not allow every file.

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

The PR #223 review fixes changed the requirement file to sha256 `9ea2fb7348d2d06130092635188d64ad6139e70bef82b892b12a90ce0de43d6e`. That revision ran `bun run typecheck`, `bun run test:conformance`, `bun run contracts:check`, `executionBackend.test.ts` from `packages/core`, and `pool.test.ts` from `packages/cli`.

## Graph

Queried commit `e13b5cf2c0f6ba35831e1e6d0a1c7afa27096667` with `ttsc-graph` 0.30.4, protocol `2025-11-25`. Queries ran from the repository root using focused programs extending `packages/core/tsconfig.json` with `packages/core/src/sim/executionBackend.ts` as its root file, and `packages/cli/tsconfig.json` with `packages/cli/src/runtime/workers/pool.ts` as its root file. No generation identifier was returned.

Compiler details reported `runLocalBatch` at `packages/core/src/sim/executionBackend.ts:462–563`, `finalizeBatch` at `packages/core/src/sim/executionBackend.ts:419–456`, and `runWorkerPool` at `packages/cli/src/runtime/workers/pool.ts:73–309`. The bounded impact traces (`maxDepth: 1`) reached the local call to `finalizeBatch` at line 485, the pool call at line 101, and its finalization callback at line 126. Both traces reported `truncated: true`; other callers remain unobserved by these queries. These source spans guide reading. Evidence and conformance use separate test gates.

The JS bundle resolves runtime/workers/entry.js and starts it with no TypeScript preload. Source development workers retain entry.ts and the compiler preload. The packaged regression runs from an isolated consumer directory without compiler dependencies. Security admission errors carry PluginTrustError and stay non-retryable plugin-trust; admitted module evaluation and registration failures become trial-failed and use the existing bounded retry policy. Custom loaders must use the explicit error type for policy refusals.

Sparse batch slots are refused individually. Repeated logical-index/task-id pairs are refused before execution, while the same task id at different logical indices remains valid. Admission refusals record zero attempts. Production trial payloads have no crash or hang controls; fault injection uses a separate test worker entry.

Worker tasks copy `loadRegistries(...).pluginDigest` into `pluginDigests`. The loader recomputes and verifies this entry-and-local-import closure before evaluating the plugin, so changed helpers are refused as `plugin-trust`. This is separate from `--plugin-sha256` and trust-file entry hashes, whose existing meaning is unchanged. A plugin with no local imports has the same entry and closure hash.
