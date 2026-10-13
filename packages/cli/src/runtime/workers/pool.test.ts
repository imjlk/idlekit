import { describe, expect, it } from "bun:test";
import ttsc from "@ttsc/unplugin/bun";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  addDecimalStrings,
  analysisTaskSeed,
  builtinStrategyFactories,
  createModelRegistry,
  createStrategyRegistry,
  defaultExecutionBudget,
  finalizeBatch,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
} from "@idlekit/core";
import { sha256Hex } from "../../runtime/bun";
import { checkTrialParity } from "../../../../core/src/testkit/conformance";
import { runWorkerPool, workerEntryUrl, workerPoolParity, type WorkerLike } from "./pool";
import { analysisTrialScenario, runAnalysisTrial, trialPluginBoundary } from "./trial";

/** Real workers under the dev preload start slowly, most of all several at once on Windows. */
const REAL_WORKER_TIMEOUT_MS = 180_000;

function trial(logicalIndex: number, payload: Record<string, unknown> = {}): AnalysisTrialTaskV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.execution-task.v1",
    taskId: `trial-${logicalIndex}`,
    logicalIndex,
    seed: analysisTaskSeed(19, logicalIndex),
    stepBudget: 1000,
    kind: "analysis-trial",
    payload: { stepSec: 1, durationSec: 3, incomePerSec: "1", ...payload },
    pluginPaths: [],
    pluginRoots: [],
    pluginDigests: {},
  };
}

function echo(task: AnalysisTrialTaskV1): AnalysisTrialOutcomeV1 {
  return {
    taskId: task.taskId,
    logicalIndex: task.logicalIndex,
    seed: task.seed,
    status: "ok",
    reason: "ok",
    attempts: 1,
    semanticDigest: `${task.logicalIndex}:${task.seed}`,
    endMoney: String(task.logicalIndex),
  };
}

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  terminated = false;
  private readonly closeListeners: (() => void)[] = [];
  addEventListener(_type: "close", listener: () => void): void {
    this.closeListeners.push(listener);
  }
  constructor(
    private readonly mode: "reverse" | "crash" | "hang" | "slow" | "fail-once" | "exit",
    private readonly order: number[],
    private readonly delayMs = 1,
  ) {}
  postMessage(message: unknown): void {
    const task = (message as { task: AnalysisTrialTaskV1 }).task;
    if (this.mode === "crash") {
      queueMicrotask(() => this.onerror?.(new Error("crash")));
      return;
    }
    if (this.mode === "hang") return;
    if (this.mode === "exit") {
      // A worker that calls process.exit: Bun fires close, not error.
      queueMicrotask(() => {
        for (const listener of this.closeListeners) listener();
      });
      return;
    }
    const delay = this.mode === "reverse" ? (4 - task.logicalIndex) * 5 : this.delayMs;
    setTimeout(() => {
      if (this.terminated) return;
      this.order.push(task.logicalIndex);
      // fail-once posts a retryable failure the first time it sees a logical index.
      const firstFailure = this.mode === "fail-once" && this.order.filter((index) => index === task.logicalIndex).length === 1;
      const outcome: AnalysisTrialOutcomeV1 = firstFailure
        ? { ...echo(task), status: "failed", reason: "trial-failed", semanticDigest: null, endMoney: null }
        : echo(task);
      // A stray message first, as a plugin might post. The pool must wait for the marked outcome.
      this.onmessage?.({ data: { type: "ready" } });
      this.onmessage?.({ data: { type: "outcome", outcome } });
      this.onmessage?.({ data: { type: "outcome", marker: "idlekit-worker-entry", outcome } });
    }, delay);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Local, one worker, two workers, and four workers share the trial digest.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: the four pool sizes passed the declared trial-parity relation against the local batch,
 * @evidence ../../../../core/src/testkit/conformance.ts#checkTrialParity Compares each worker batch with the local batch.
 * @evidenceReview ../../../../core/src/testkit/conformance.ts#checkTrialParity #d6b01f7 One, two, and four workers each matched the local batch on every outcome's index, seed, status, digest, and end money, and a real trial that called process.exit was a worker-crash well inside the window.
 * @evidence ./pool.ts#workerPoolParity Reads the parity marker.
 * @evidenceReview ./pool.ts#workerPoolParity #f3f1470 The declaration is same-logical-digest.
 * @evidence ./entry.ts#workerEntryMarker Reads the packed entry marker.
 * @evidenceReview ./entry.ts#workerEntryMarker #f670bfc The declaration is idlekit-worker-entry.
 * @evidence ./pool.ts#runWorkerPool Runs the tasks on an explicit number of workers.
 * @evidenceReview ./pool.ts#runWorkerPool #9039cb8 Re-read the event-driven pool: one, two, and four real workers return the local digests, end money, and seeds in logical order.
 * @evidence ./pool.ts#workerEntryUrl Names the worker module the pool spawns.
 * @evidenceReview ./pool.ts#workerEntryUrl #62d3255 The URL is entry.ts next to the pool module.
 * @evidence ./trial.ts#runAnalysisTrial Runs one trial and returns its digest and end money.
 * @evidenceReview ./trial.ts#runAnalysisTrial #9fe8a84 Re-read the trial after the step-budget check: each of the four local trials runs on the built-in registries without a loader and is ok with a digest, and the worker run matches it.
 * @evidence ./trial.ts#analysisTrialScenario Builds the trial scenario from the payload.
 * @evidenceReview ./trial.ts#analysisTrialScenario #1eb1d48 The payload step, horizon, and income reach the scenario clock and model params.
 */
export function matchesWorkerDigests(): Promise<void> {
  return (async () => {
    expect(workerPoolParity).toBe("same-logical-digest");
    // The entry imports the plugin loader, which this test does not load. Read its marker from the source.
    const entrySource = readFileSync(new URL("./entry.ts", import.meta.url), "utf8");
    expect(entrySource.includes('export const workerEntryMarker = "idlekit-worker-entry" as const;')).toBe(true);
    // The pool accepts only outcomes carrying that marker.
    const poolSource = readFileSync(new URL("./pool.ts", import.meta.url), "utf8");
    expect(poolSource.includes('const WORKER_OUTCOME_MARKER = "idlekit-worker-entry";')).toBe(true);
    expect(workerEntryUrl().pathname.endsWith("/runtime/workers/entry.ts")).toBe(true);
    const scenario = analysisTrialScenario(trial(0));
    expect(scenario.clock).toEqual({ stepSec: 1, durationSec: 3 });
    expect(scenario.model.params).toMatchObject({ incomePerSec: "1" });
    const tasks = [0, 1, 2, 3].map((index) => trial(index));
    const localOutcomes = [];
    for (const task of tasks) localOutcomes.push(await runAnalysisTrial(task));
    const local = finalizeBatch(localOutcomes, {
      batchId: "local",
      backend: "local",
      selection: "local-default",
      workerSpawnMs: 0,
      serializedBytes: 0,
    });
    expect(local.fullDistribution).toBe(true);
    expect(local.outcomes.every((outcome) => outcome.semanticDigest !== null)).toBe(true);
    for (const workers of [1, 2, 4]) {
      // Under the dev preload each worker transforms the sources on start, and the first task on a slot carries that
      // start. Concurrent cold starts on a Windows runner took more than 30 s, so this window is wider than the default.
      const batch = await runWorkerPool({
        tasks,
        workers,
        budget: { ...defaultExecutionBudget, maxWorkers: workers, taskTimeoutMs: REAL_WORKER_TIMEOUT_MS },
      });
      expect(batch.selection).toBe("explicit-worker");
      expect(batch.fullDistribution).toBe(true);
      // Parity is the declared conformance relation, so it is the same check the seed corpus runs.
      const parity = checkTrialParity(true, local, batch);
      expect(parity.applicable).toBe(true);
      if (!parity.ok) throw new Error(parity.summary);
      expect(batch.outcomes.map((outcome) => outcome.seed)).toEqual(tasks.map((task) => task.seed));
    }
    // A real worker whose trial calls process.exit is a crash at once, not a timeout after the long window.
    const exitStarted = performance.now();
    const exiting = await runWorkerPool({
      tasks: [trial(0, { fault: "crash" }), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: REAL_WORKER_TIMEOUT_MS },
    });
    expect(exiting.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["failed", "worker-crash"],
      ["ok", "ok"],
    ]);
    expect(performance.now() - exitStarted).toBeLessThan(REAL_WORKER_TIMEOUT_MS);
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A reversed completion order still reports logical index order.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: the later index finished first and the batch stayed sorted.
 * @evidence ./pool.ts#workerPoolParity Reads the parity marker.
 * @evidenceReview ./pool.ts#workerPoolParity #f3f1470 The declaration is same-logical-digest.
 * @evidence ./pool.ts#WorkerLike.onmessage The pool reads completion from this handler.
 * @evidenceReview ./pool.ts#WorkerLike.onmessage #4aec04b Re-read the handler: a later logical index can finish first and the batch stays sorted.
 * @evidence ./pool.ts#WorkerLike.postMessage The pool sends each task through this method.
 * @evidenceReview ./pool.ts#WorkerLike.postMessage #7a74bd5 Each fake worker received a run message for its task.
 * @evidence ./pool.ts#WorkerLike.terminate The pool shuts every slot down through this method.
 * @evidenceReview ./pool.ts#WorkerLike.terminate #a32377e Every fake worker was terminated after the batch.
 */
export function reversesCompletionOrder(): Promise<void> {
  return (async () => {
    const seen: number[] = [];
    const workers: FakeWorker[] = [];
    const batch = await runWorkerPool({
      tasks: [0, 1, 2, 3].map((index) => trial(index)),
      workers: 4,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 2_000, maxWorkers: 4 },
      spawn: () => {
        const worker = new FakeWorker("reverse", seen);
        workers.push(worker);
        return worker;
      },
    });
    expect(seen[0]).toBe(3);
    expect(batch.outcomes.map((outcome) => outcome.logicalIndex)).toEqual([0, 1, 2, 3]);
    expect(batch.reduction.endMoney).toBe("6");
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Crash, timeout, abort, and shutdown do not become a full distribution.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: the crashed and timed-out batches were not full, six queued tasks on one worker all finished in their own windows, a posted failure retried, an abort left no timer or spawn behind, twin ids reported separately, a count above maxWorkers was refused, cost counted UTF-8 bytes, an infinite budget field was refused before any spawn, an oversized batch reported no bytes, a budget raised after submit did not reach the batch, a mid-flight abort counted the running attempt, a step budget above the execution budget was refused, a pre-aborted batch cancelled a refused task and one over the queue bound, unmarked messages were ignored, a mutated caller array changed nothing, each plugin trial took a fresh slot while built-in trials shared one, queue-bound was incomplete, a decorated task and a throwing post each failed alone, an exit without an error event was a retried crash, a throwing spawn settled as worker-spawn, a plugin error after loading was trial-failed while a loader refusal was plugin-trust, and a step-budget stop was incomplete.
 * @evidence ./pool.ts#WorkerLike.addEventListener The pool hears a worker that exits on its own through the close event.
 * @evidenceReview ./pool.ts#WorkerLike.addEventListener #e8b001c A fake worker that only fires close made its task a worker-crash and was retried once.
 * @evidence ./pool.ts#runWorkerPool Bounds each task by its own timer, retries posted failures, and shuts down without leftovers.
 * @evidenceReview ./pool.ts#runWorkerPool #9039cb8 Re-read start, dispatch, feed, and finish: state is keyed by position, the count is checked against maxWorkers, close routes to the crash path, a throwing spawn stops spawning, a throwing post fails only its task, queue-bound is incomplete, the batch runs a JSON snapshot, a plugin trial retires its slot, the budget is a frozen copy checked before any spawn, an abort counts the in-flight attempt, admission precedes the snapshot, a pre-abort cancels every task before the queue bound, only a marked outcome envelope settles a task, and finish clears timers and detaches handlers.
 * @evidence ./trial.ts#runAnalysisTrial Reports a step-budget stop as incomplete.
 * @evidenceReview ./trial.ts#runAnalysisTrial #9fe8a84 A budget of two steps on a three-second horizon is incomplete step-budget with no end money, three steps is ok, a throwing trusted model is trial-failed, and a refusing loader is plugin-trust.
 * @evidence ./pool.ts#workerPoolParity Reads the parity marker.
 * @evidenceReview ./pool.ts#workerPoolParity #f3f1470 The declaration is same-logical-digest.
 * @evidence ./pool.ts#WorkerLike.onerror The pool reads a worker crash from this handler.
 * @evidenceReview ./pool.ts#WorkerLike.onerror #a258190 Re-read the handler: a crash stays failed and the batch is not a full distribution.
 */
export function boundsPoolFailures(): Promise<void> {
  return (async () => {
    const crashed = await runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 1, maxRetries: 0 },
      spawn: () => new FakeWorker("crash", []),
    });
    expect(crashed.outcomes[0]!.status).toBe("failed");
    expect(crashed.outcomes[0]!.reason).toBe("worker-crash");
    expect(crashed.fullDistribution).toBe(false);

    const timed = await runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 30, maxWorkers: 1 },
      spawn: () => new FakeWorker("hang", []),
    });
    expect(timed.outcomes[0]!.status).toBe("incomplete");
    expect(timed.outcomes[0]!.reason).toBe("timeout");
    expect(timed.fullDistribution).toBe(false);

    const aborted = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      signal: AbortSignal.abort(),
      spawn: () => new FakeWorker("hang", []),
    });
    expect(aborted.outcomes.every((outcome) => outcome.status === "cancelled")).toBe(true);
    expect(aborted.fullDistribution).toBe(false);

    const empty = await runWorkerPool({ tasks: [], workers: 1, spawn: () => new FakeWorker("hang", []) });
    expect(empty.outcomes).toEqual([]);
    expect(empty.fullDistribution).toBe(false);

    // Each task fits its own window. One worker drains six of them (about 2100 ms) past a batch-wide bound of 2 * 450 + 1000 ms.
    const queued = await runWorkerPool({
      tasks: [0, 1, 2, 3, 4, 5].map((index) => trial(index)),
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 450, maxWorkers: 1, maxRetries: 0 },
      spawn: () => new FakeWorker("slow", [], 350),
    });
    expect(queued.outcomes.map((outcome) => outcome.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(queued.fullDistribution).toBe(true);

    // A posted retryable failure is retried, as a crash and the local backend are.
    const seenOnce: number[] = [];
    const recovered = await runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 1, maxRetries: 1 },
      spawn: () => new FakeWorker("fail-once", seenOnce),
    });
    expect(recovered.outcomes[0]).toMatchObject({ status: "ok", attempts: 2 });

    // Abort after dispatch. No timer fires and no replacement spawns once the batch has returned.
    let spawns = 0;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const stopped = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 50, maxWorkers: 1 },
      signal: controller.signal,
      spawn: () => {
        spawns += 1;
        return new FakeWorker("hang", []);
      },
    });
    const spawnsAtReturn = spawns;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(spawns).toBe(spawnsAtReturn);
    expect(stopped.outcomes.map((outcome) => outcome.status)).toEqual(["cancelled", "cancelled"]);

    // Two tasks that share an id still run and report separately.
    const twins = await runWorkerPool({
      tasks: [trial(0), { ...trial(1), taskId: "trial-0" }],
      workers: 2,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 2 },
      spawn: () => new FakeWorker("slow", [], 1),
    });
    expect(twins.outcomes.map((outcome) => [outcome.logicalIndex, outcome.endMoney])).toEqual([
      [0, "0"],
      [1, "1"],
    ]);
    expect(twins.reduction.endMoney).toBe("1");

    // The budget caps the pool. An explicit count above it is refused, not started.
    await expect(
      runWorkerPool({
        tasks: [trial(0)],
        workers: 8,
        budget: { ...defaultExecutionBudget, maxWorkers: 1 },
        spawn: () => new FakeWorker("hang", []),
      }),
    ).rejects.toThrow("exceeds budget maxWorkers");

    // serializedBytes is UTF-8 bytes of the posted JSON, not UTF-16 code units.
    const wide = { ...trial(0), taskId: "트라이얼-0" };
    const measured = await runWorkerPool({
      tasks: [wide],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 1 },
      spawn: () => new FakeWorker("slow", [], 1),
    });
    expect(measured.cost.serializedBytes).toBe(new TextEncoder().encode(JSON.stringify(wide)).byteLength);
    expect(measured.cost.serializedBytes).toBeGreaterThan(JSON.stringify(wide).length);

    // The pool refuses a budget with a non-finite field before spawning anything.
    let unspawned = 0;
    await expect(
      runWorkerPool({
        tasks: [trial(0)],
        workers: 1,
        budget: { ...defaultExecutionBudget, maxWorkers: 1, maxRetries: Number.POSITIVE_INFINITY },
        spawn: () => {
          unspawned += 1;
          return new FakeWorker("hang", []);
        },
      }),
    ).rejects.toThrow("execution budget");
    expect(unspawned).toBe(0);

    // An oversized batch is answered before any copy or measurement.
    const overBoundCost = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, queueBound: 1 },
      spawn: () => new FakeWorker("hang", []),
    });
    expect(overBoundCost.cost.serializedBytes).toBe(0);
    // The pool keeps its own frozen budget: raising maxRetries after submit does not reach a running batch.
    const callerBudget = { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000, maxRetries: 0 };
    const retrySeen: number[] = [];
    const frozenRun = runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: callerBudget,
      spawn: () => new FakeWorker("fail-once", retrySeen, 5),
    });
    callerBudget.maxRetries = 5;
    const frozen = await frozenRun;
    expect(frozen.outcomes[0]).toMatchObject({ status: "failed", reason: "trial-failed", attempts: 1 });

    // The budget's step limit caps every task in the pool too.
    const overSteps = await runWorkerPool({
      tasks: [{ ...trial(0), stepBudget: 5_000 }, trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000, stepBudget: 1_000 },
      spawn: () => new FakeWorker("slow", [], 1),
    });
    expect(overSteps.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["failed", "step budget exceeds the execution budget"],
      ["ok", "ok"],
    ]);

    // Pre-abort outranks the queue bound too.
    const abortedOverBound = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, queueBound: 1 },
      signal: AbortSignal.abort(),
      spawn: () => new FakeWorker("hang", []),
    });
    expect(abortedOverBound.outcomes.map((outcome) => outcome.status)).toEqual(["cancelled", "cancelled"]);
    // A pre-aborted batch cancels every task, a refused one too, as the local backend does.
    const preAborted = await runWorkerPool({
      tasks: [{ ...trial(0), logicalIndex: -1 }, trial(1)],
      workers: 1,
      signal: AbortSignal.abort(),
      spawn: () => new FakeWorker("hang", []),
    });
    expect(preAborted.outcomes.map((outcome) => outcome.status)).toEqual(["cancelled", "cancelled"]);

    // The pool runs a snapshot: changing the caller's array or a queued descriptor after submit changes nothing.
    const callerTasks: AnalysisTrialTaskV1[] = [trial(0), trial(1), trial(2)];
    const seenPosted: number[] = [];
    const snapshotRun = runWorkerPool({
      tasks: callerTasks,
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000 },
      spawn: () => new FakeWorker("slow", seenPosted, 5),
    });
    (callerTasks[2] as { logicalIndex: number }).logicalIndex = 99;
    callerTasks.length = 1;
    const snapshot = await snapshotRun;
    expect(snapshot.outcomes.map((outcome) => outcome.logicalIndex)).toEqual([0, 1, 2]);
    expect(seenPosted).toEqual([0, 1, 2]);

    // A plugin trial leaves module state in its worker, so each one gets a fresh slot. Built-in trials reuse a slot.
    let pluginSpawns = 0;
    const pluginBatch = await runWorkerPool({
      tasks: [0, 1, 2].map((index) => ({ ...trial(index), pluginPaths: ["/plugins/model.ts"], pluginRoots: ["/plugins"] })),
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000 },
      spawn: () => {
        pluginSpawns += 1;
        return new FakeWorker("slow", [], 1);
      },
    });
    expect(pluginBatch.fullDistribution).toBe(true);
    expect(pluginSpawns).toBe(3);
    let builtinSpawns = 0;
    await runWorkerPool({
      tasks: [0, 1, 2].map((index) => trial(index)),
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000 },
      spawn: () => {
        builtinSpawns += 1;
        return new FakeWorker("slow", [], 1);
      },
    });
    expect(builtinSpawns).toBe(1);

    // An abort mid-flight counts the running attempt.
    const midFlight = new AbortController();
    setTimeout(() => midFlight.abort(), 20);
    const counted = await runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: 1_000 },
      signal: midFlight.signal,
      spawn: () => new FakeWorker("hang", []),
    });
    expect(counted.outcomes[0]).toMatchObject({ status: "cancelled", attempts: 1 });

    // queue-bound is incomplete, as in the local backend.
    const overBound = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, queueBound: 1 },
      spawn: () => new FakeWorker("hang", []),
    });
    expect(overBound.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["incomplete", "queue-bound"],
      ["incomplete", "queue-bound"],
    ]);

    // A descriptor with an extra function fails alone before posting, and a post that throws fails only its task.
    const decorated = { ...trial(0), extra: () => 1 } as unknown as AnalysisTrialTaskV1;
    let posts = 0;
    const isolated = await runWorkerPool({
      tasks: [decorated, trial(1), trial(2)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 1 },
      spawn: () => {
        const worker = new FakeWorker("slow", [], 1);
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message: unknown) => {
          posts += 1;
          if ((message as { task: AnalysisTrialTaskV1 }).task.logicalIndex === 1) throw new Error("DataCloneError");
          post(message);
        };
        return worker;
      },
    });
    expect(isolated.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["failed", "not serializable"],
      ["failed", "not serializable"],
      ["ok", "ok"],
    ]);
    expect(posts).toBe(2);

    // An exit without an error event is a crash of the task in flight, retried within the budget, not a timeout.
    let exits = 0;
    const exited = await runWorkerPool({
      tasks: [trial(0)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 60_000, maxWorkers: 1, maxRetries: 1 },
      spawn: () => {
        exits += 1;
        return new FakeWorker("exit", []);
      },
    });
    expect(exited.outcomes[0]).toMatchObject({ status: "failed", reason: "worker-crash", attempts: 2 });
    expect(exits).toBe(2);

    // A spawn that throws settles the batch. Work with no slot left is worker-spawn, and a live slot keeps draining.
    const unbuilt = await runWorkerPool({
      tasks: [trial(0), trial(1)],
      workers: 1,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 1 },
      spawn: () => {
        throw new Error("no worker");
      },
    });
    expect(unbuilt.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
      ["failed", "worker-spawn"],
      ["failed", "worker-spawn"],
    ]);
    let built = 0;
    const halfBuilt = await runWorkerPool({
      tasks: [trial(0), trial(1), trial(2)],
      workers: 2,
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 1_000, maxWorkers: 2 },
      spawn: () => {
        built += 1;
        if (built === 2) throw new Error("no second worker");
        return new FakeWorker("slow", [], 1);
      },
    });
    expect(halfBuilt.outcomes.map((outcome) => outcome.status)).toEqual(["ok", "ok", "ok"]);

    // A trusted plugin that throws while it runs is an ordinary, retryable failure, whatever its message says.
    const plugged = { ...trial(0), pluginPaths: ["/plugins/model.ts"], pluginRoots: ["/plugins"] };
    const throwing = await runAnalysisTrial(plugged, async () => ({
      modelRegistry: createModelRegistry([
        {
          id: "linear",
          version: 1,
          create: () => {
            throw new Error("plugin temporarily unavailable");
          },
        },
      ]),
      strategyRegistry: createStrategyRegistry([...builtinStrategyFactories]),
    }));
    expect(throwing).toMatchObject({ status: "failed", reason: "trial-failed" });
    const refused = await runAnalysisTrial(plugged, async () => {
      throw new Error("loader said no");
    });
    expect(refused).toMatchObject({ status: "failed", reason: "plugin-trust" });

    // A step budget that stops the run before the horizon is incomplete, not an ok end state.
    const cut = await runAnalysisTrial({ ...trial(0, { durationSec: 3 }), stepBudget: 2 });
    expect(cut).toMatchObject({ status: "incomplete", reason: "step-budget", endMoney: null });
    const exact = await runAnalysisTrial({ ...trial(0, { durationSec: 3 }), stepBudget: 3 });
    expect(exact.status).toBe("ok");
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A plugin outside the parent roots is a trust failure.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: an empty root list and a mismatched digest both failed closed, and a symlink inside the root resolving outside it was refused by the loader.
 * @evidence ./trial.ts#trialPluginBoundary Reads the trust marker.
 * @evidenceReview ./trial.ts#trialPluginBoundary #9e0eb13 The declaration is plugin-policy-not-widened.
 * @evidence ./trial.ts#runAnalysisTrial Refuses plugin paths it cannot check.
 * @evidenceReview ./trial.ts#runAnalysisTrial #9fe8a84 An empty root list and plugin paths without a loader fail closed, and in a worker the CLI loader refuses an outside path and a wrong digest.
 */
export function refusesUntrustedPlugins(): Promise<void> {
  return (async () => {
    expect(trialPluginBoundary).toBe("plugin-policy-not-widened");
    const root = join(tmpdir(), `idlekit-dx05-root-${process.pid}`);
    const outside = join(tmpdir(), `idlekit-dx05-out-${process.pid}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const outsideFile = join(outside, "plugin.ts");
    const insideFile = join(root, "plugin.ts");
    writeFileSync(outsideFile, "export {}\n");
    writeFileSync(insideFile, "export {}\n");
    const base = trial(0);
    const open = await runAnalysisTrial({
      ...base,
      pluginPaths: [outsideFile],
      pluginRoots: [],
      pluginDigests: {},
    });
    expect(open.status).toBe("failed");
    expect(open.reason).toBe("plugin-trust");
    // Without a loader, plugin paths fail closed instead of running on the built-ins.
    const unloaded = await runAnalysisTrial({ ...base, pluginPaths: [insideFile], pluginRoots: [root], pluginDigests: {} });
    expect(unloaded.reason).toBe("plugin-trust");
    // The worker entry passes the CLI plugin loader, so the root and digest policy run in the worker.
    const digest = sha256Hex(readFileSync(insideFile));
    const checked = await runWorkerPool({
      tasks: [
        { ...base, taskId: "escaped", pluginPaths: [outsideFile], pluginRoots: [root], pluginDigests: {} },
        {
          ...trial(1),
          taskId: "mismatch",
          pluginPaths: [insideFile],
          pluginRoots: [root],
          pluginDigests: { [resolve(insideFile)]: digest.replace(/./g, "0").slice(0, digest.length) },
        },
      ],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: REAL_WORKER_TIMEOUT_MS },
    });
    expect(checked.outcomes.map((outcome) => outcome.reason)).toEqual(["plugin-trust", "plugin-trust"]);
    // A symlink inside a root that resolves outside it is refused: the loader compares realpaths too.
    // The same valid plugin loads through a real path inside the root, so only the symlink makes the difference.
    const validInside = join(root, "valid.ts");
    const validOutside = join(outside, "valid.ts");
    writeFileSync(validInside, "export default { models: [] };\n");
    writeFileSync(validOutside, "export default { models: [] };\n");
    const link = join(root, "linked.ts");
    rmSync(link, { force: true });
    symlinkSync(validOutside, link);
    const linked = await runWorkerPool({
      tasks: [
        { ...trial(2), taskId: "inside", pluginPaths: [validInside], pluginRoots: [root], pluginDigests: {} },
        { ...trial(3), taskId: "linked", pluginPaths: [link], pluginRoots: [root], pluginDigests: {} },
      ],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: REAL_WORKER_TIMEOUT_MS },
    });
    expect(linked.outcomes.map((outcome) => [outcome.taskId, outcome.status, outcome.reason])).toEqual([
      ["inside", "ok", "ok"],
      ["linked", "failed", "plugin-trust"],
    ]);
    expect(JSON.stringify(checked).includes(digest)).toBe(false);
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A break-infinity amount survives the worker serde.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: local and worker end money matched and were not Infinity, and the two-trial worker batch summed to 2e+400.
 * @evidence ./trial.ts#trialPluginBoundary Reads the trust marker.
 * @evidenceReview ./trial.ts#trialPluginBoundary #9e0eb13 The declaration is plugin-policy-not-widened.
 */
export function roundTripsBreakInfinity(): Promise<void> {
  return (async () => {
    const task = trial(0, { engineId: "breakInfinity", initialAmount: "1e400", incomePerSec: "0", durationSec: 1 });
    const local = await runAnalysisTrial(task);
    const worker = await runWorkerPool({
      tasks: [task, { ...task, taskId: "trial-0b", logicalIndex: 1 }],
      workers: 1,
      budget: { ...defaultExecutionBudget, maxWorkers: 1, taskTimeoutMs: REAL_WORKER_TIMEOUT_MS },
    });
    expect(local.status).toBe("ok");
    expect(worker.outcomes[0]!.status).toBe("ok");
    expect(worker.outcomes[0]!.endMoney).toBe(local.endMoney);
    expect(local.endMoney === "Infinity").toBe(false);
    expect(String(local.endMoney).includes("e")).toBe(true);
    // The scientific serde string is summed exactly, so a full break-infinity batch keeps its total.
    expect(worker.fullDistribution).toBe(true);
    expect(worker.reduction.endMoney).toBe(addDecimalStrings(local.endMoney!, local.endMoney!));
    expect(worker.reduction.endMoney).toBe("2e+400");
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity The JS bundle lists the worker entry, and a packed build emits it.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #60a7be1 Re-read the section, then ran this function: the bundle script names entry.ts and the packed file contains the marker.
 * @evidence ./entry.ts#workerEntryMarker Reads the packed entry marker.
 * @evidenceReview ./entry.ts#workerEntryMarker #f670bfc The declaration is idlekit-worker-entry.
 */
export function packsWorkerAsset(): Promise<void> {
  return (async () => {
    const bundle = readFileSync(new URL("../../../scripts/cli-bundle.ts", import.meta.url), "utf8");
    expect(bundle.includes("src/runtime/workers/entry.ts")).toBe(true);
    const outdir = join(tmpdir(), `idlekit-dx05-pack-${process.pid}`);
    mkdirSync(outdir, { recursive: true });
    const result = await Bun.build({
      // fileURLToPath, not URL.pathname, which is /D:/... on Windows.
      entrypoints: [fileURLToPath(new URL("./entry.ts", import.meta.url))],
      outdir,
      target: "bun",
      format: "esm",
      plugins: [ttsc()],
    });
    expect(result.success).toBe(true);
    const packed = result.outputs.map((output) => output.path).find((path) => path.endsWith(".js"));
    expect(packed).toBeDefined();
    const text = readFileSync(packed!, "utf8");
    expect(text.includes("idlekit-worker-entry")).toBe(true);
  })();
}

describe("worker execution backend", () => {
  it("matches worker digests", matchesWorkerDigests, 400_000);
  it("reverses completion order", reversesCompletionOrder);
  it("bounds pool failures", boundsPoolFailures);
  it("refuses untrusted plugins", refusesUntrustedPlugins);
  it("round-trips break infinity", roundTripsBreakInfinity);
  it("packs the worker asset", packsWorkerAsset);
});
