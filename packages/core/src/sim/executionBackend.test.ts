import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import {
  addDecimalStrings,
  analysisTaskSeed,
  assertSerializableTask,
  createLocalExecutionBackend,
  defaultExecutionBudget,
  executionFailureBoundary,
  executionLocalDefault,
  executionSerializableTask,
  executionStableReduction,
  finalizeBatch,
  runLocalBatch,
  semanticDigest,
  type AnalysisTrialOutcomeV1,
  type AnalysisTrialTaskV1,
} from "./executionBackend";

function task(logicalIndex: number, extra?: Partial<AnalysisTrialTaskV1>): AnalysisTrialTaskV1 {
  const seed = analysisTaskSeed(19, logicalIndex);
  return {
    schemaVersion: 1,
    contract: "idlekit.execution-task.v1",
    taskId: `trial-${logicalIndex}`,
    logicalIndex,
    seed,
    stepBudget: defaultExecutionBudget.stepBudget,
    kind: "analysis-trial",
    payload: { incomePerSec: "1" },
    pluginPaths: [],
    pluginRoots: [],
    pluginDigests: {},
    ...extra,
  };
}

function echo(value: AnalysisTrialTaskV1, endMoney: string): AnalysisTrialOutcomeV1 {
  return {
    taskId: value.taskId,
    logicalIndex: value.logicalIndex,
    seed: value.seed,
    status: "ok",
    reason: "ok",
    attempts: 1,
    semanticDigest: `${value.logicalIndex}:${value.seed}`,
    endMoney,
  };
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-local-default The default batch does not start a worker.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-local-default #db57164 Re-read the section, then ran this function: maxWorkers stayed 0 and the source has no worker constructor.
 * @evidence ./executionBackend.ts#executionLocalDefault Reads the local marker.
 * @evidenceReview ./executionBackend.ts#executionLocalDefault #ed034ff The declaration is local-default.
 * @evidence ./executionBackend.ts#defaultExecutionBudget Reads the budget.
 * @evidenceReview ./executionBackend.ts#defaultExecutionBudget #4df9ea6 maxWorkers is 0.
 * @evidence ./executionBackend.ts#runLocalBatch Runs the batch in this process.
 * @evidenceReview ./executionBackend.ts#runLocalBatch #541c0be Two tasks run locally with no spawn cost, record serialized bytes, and form a full distribution.
 */
export function keepsLocalDefault(): void {
  expect(executionLocalDefault).toBe("local-default");
  expect(defaultExecutionBudget.maxWorkers).toBe(0);
  const source = readFileSync(new URL("./executionBackend.ts", import.meta.url), "utf8");
  expect(source.includes("Bun.Worker")).toBe(false);
  expect(source.includes("worker_threads")).toBe(false);
  expect(source.includes("fetch(")).toBe(false);
  expect(source.includes("automatic-worker")).toBe(false);
  const batch = runLocalBatch([task(0), task(1)], (item) => echo(item, "1"));
  expect(batch.backend).toBe("local");
  expect(batch.selection).toBe("local-default");
  expect(batch.cost.workerSpawnMs).toBe(0);
  expect(batch.cost.serializedBytes).toBeGreaterThan(0);
  expect(batch.fullDistribution).toBe(true);
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-serializable-task A function payload is refused. The seed follows the logical index.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-serializable-task #c885dec Re-read the section, then ran this function: reversing the input kept the same seed and a function payload failed.
 * @evidence ./executionBackend.ts#executionSerializableTask Reads the descriptor marker.
 * @evidenceReview ./executionBackend.ts#executionSerializableTask #c7343dd The declaration is json-descriptor.
 * @evidence ./executionBackend.ts#analysisTaskSeed Derives the seed from the logical index.
 * @evidenceReview ./executionBackend.ts#analysisTaskSeed #2b85c09 The seed is logicalDrawSeed of the base seed and index, so input order does not move it.
 * @evidence ./executionBackend.ts#assertSerializableTask Refuses a task that is not plain JSON.
 * @evidenceReview ./executionBackend.ts#assertSerializableTask #d34c038 A function payload, a class instance, a non-finite number, and a negative index throw; a plain task passes.
 */
export function keepsSerializableTasks(): void {
  expect(executionSerializableTask).toBe("json-descriptor");
  const forward = [task(0), task(1), task(2)];
  const reversed = [...forward].reverse();
  const ran: number[] = [];
  const batch = runLocalBatch(reversed, (item) => {
    ran.push(item.logicalIndex);
    return echo(item, "1");
  });
  expect(ran).toEqual([0, 1, 2]);
  expect(batch.outcomes.map((outcome) => outcome.seed)).toEqual(forward.map((item) => item.seed));
  expect(batch.outcomes[2]!.seed).toBe(analysisTaskSeed(19, 2));
  const bad = runLocalBatch([task(0, { payload: { run: () => 1 } })], (item) => echo(item, "1"));
  expect(bad.outcomes[0]!.status).toBe("failed");
  expect(bad.fullDistribution).toBe(false);
  class NativeDecimal {
    constructor(readonly amount: string) {}
  }
  const decimal = runLocalBatch(
    [task(0, { payload: { amount: new NativeDecimal("1") } })],
    (item) => echo(item, "1"),
  );
  expect(decimal.outcomes[0]!.status).toBe("failed");
  expect(() => assertSerializableTask(task(0))).not.toThrow();
  expect(() => assertSerializableTask(task(0, { payload: { run: () => 1 } }))).toThrow("not serializable");
  expect(() => assertSerializableTask(task(0, { payload: { value: Number.NaN } }))).toThrow("non-finite number");
  expect(() => assertSerializableTask(task(0, { logicalIndex: -1 }))).toThrow("logical index");
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction The total follows logical index, including a reversed completion list.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction #dad1b6e Re-read the section, then ran this function: 0.1 then 0.2 summed to 0.3 in logical order.
 * @evidence ./executionBackend.ts#executionStableReduction Reads the reduction marker.
 * @evidenceReview ./executionBackend.ts#executionStableReduction #d1a7722 The declaration is logical-index.
 * @evidence ./executionBackend.ts#addDecimalStrings Adds plain decimal strings without Number().
 * @evidenceReview ./executionBackend.ts#addDecimalStrings #48222ac 0.1 plus 0.2 is 0.3, a negative sum keeps its sign, and an exponent string throws.
 * @evidence ./executionBackend.ts#finalizeBatch Sorts outcomes by logical index and sums only a full batch.
 * @evidenceReview ./executionBackend.ts#finalizeBatch #4c64d96 A reversed outcome list is sorted, the total is 0.3, and a batch with a failed outcome has no total.
 * @evidence ./executionBackend.ts#semanticDigest Hashes canonical JSON.
 * @evidenceReview ./executionBackend.ts#semanticDigest #55ad050 Key order does not change the digest and a different value does.
 */
export function reducesInLogicalOrder(): void {
  expect(executionStableReduction).toBe("logical-index");
  const [tenth, fifth, negative, quarter, exponent, one] = ["0.1", "0.2", "-1.5", "0.25", "1e3", "1"] as const;
  expect(addDecimalStrings(tenth, fifth)).toBe("0.3");
  expect(addDecimalStrings(negative, quarter)).toBe("-1.25");
  expect(() => addDecimalStrings(exponent, one)).toThrow("plain decimal required");
  const header = { batchId: "direct", backend: "local" as const, selection: "local-default" as const, workerSpawnMs: 0, serializedBytes: 0 };
  const finalized = finalizeBatch([echo(task(1), "0.2"), echo(task(0), "0.1")], header);
  expect(finalized.outcomes.map((outcome) => outcome.logicalIndex)).toEqual([0, 1]);
  expect(finalized.reduction.endMoney).toBe("0.3");
  const partial = finalizeBatch([echo(task(0), "0.1"), { ...echo(task(1), "0.2"), status: "failed" }], header);
  expect(partial.fullDistribution).toBe(false);
  expect(partial.reduction.endMoney).toBeNull();
  expect(semanticDigest({ b: 1, a: 2 })).toBe(semanticDigest({ a: 2, b: 1 }));
  expect(semanticDigest({ a: 1 })).not.toBe(semanticDigest({ a: 2 }));
  const batch = runLocalBatch([task(1), task(0)], (item) => echo(item, item.logicalIndex === 0 ? "0.1" : "0.2"));
  expect(batch.outcomes.map((outcome) => outcome.logicalIndex)).toEqual([0, 1]);
  expect(batch.reduction.order).toBe("logical-index");
  expect(batch.reduction.endMoney).toBe("0.3");
  const empty = runLocalBatch([], () => {
    throw new Error("empty batch must not run");
  });
  expect(empty.outcomes).toEqual([]);
  expect(empty.fullDistribution).toBe(false);
  expect(empty.reduction.endMoney).toBeNull();
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-failure-boundary Abort, timeout, retry, and the queue bound stay distinct from a full distribution.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-failure-boundary #7435a5c Re-read the section, then ran this function: the retry kept the same seed, and the aborted batch was not full.
 * @evidence ./executionBackend.ts#executionFailureBoundary Reads the boundary marker.
 * @evidenceReview ./executionBackend.ts#executionFailureBoundary #5e9d9f9 The declaration is not-a-partial-distribution.
 * @evidence ./executionBackend.ts#createLocalExecutionBackend Submits a batch that cancel or an aborted signal stops.
 * @evidenceReview ./executionBackend.ts#createLocalExecutionBackend #495ab3a Cancel during the first task cancels the second, and a signal aborted before submit runs nothing.
 */
export function boundsFailures(): void {
  expect(executionFailureBoundary).toBe("not-a-partial-distribution");
  const holder: { backend?: ReturnType<typeof createLocalExecutionBackend> } = {};
  holder.backend = createLocalExecutionBackend(
    (item) => {
      if (item.logicalIndex === 0) {
        holder.backend?.cancel("bounds");
        return echo(item, "1");
      }
      return echo(item, "1");
    },
    { ...defaultExecutionBudget, maxRetries: 1 },
  );
  const aborted = holder.backend.submit([task(0), task(1)], { batchId: "bounds" });
  expect(aborted.outcomes[0]!.status).toBe("ok");
  expect(aborted.outcomes[1]!.status).toBe("cancelled");
  expect(aborted.outcomes[1]!.reason).toBe("abort");
  expect(aborted.fullDistribution).toBe(false);
  const already = new AbortController();
  already.abort();
  let ranAfterAbort = 0;
  const preAborted = createLocalExecutionBackend((item) => {
    ranAfterAbort += 1;
    return echo(item, "1");
  }).submit([task(0)], { signal: already.signal });
  expect(ranAfterAbort).toBe(0);
  expect(preAborted.outcomes[0]!.status).toBe("cancelled");

  let calls = 0;
  const retried = runLocalBatch(
    [task(0)],
    (item) => {
      calls += 1;
      if (calls === 1) {
        return {
          taskId: item.taskId,
          logicalIndex: item.logicalIndex,
          seed: item.seed,
          status: "failed",
          reason: "worker-crash",
          attempts: 1,
          semanticDigest: null,
          endMoney: null,
        };
      }
      return echo(item, "4");
    },
    { budget: { ...defaultExecutionBudget, maxRetries: 1 } },
  );
  expect(calls).toBe(2);
  expect(retried.outcomes[0]!.attempts).toBe(2);
  expect(retried.outcomes[0]!.seed).toBe(analysisTaskSeed(19, 0));
  expect(retried.outcomes[0]!.status).toBe("ok");

  const trust = runLocalBatch(
    [task(0)],
    (item) => ({
      taskId: item.taskId,
      logicalIndex: item.logicalIndex,
      seed: item.seed,
      status: "failed",
      reason: "plugin-trust",
      attempts: 1,
      semanticDigest: null,
      endMoney: null,
    }),
    { budget: { ...defaultExecutionBudget, maxRetries: 2 } },
  );
  expect(trust.outcomes[0]!.attempts).toBe(1);
  expect(trust.fullDistribution).toBe(false);

  let now = 0;
  const timed = runLocalBatch([task(0), task(1)], (item) => echo(item, "1"), {
    budget: { ...defaultExecutionBudget, taskTimeoutMs: 5 },
    clock: {
      now: () => {
        now += 10;
        return now;
      },
    },
  });
  expect(timed.outcomes[0]!.status).toBe("incomplete");
  expect(timed.outcomes[0]!.reason).toBe("timeout");
  expect(timed.outcomes[1]!.status).toBe("incomplete");
  expect(timed.fullDistribution).toBe(false);

  const queued = runLocalBatch([task(0), task(1)], () => {
    throw new Error("queue bound must not run");
  }, { budget: { ...defaultExecutionBudget, queueBound: 1 } });
  expect(queued.outcomes.every((outcome) => outcome.reason === "queue-bound")).toBe(true);
  expect(queued.fullDistribution).toBe(false);
}

describe("execution backend", () => {
  it("keeps the local backend as the default", keepsLocalDefault);
  it("keeps tasks serializable", keepsSerializableTasks);
  it("reduces in logical order", reducesInLogicalOrder);
  it("bounds failures", boundsFailures);
});
