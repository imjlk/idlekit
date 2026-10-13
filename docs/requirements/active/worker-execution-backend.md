# Worker execution backend

## The default backend is local {#req-dx05-local-default}

Requirement `REQ-DX05-LOCAL-DEFAULT`. `DX-05` owns it.

`executionLocalDefault` is `local-default`. `defaultExecutionBudget.maxWorkers` is `0`. Core does not construct `Bun.Worker`, import `worker_threads`, or call the network. A small batch records worker spawn time as `0` and serialized bytes. Nothing in this module selects a worker count automatically. DX-04 has no measurement that workers are cheaper for a small analysis batch, so the selection stays `local-default` until a caller asks for workers.

The executed test is `keepsLocalDefault` in `packages/core/src/sim/executionBackend.test.ts`.

## A task is a JSON descriptor {#req-dx05-serializable-task}

Requirement `REQ-DX05-SERIALIZABLE-TASK`. `DX-05` owns it.

`executionSerializableTask` is `json-descriptor`. The seed is `logicalDrawSeed(base, logicalIndex)`. Worker count and completion order are not seed inputs. A function payload, a class instance, a cyclic payload, and a step budget that is not a non-negative safe integer are refused. A shared reference that is not a cycle is allowed. Plugin paths and roots are string arrays and plugin digests a plain string record. A task whose step budget exceeds the execution budget's `stepBudget` is refused in both backends. The whole descriptor is checked, so an extra own function property is refused, and a worker post that still throws fails only that task. The worker pool reports the queue bound as `incomplete`, as the local backend does. `taskRefusals` checks every task before any cost is measured, so a refused task fails alone and its siblings still run. `serializedTaskBytes` is the UTF-8 byte length of a task's JSON, and `serializedBytes` sums it over the tasks that may run. The descriptor carries the scenario parameters, the logical id, the seed, the step budget, and the plugin path, root, and digest lists.

The executed test is `keepsSerializableTasks` in `packages/core/src/sim/executionBackend.test.ts`.

## Reduction follows the logical index {#req-dx05-stable-reduction}

Requirement `REQ-DX05-STABLE-REDUCTION`. `DX-05` owns it.

`executionStableReduction` is `logical-index`. Outcomes are sorted by logical index before the money total. The total is `addDecimalStrings`, not `Number()` and not completion order. It accepts plain and scientific decimal strings, such as the break-infinity serde `1e+400`, and sums them exactly, including an exponent past Number's safe range. A scientific input gives an exact scientific total. Two amounts whose exponents differ by more than 100000 digits have no exact total and the reduction is null. An empty batch is not a full distribution.

The executed test is `reducesInLogicalOrder` in `packages/core/src/sim/executionBackend.test.ts`.

## Failure, cancellation, and incomplete stay distinct {#req-dx05-failure-boundary}

Requirement `REQ-DX05-FAILURE-BOUNDARY`. `DX-05` owns it.

`executionFailureBoundary` is `not-a-partial-distribution`. Abort is `cancelled`. Timeout and the queue bound are `incomplete`. `taskTimeoutMs` bounds each task on its own, and every attempt, whatever it returned: a failed attempt that ran past the window is `incomplete` `timeout` and is not retried. The local backend runs a synchronous runner in this process to completion, so the window labels an attempt that ran over but cannot stop one that never returns; a hard per-task stop is the worker pool's terminating timer. An abort before submit cancels every task, a refused one and one over the queue bound too, in both backends. There is no batch-wide window, so a later task is not timed out by the time earlier tasks used. A runner that throws is a `failed` `trial-failed` outcome of that task, retried like any other failure, and the batch keeps going. A retryable failure keeps the same task id and seed and stops at `maxRetries`. `assertExecutionBudget` refuses a budget with a non-finite or negative field, or a `taskTimeoutMs` past the 2147483647 ms timer range, before either backend runs a task. An aborted or oversized batch is answered before any descriptor is measured. `plugin-trust` is not retried. `fullDistribution` is true only when every outcome is `ok`.

The executed test is `boundsFailures` in `packages/core/src/sim/executionBackend.test.ts`.

## Workers keep the logical digest {#req-dx05-worker-parity}

Requirement `REQ-DX05-WORKER-PARITY`. `DX-05` owns it.

`workerPoolParity` is `same-logical-digest`. `trialPluginBoundary` is `plugin-policy-not-widened`. `workerEntryMarker` is `idlekit-worker-entry`. Local, one worker, two workers, and four workers return the same per-trial semantic digest and end money. A reversed completion order is sorted back to the logical index. Crash is `failed`. Timeout is `incomplete`. Abort is `cancelled`. A posted `failed` outcome other than `plugin-trust` is retried within `maxRetries`, like a crash. Each dispatched task has its own timer and the pool has no batch-wide deadline. Shutdown clears every timer and detaches every handler, so nothing fires or respawns after the batch returns. Pool state is keyed by task position, so two tasks with one id report separately. A worker count above `budget.maxWorkers` is refused. The pool runs a snapshot of the submitted descriptors and a frozen copy of its budget. Only the entry's marked outcome envelope ends a task; another message from the worker is ignored. No `idk` command selects the pool in this release. A slot that ran a plugin trial is retired, so each plugin trial starts in a fresh worker with fresh plugin module state. A worker that exits without an error event, such as through `process.exit`, is a crash of the task it held. A spawn that throws settles the batch, and work left with no slot is `failed` `worker-spawn`. `plugin-trust` means the loader refused the plugins; an error thrown after they load is `trial-failed`, whatever its message says. A trial whose step budget stops the run before its horizon is `incomplete` `step-budget`. An empty batch is not a full distribution. A plugin path with no parent root, a path outside the parent roots, a symlink whose realpath leaves them, or a mismatched digest is `plugin-trust`. The worker does not add a root. Break-infinity end money is the serde string, not `Infinity`. The CLI JS bundle entry list includes `src/runtime/workers/entry.ts`. The pool terminates its slots on shutdown. The entry does not branch on a preload variable.

The executed tests are `matchesWorkerDigests`, `reversesCompletionOrder`, `boundsPoolFailures`, `refusesUntrustedPlugins`, `roundTripsBreakInfinity`, and `packsWorkerAsset` in `packages/cli/src/runtime/workers/pool.test.ts`.
