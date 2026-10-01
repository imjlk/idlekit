import {
  defaultExecutionBudget,
  finalizeBatch,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
  type ExecutionBatchV1,
  type ExecutionBudgetV1,
} from "@idlekit/core";

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Explicit worker counts share one logical digest. The pool does not choose itself.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section: selection stays explicit-worker and shutdown terminates every slot.
 */
export const workerPoolParity = "same-logical-digest" as const;

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((error: unknown) => void) | null;
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
    status: reason === "abort" ? "cancelled" : reason === "timeout" || reason === "not-started" ? "incomplete" : "failed",
    reason,
    attempts,
    semanticDigest: null,
    endMoney: null,
  };
}

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
  const batchId = `worker-${args.workers}-${args.tasks.length}`;
  const serializedBytes = JSON.stringify(args.tasks).length;
  const header = {
    batchId,
    backend: "worker" as const,
    selection: "explicit-worker" as const,
    workerSpawnMs: 0,
    serializedBytes,
  };
  if (args.tasks.length === 0) return finalizeBatch([], header);
  if (args.tasks.length > budget.queueBound) {
    return finalizeBatch(
      args.tasks.map((task) => failed(task, "queue-bound", 0)),
      header,
    );
  }
  const spawn = args.spawn ?? defaultSpawn;
  const started = performance.now();
  const live: WorkerLike[] = [];
  const make = (): WorkerLike | null => {
    if (live.length >= args.workers) return null;
    const worker = spawn(live.length);
    live.push(worker);
    return worker;
  };
  for (let slot = 0; slot < Math.min(args.workers, args.tasks.length); slot += 1) make();
  header.workerSpawnMs = performance.now() - started;
  const queue = [...args.tasks];
  const attempts = new Map<string, number>();
  const finished = new Map<string, AnalysisTrialOutcomeV1>();

  const pump = (worker: WorkerLike): void => {
    if (args.signal?.aborted) return;
    const task = queue.shift();
    if (!task) return;
    const attempt = attempts.get(task.taskId) ?? 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      finished.set(task.taskId, failed(task, "timeout", attempt + 1));
      const replacement = live.length < args.workers + args.tasks.length ? spawn(live.length) : null;
      if (replacement) {
        live.push(replacement);
        pump(replacement);
      }
    }, budget.taskTimeoutMs);
    worker.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const outcome = (event.data as { outcome?: AnalysisTrialOutcomeV1 } | null)?.outcome;
      if (!outcome || outcome.taskId !== task.taskId) {
        finished.set(task.taskId, failed(task, "worker-crash", attempt + 1));
      } else {
        finished.set(task.taskId, {
          ...outcome,
          taskId: task.taskId,
          logicalIndex: task.logicalIndex,
          seed: task.seed,
          attempts: attempt + 1,
        });
      }
      pump(worker);
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (attempt < budget.maxRetries) {
        attempts.set(task.taskId, attempt + 1);
        queue.unshift(task);
      } else {
        finished.set(task.taskId, failed(task, "worker-crash", attempt + 1));
      }
      const replacement = spawn(live.length);
      live.push(replacement);
      pump(replacement);
    };
    worker.postMessage({ type: "run", task });
  };

  try {
    for (const worker of [...live]) pump(worker);
    const pending = () => args.tasks.some((task) => !finished.has(task.taskId));
    const idleAt = performance.now() + budget.taskTimeoutMs * (budget.maxRetries + 2) + 1_000;
    while (pending() && !args.signal?.aborted && performance.now() < idleAt) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const outcomes = args.tasks.map((task) => {
      const outcome = finished.get(task.taskId);
      if (outcome) return outcome;
      return failed(task, args.signal?.aborted ? "abort" : "not-started", attempts.get(task.taskId) ?? 0);
    });
    return finalizeBatch(outcomes, header);
  } finally {
    for (const worker of live) worker.terminate();
  }
}
