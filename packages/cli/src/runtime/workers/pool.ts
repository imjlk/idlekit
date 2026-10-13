import {
  defaultExecutionBudget,
  finalizeBatch,
  serializedTaskBytes,
  taskRefusals,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
  type ExecutionBatchV1,
  type ExecutionBudgetV1,
} from "@idlekit/core";

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Explicit worker counts share one logical digest. The pool does not choose itself.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #ee2513d Re-read the section: selection stays explicit-worker, the count stays within maxWorkers, an exit is a crash, and shutdown terminates every slot and clears every timer.
 */
export const workerPoolParity = "same-logical-digest" as const;

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  /** Bun reports a worker that exits on its own, such as through process.exit, as a close event, not as an error. */
  addEventListener?(type: "close", listener: () => void): void;
}

export function workerEntryUrl(): URL {
  return new URL("./entry.ts", import.meta.url);
}

const workerDevPreload = ["@ttsc/unplugin/bun-register"] as const;

function defaultSpawn(): WorkerLike {
  return new Worker(workerEntryUrl(), { preload: [...workerDevPreload] }) as unknown as WorkerLike;
}

function failed(task: AnalysisTrialTaskV1, reason: string, attempts: number): AnalysisTrialOutcomeV1 {
  return {
    taskId: task.taskId,
    logicalIndex: task.logicalIndex,
    seed: task.seed,
    // Same classes as the local backend: queue-bound is incomplete there too.
    status:
      reason === "abort"
        ? "cancelled"
        : reason === "timeout" || reason === "not-started" || reason === "queue-bound"
          ? "incomplete"
          : "failed",
    reason,
    attempts,
    semanticDigest: null,
    endMoney: null,
  };
}

/*
 * Internal state is keyed by the position of a task in `args.tasks`, not by its taskId, so two
 * tasks that share an id still run and report separately. Each dispatched task has its own
 * timer of `taskTimeoutMs`; there is no batch-wide deadline, so a long queue on few workers
 * is not cut short. Every timer is cleared and every handler detached before the batch
 * resolves, so nothing fires or respawns after shutdown.
 */
export async function runWorkerPool(args: Readonly<{
  tasks: readonly AnalysisTrialTaskV1[];
  workers: number;
  budget?: ExecutionBudgetV1;
  signal?: AbortSignal;
  spawn?: (slot: number) => WorkerLike;
}>): Promise<ExecutionBatchV1> {
  if (!Number.isInteger(args.workers) || args.workers < 1) {
    throw new Error("worker pool requires an explicit worker count >= 1");
  }
  const budget = args.budget ?? { ...defaultExecutionBudget, maxWorkers: args.workers };
  if (args.workers > budget.maxWorkers) {
    throw new Error(`worker pool count ${args.workers} exceeds budget maxWorkers ${budget.maxWorkers}`);
  }
  const batchId = `worker-${args.workers}-${args.tasks.length}`;
  // Validate before measuring, as the local backend does. A refused task fails alone and posts nothing.
  const refusals = taskRefusals(args.tasks, budget);
  // Dispatch is asynchronous, so the pool works on a snapshot: a later change to the caller's array or
  // descriptors cannot slip past the checks above. A valid descriptor is plain JSON, so the copy is exact.
  const tasks: readonly AnalysisTrialTaskV1[] = args.tasks.map((task, index) =>
    refusals[index] === null ? (JSON.parse(JSON.stringify(task)) as AnalysisTrialTaskV1) : task,
  );
  const serializedBytes = tasks.reduce((sum, task, index) => (refusals[index] === null ? sum + serializedTaskBytes(task) : sum), 0);
  const header = {
    batchId,
    backend: "worker" as const,
    selection: "explicit-worker" as const,
    workerSpawnMs: 0,
    serializedBytes,
  };
  if (tasks.length === 0) return finalizeBatch([], header);
  if (tasks.length > budget.queueBound) {
    return finalizeBatch(
      tasks.map((task) => failed(task, "queue-bound", 0)),
      header,
    );
  }
  // An abort before submit cancels every task, refused or not, as the local backend does.
  if (args.signal?.aborted) return finalizeBatch(tasks.map((task) => failed(task, "abort", 0)), header);
  const results: (AnalysisTrialOutcomeV1 | undefined)[] = tasks.map((task, index) => {
    const refusal = refusals[index];
    return refusal ? failed(task, refusal, 1) : undefined;
  });
  const attempts = tasks.map(() => 0);
  const queue = tasks.flatMap((_task, index) => (refusals[index] === null ? [index] : []));
  const finalize = (): ExecutionBatchV1 =>
    finalizeBatch(
      tasks.map(
        (task, index) =>
          results[index] ??
          failed(task, args.signal?.aborted ? "abort" : spawnFailed ? "worker-spawn" : "not-started", attempts[index] ?? 0),
      ),
      header,
    );
  if (args.signal?.aborted || queue.length === 0) return finalize();

  const spawn = args.spawn ?? defaultSpawn;
  // A replacement follows a crash, a timeout, or a finished plugin trial. Each task can cost at most maxRetries + 2 of them.
  const spawnLimit = args.workers + queue.length * (budget.maxRetries + 2);
  const live = new Set<WorkerLike>();
  const idle = new Set<WorkerLike>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let spawned = 0;
  let closed = false;
  let spawnFailed = false;

  return await new Promise<ExecutionBatchV1>((resolveBatch) => {
    const detach = (worker: WorkerLike): void => {
      worker.onmessage = null;
      worker.onerror = null;
    };
    const retire = (worker: WorkerLike): void => {
      detach(worker);
      worker.terminate();
      live.delete(worker);
      idle.delete(worker);
    };
    const finish = (): void => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const worker of [...live]) retire(worker);
      args.signal?.removeEventListener("abort", finish);
      resolveBatch(finalize());
    };
    const done = (): boolean => results.every((outcome) => outcome !== undefined);
    const requeue = (index: number, attempt: number): boolean => {
      if (attempt >= budget.maxRetries) return false;
      attempts[index] = attempt + 1;
      queue.unshift(index);
      return true;
    };

    const dispatch = (worker: WorkerLike): void => {
      if (closed) return;
      const index = queue.shift();
      if (index === undefined) {
        detach(worker);
        idle.add(worker);
        return;
      }
      const task = tasks[index]!;
      const attempt = attempts[index] ?? 0;
      let settled = false;
      const settle = (): boolean => {
        if (settled || closed) return false;
        settled = true;
        clearTimeout(timer);
        timers.delete(timer);
        return true;
      };
      const timer = setTimeout(() => {
        if (!settle()) return;
        results[index] = failed(task, "timeout", attempt + 1);
        retire(worker);
        feed();
      }, budget.taskTimeoutMs);
      timers.add(timer);
      worker.onmessage = (event) => {
        if (!settle()) return;
        const outcome = (event.data as { outcome?: AnalysisTrialOutcomeV1 } | null)?.outcome;
        if (!outcome || outcome.taskId !== task.taskId) {
          results[index] = failed(task, "worker-crash", attempt + 1);
        } else if (outcome.status === "failed" && outcome.reason !== "plugin-trust" && requeue(index, attempt)) {
          // A posted failure retries like a crash and like the local backend. plugin-trust does not.
        } else {
          results[index] = {
            ...outcome,
            taskId: task.taskId,
            logicalIndex: task.logicalIndex,
            seed: task.seed,
            attempts: attempt + 1,
          };
        }
        if (task.pluginPaths.length > 0) {
          // Plugin modules keep module state in the worker that imported them. A slot that ran a plugin trial
          // is retired, so each plugin trial starts in a fresh worker and the result does not depend on how
          // trials were spread over workers.
          retire(worker);
        } else {
          dispatch(worker);
        }
        feed();
      };
      worker.onerror = () => {
        if (!settle()) return;
        if (!requeue(index, attempt)) results[index] = failed(task, "worker-crash", attempt + 1);
        retire(worker);
        feed();
      };
      try {
        worker.postMessage({ type: "run", task });
      } catch {
        // A message the worker cannot receive fails this task alone. The slot stays usable.
        if (!settle()) return;
        results[index] = failed(task, "not serializable", attempt + 1);
        dispatch(worker);
        feed();
      }
    };

    // Spawn cost covers every slot the batch opens, replacements included.
    const start = (): void => {
      const before = performance.now();
      let worker: WorkerLike;
      try {
        worker = spawn(spawned);
      } catch {
        // A slot that cannot be built stops further spawns. Work still queued with no live slot is worker-spawn.
        spawnFailed = true;
        spawned = spawnLimit;
        return;
      }
      header.workerSpawnMs += performance.now() - before;
      spawned += 1;
      live.add(worker);
      worker.addEventListener?.("close", () => {
        // A slot the pool retired is no longer live, so its own terminate is ignored here.
        if (closed || !live.has(worker)) return;
        if (worker.onerror) {
          // An exit during a task is a crash of that task: same retry and same reason.
          worker.onerror(new Error("worker exited"));
          return;
        }
        live.delete(worker);
        idle.delete(worker);
        feed();
      });
      dispatch(worker);
    };

    // Hand queued work to idle slots, replace a lost slot while the spawn limit allows, and finish when nothing can run.
    const feed = (): void => {
      if (closed) return;
      for (const worker of [...idle]) {
        if (queue.length === 0) break;
        idle.delete(worker);
        dispatch(worker);
      }
      while (queue.length > 0 && live.size < args.workers && spawned < spawnLimit && !closed) start();
      if (done() || (queue.length > 0 && live.size === 0) || (queue.length === 0 && idle.size === live.size)) finish();
    };

    args.signal?.addEventListener("abort", finish, { once: true });
    feed();
  });
}
