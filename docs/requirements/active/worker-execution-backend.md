# Worker execution backend

## The default backend is local {#req-dx05-local-default}

Requirement `REQ-DX05-LOCAL-DEFAULT`. `DX-05` owns it.

`executionLocalDefault` is `local-default`. `defaultExecutionBudget.maxWorkers` is `0`. Core does not construct `Bun.Worker`, import `worker_threads`, or call the network. A small batch records worker spawn time as `0` and serialized bytes. Nothing in this module selects a worker count automatically. DX-04 has no measurement that workers are cheaper for a small analysis batch, so the selection stays `local-default` until a caller asks for workers.

The executed test is `keepsLocalDefault` in `packages/core/src/sim/executionBackend.test.ts`.

## A task is a JSON descriptor {#req-dx05-serializable-task}

Requirement `REQ-DX05-SERIALIZABLE-TASK`. `DX-05` owns it.

`executionSerializableTask` is `json-descriptor`. The seed is `logicalDrawSeed(base, logicalIndex)`. Worker count and completion order are not seed inputs. A function payload and a class instance are refused. The descriptor carries the scenario parameters, the logical id, the seed, the step budget, and the plugin path, root, and digest lists.

The executed test is `keepsSerializableTasks` in `packages/core/src/sim/executionBackend.test.ts`.

## Reduction follows the logical index {#req-dx05-stable-reduction}

Requirement `REQ-DX05-STABLE-REDUCTION`. `DX-05` owns it.

`executionStableReduction` is `logical-index`. Outcomes are sorted by logical index before the money total. The total is `addDecimalStrings`, not `Number()` and not completion order. An empty batch is not a full distribution.

The executed test is `reducesInLogicalOrder` in `packages/core/src/sim/executionBackend.test.ts`.

## Failure, cancellation, and incomplete stay distinct {#req-dx05-failure-boundary}

Requirement `REQ-DX05-FAILURE-BOUNDARY`. `DX-05` owns it.

`executionFailureBoundary` is `not-a-partial-distribution`. Abort is `cancelled`. Timeout and the queue bound are `incomplete`. A retryable failure keeps the same task id and seed and stops at `maxRetries`. `plugin-trust` is not retried. `fullDistribution` is true only when every outcome is `ok`.

The executed test is `boundsFailures` in `packages/core/src/sim/executionBackend.test.ts`.

## Workers keep the logical digest {#req-dx05-worker-parity}

Requirement `REQ-DX05-WORKER-PARITY`. `DX-05` owns it.

`workerPoolParity` is `same-logical-digest`. `trialPluginBoundary` is `plugin-policy-not-widened`. `workerEntryMarker` is `idlekit-worker-entry`. Local, one worker, two workers, and four workers return the same per-trial semantic digest and end money. A reversed completion order is sorted back to the logical index. Crash is `failed`. Timeout is `incomplete`. Abort is `cancelled`. An empty batch is not a full distribution. A plugin path with no parent root, a path outside the parent roots, or a mismatched digest is `plugin-trust`. The worker does not add a root. Break-infinity end money is the serde string, not `Infinity`. The CLI JS bundle entry list includes `src/runtime/workers/entry.ts`. The pool terminates its slots on shutdown. The entry does not branch on a preload variable.

The executed tests are `matchesWorkerDigests`, `reversesCompletionOrder`, `boundsPoolFailures`, `refusesUntrustedPlugins`, `roundTripsBreakInfinity`, and `packsWorkerAsset` in `packages/cli/src/runtime/workers/pool.test.ts`.
