import { describe, expect, it } from "bun:test";
import ttsc from "@ttsc/unplugin/bun";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  analysisTaskSeed,
  defaultExecutionBudget,
  finalizeBatch,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
} from "@idlekit/core";
import { sha256Hex } from "../../runtime/bun";
import { runWorkerPool, workerEntryUrl, workerPoolParity, type WorkerLike } from "./pool";
import { analysisTrialScenario, runAnalysisTrial, trialPluginBoundary } from "./trial";

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
  constructor(
    private readonly mode: "reverse" | "crash" | "hang",
    private readonly order: number[],
  ) {}
  postMessage(message: unknown): void {
    const task = (message as { task: AnalysisTrialTaskV1 }).task;
    if (this.mode === "crash") {
      queueMicrotask(() => this.onerror?.(new Error("crash")));
      return;
    }
    if (this.mode === "hang") return;
    const delay = this.mode === "reverse" ? (4 - task.logicalIndex) * 5 : 1;
    setTimeout(() => {
      if (this.terminated) return;
      this.order.push(task.logicalIndex);
      this.onmessage?.({ data: { type: "outcome", outcome: echo(task) } });
    }, delay);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity Local, one worker, two workers, and four workers share the trial digest.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: the four pool sizes returned the same semantic digest and end money.
 * @evidence ./pool.ts#workerPoolParity Reads the parity marker.
 * @evidenceReview ./pool.ts#workerPoolParity #f3f1470 The declaration is same-logical-digest.
 * @evidence ./entry.ts#workerEntryMarker Reads the packed entry marker.
 * @evidenceReview ./entry.ts#workerEntryMarker #f670bfc The declaration is idlekit-worker-entry.
 * @evidence ./pool.ts#runWorkerPool Runs the tasks on an explicit number of workers.
 * @evidenceReview ./pool.ts#runWorkerPool #4fbb7b5 One, two, and four real workers return the local digests, end money, and seeds in logical order.
 * @evidence ./pool.ts#workerEntryUrl Names the worker module the pool spawns.
 * @evidenceReview ./pool.ts#workerEntryUrl #62d3255 The URL is entry.ts next to the pool module.
 * @evidence ./trial.ts#runAnalysisTrial Runs one trial and returns its digest and end money.
 * @evidenceReview ./trial.ts#runAnalysisTrial #c84e48a Each of the four local trials runs on the built-in registries without a loader and is ok with a digest, and the worker run matches it.
 * @evidence ./trial.ts#analysisTrialScenario Builds the trial scenario from the payload.
 * @evidenceReview ./trial.ts#analysisTrialScenario #1eb1d48 The payload step, horizon, and income reach the scenario clock and model params.
 */
export function matchesWorkerDigests(): Promise<void> {
  return (async () => {
    expect(workerPoolParity).toBe("same-logical-digest");
    // The entry imports the plugin loader, which this test does not load. Read its marker from the source.
    const entrySource = readFileSync(new URL("./entry.ts", import.meta.url), "utf8");
    expect(entrySource.includes('export const workerEntryMarker = "idlekit-worker-entry" as const;')).toBe(true);
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
      const batch = await runWorkerPool({ tasks, workers });
      expect(batch.selection).toBe("explicit-worker");
      expect(batch.fullDistribution).toBe(true);
      expect(batch.outcomes.map((outcome) => outcome.semanticDigest)).toEqual(
        local.outcomes.map((outcome) => outcome.semanticDigest),
      );
      expect(batch.outcomes.map((outcome) => outcome.endMoney)).toEqual(local.outcomes.map((outcome) => outcome.endMoney));
      expect(batch.outcomes.map((outcome) => outcome.seed)).toEqual(tasks.map((task) => task.seed));
    }
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A reversed completion order still reports logical index order.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: the later index finished first and the batch stayed sorted.
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
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: the crashed and timed-out batches were not full, and every slot terminated.
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
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A plugin outside the parent roots is a trust failure.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: an empty root list and a mismatched digest both failed closed.
 * @evidence ./trial.ts#trialPluginBoundary Reads the trust marker.
 * @evidenceReview ./trial.ts#trialPluginBoundary #9e0eb13 The declaration is plugin-policy-not-widened.
 * @evidence ./trial.ts#runAnalysisTrial Refuses plugin paths it cannot check.
 * @evidenceReview ./trial.ts#runAnalysisTrial #c84e48a An empty root list and plugin paths without a loader fail closed, and in a worker the CLI loader refuses an outside path and a wrong digest.
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
    });
    expect(checked.outcomes.map((outcome) => outcome.reason)).toEqual(["plugin-trust", "plugin-trust"]);
    expect(JSON.stringify(checked).includes(digest)).toBe(false);
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity A break-infinity amount survives the worker serde.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: local and worker end money matched and were not Infinity.
 * @evidence ./trial.ts#trialPluginBoundary Reads the trust marker.
 * @evidenceReview ./trial.ts#trialPluginBoundary #9e0eb13 The declaration is plugin-policy-not-widened.
 */
export function roundTripsBreakInfinity(): Promise<void> {
  return (async () => {
    const task = trial(0, { engineId: "breakInfinity", initialAmount: "1e400", incomePerSec: "0", durationSec: 1 });
    const local = await runAnalysisTrial(task);
    const worker = await runWorkerPool({ tasks: [task], workers: 1 });
    expect(local.status).toBe("ok");
    expect(worker.outcomes[0]!.status).toBe("ok");
    expect(worker.outcomes[0]!.endMoney).toBe(local.endMoney);
    expect(local.endMoney === "Infinity").toBe(false);
    expect(String(local.endMoney).includes("e")).toBe(true);
  })();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity The JS bundle lists the worker entry, and a packed build emits it.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-worker-parity #f28c027 Re-read the section, then ran this function: the bundle script names entry.ts and the packed file contains the marker.
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
      entrypoints: [new URL("./entry.ts", import.meta.url).pathname],
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
  it("matches worker digests", matchesWorkerDigests);
  it("reverses completion order", reversesCompletionOrder);
  it("bounds pool failures", boundsPoolFailures);
  it("refuses untrusted plugins", refusesUntrustedPlugins);
  it("round-trips break infinity", roundTripsBreakInfinity);
  it("packs the worker asset", packsWorkerAsset);
});
