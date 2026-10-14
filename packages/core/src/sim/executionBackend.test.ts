import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import {
  addDecimalStrings,
  analysisTaskSeed,
  assertExecutionBudget,
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
  serializedTaskBytes,
  taskIdentity,
  taskRefusals,
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
 * @evidenceReview ./executionBackend.ts#runLocalBatch #b9ef4bd Re-read runLocalBatch after the per-task window and the validate-first cost: two tasks run locally with no spawn cost, record UTF-8 serialized bytes, and form a full distribution.
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
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-serializable-task #a0e348b Re-read the section, then ran this function: reversing the input kept the same seed, a function payload failed, a cyclic payload, a bigint step budget, a step budget above the execution budget, and a throwing taskId getter each failed alone while the sibling ran, a named array property was refused, a runner could not change its frozen task's seed,
 * @evidence ./executionBackend.ts#taskIdentity Reads a refused task's identity from own data fields only.
 * @evidenceReview ./executionBackend.ts#taskIdentity #390c155 Re-read the own-data identity fallback: accessors and reflection traps are not re-invoked, invalid indices and seeds become finite sentinels, and valid sibling identities stay unchanged.
 * @evidence ./executionBackend.ts#serializedTaskBytes Measures one task as UTF-8 bytes of its JSON.
 * @evidenceReview ./executionBackend.ts#serializedTaskBytes #06012ad A Hangul task id counts more bytes than UTF-16 units, and the batch cost equals the measured bytes.
 * @evidence ./executionBackend.ts#taskRefusals Checks every task before the batch measures or runs any.
 * @evidenceReview ./executionBackend.ts#taskRefusals #3110912 Re-read both catch boundaries: empty, null, missing, or throwing error messages become invalid-task, reflection errors remain per-task refusals, the budget ceiling stays enforced, and valid siblings return null and run.
 * @evidence ./executionBackend.ts#executionSerializableTask Reads the descriptor marker.
 * @evidenceReview ./executionBackend.ts#executionSerializableTask #c7343dd The declaration is json-descriptor.
 * @evidence ./executionBackend.ts#analysisTaskSeed Derives the seed from the logical index.
 * @evidenceReview ./executionBackend.ts#analysisTaskSeed #2b85c09 The seed is logicalDrawSeed of the base seed and index, so input order does not move it.
 * @evidence ./executionBackend.ts#assertSerializableTask Refuses a task that is not plain JSON.
 * @evidenceReview ./executionBackend.ts#assertSerializableTask #113838d Re-read descriptor and array validation: uint32 seeds and canonical array indices are required, inherited array serialization and extra named indices are refused, cycles and non-JSON values fail, and plain tasks with shared acyclic references pass.
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
  // A cyclic payload fails its own task before any cost is measured. Its sibling still runs.
  const cyclic: Record<string, unknown> = { incomePerSec: "1" };
  cyclic.self = cyclic;
  const mixed = runLocalBatch([task(0, { payload: cyclic }), task(1)], (item) => echo(item, "1"));
  expect(mixed.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
    ["failed", "cycle"],
    ["ok", "ok"],
  ]);
  expect(mixed.cost.serializedBytes).toBe(serializedTaskBytes(task(1)));
  expect(taskRefusals([task(0, { payload: cyclic }), task(1)])).toEqual(["cycle", null]);
  // An extra own function on the descriptor is refused: JSON drops it, but posting it to a worker throws.
  const decorated = { ...task(0), extra: () => 1 } as unknown as AnalysisTrialTaskV1;
  expect(() => assertSerializableTask(decorated)).toThrow("not serializable");
  // The execution budget's step limit is a ceiling: a task asking for more is refused, not run.
  const greedy = task(0, { stepBudget: 5_000 });
  expect(taskRefusals([greedy, task(1, { stepBudget: 1_000 })], { ...defaultExecutionBudget, stepBudget: 1_000 })).toEqual([
    "step budget exceeds the execution budget",
    null,
  ]);
  const capped = runLocalBatch([greedy], (item) => echo(item, "1"), { budget: { ...defaultExecutionBudget, stepBudget: 1_000 } });
  expect(capped.outcomes[0]).toMatchObject({ status: "failed", reason: "step budget exceeds the execution budget" });
  // Plugin containers keep their shapes: a string is not a path list and an array is not a digest record.
  expect(() => assertSerializableTask(task(0, { pluginPaths: "/tmp/plugin.ts" as unknown as string[] }))).toThrow("plugin paths");
  expect(() => assertSerializableTask(task(0, { pluginRoots: [1] as unknown as string[] }))).toThrow("plugin roots");
  expect(() => assertSerializableTask(task(0, { pluginDigests: ["x"] as unknown as Record<string, string> }))).toThrow("plugin digests");
  expect(() => assertSerializableTask(task(0, { pluginDigests: { a: 1 } as unknown as Record<string, string> }))).toThrow("plugin digests");
  // A hidden toJSON or a getter would change what is serialized after the check, so both are refused.
  const hidden = { incomePerSec: "1" };
  Object.defineProperty(hidden, "toJSON", { value: () => ({ swapped: true }), enumerable: false });
  expect(() => assertSerializableTask(task(0, { payload: hidden }))).toThrow("not serializable");
  const getter = {};
  Object.defineProperty(getter, "amount", { get: () => "1", enumerable: true });
  expect(() => assertSerializableTask(task(0, { payload: getter }))).toThrow("not serializable");
  // A named property on an array, such as an own toJSON, is refused too.
  const namedArray = Object.assign([1, 2], { toJSON: () => "swapped" });
  expect(() => assertSerializableTask(task(0, { payload: { list: namedArray } }))).toThrow("not serializable");
  // A refused task whose identity is a throwing getter is reported without invoking it, and its sibling runs.
  const trap = { ...task(1) } as Record<string, unknown>;
  Object.defineProperty(trap, "taskId", {
    get: () => {
      throw new Error("getter");
    },
    enumerable: true,
  });
  const trapped = runLocalBatch([task(0), trap as unknown as AnalysisTrialTaskV1], (item) => echo(item, "1"));
  expect(trapped.outcomes.map((outcome) => [outcome.taskId, outcome.status])).toEqual([
    ["trial-0", "ok"],
    ["", "failed"],
  ]);
  expect(taskIdentity(trap as unknown as AnalysisTrialTaskV1)).toEqual({ taskId: "", logicalIndex: 1, seed: analysisTaskSeed(19, 1) });
  // A runner cannot change the task it was given: the batch runs a frozen snapshot, so a retry keeps the id and seed.
  const seedsSeen: number[] = [];
  const pinned = runLocalBatch([task(0)], (item) => {
    seedsSeen.push(item.seed);
    try {
      (item as { seed: number }).seed = 999;
    } catch {
      // The snapshot is frozen.
    }
    return { ...echo(item, "1"), status: "failed", reason: "trial-failed" };
  }, { budget: { ...defaultExecutionBudget, maxRetries: 1 } });
  expect(seedsSeen).toEqual([analysisTaskSeed(19, 0), analysisTaskSeed(19, 0)]);
  expect(pinned.outcomes[0]!.seed).toBe(analysisTaskSeed(19, 0));
  // A shared, acyclic reference is not a cycle. JSON and structured clone both carry it.
  const shared = { amount: "1" };
  expect(() => assertSerializableTask(task(0, { payload: { a: shared, b: shared, list: [shared, shared] } }))).not.toThrow();
  // A step budget that JSON cannot carry fails its own task before any cost is measured.
  const bigBudget = task(0, { stepBudget: 1n as unknown as number });
  const budgeted = runLocalBatch([bigBudget, task(1)], (item) => echo(item, "1"));
  expect(budgeted.outcomes.map((outcome) => [outcome.status, outcome.reason])).toEqual([
    ["failed", "step budget"],
    ["ok", "ok"],
  ]);
  // Bytes are UTF-8 bytes of the JSON, not UTF-16 code units.
  const wide = task(0, { taskId: "트라이얼-0" });
  expect(serializedTaskBytes(wide)).toBe(new TextEncoder().encode(JSON.stringify(wide)).byteLength);
  expect(serializedTaskBytes(wide)).toBeGreaterThan(JSON.stringify(wide).length);
  expect(runLocalBatch([wide], (item) => echo(item, "1")).cost.serializedBytes).toBe(serializedTaskBytes(wide));
}

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction The total follows logical index, including a reversed completion list.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction #855174a Re-read the section, then ran this function: 0.1 then 0.2 summed to 0.3 in logical order, and 1e+400 with 1.5e+400 summed to 2.5e+400 in a full batch.
 * @evidence ./executionBackend.ts#executionStableReduction Reads the reduction marker.
 * @evidenceReview ./executionBackend.ts#executionStableReduction #d1a7722 The declaration is logical-index.
 * @evidence ./executionBackend.ts#addDecimalStrings Adds plain decimal strings without Number().
 * @evidenceReview ./executionBackend.ts#addDecimalStrings #d0516cb Re-read the exact scientific sum with bigint exponents: 1e1000000000000000000000 plus 2.5e+1000000000000000000000 is 3.5e+1000000000000000000000, 0.1 plus 0.2 is 0.3, a negative sum keeps its sign, 1e3 plus 1 is 1.001e+3, 1e+400 plus 1 keeps every digit, and Infinity and a 200000-digit span throw.
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
  // Break-infinity end money is a scientific serde string. It is summed exactly, not dropped.
  expect(addDecimalStrings(exponent, one)).toBe("1.001e+3");
  // Operands are bound first: a call whose first argument is a string literal reads as a test registration.
  const [big, bigAndHalf, zero, milli, negativeMilli, infinite, tooFar] = [
    "1e+400",
    "1.5e+400",
    "0",
    "2.5e-3",
    "-2.5e-3",
    "Infinity",
    "1e+200000",
  ] as const;
  expect(addDecimalStrings(big, big)).toBe("2e+400");
  expect(addDecimalStrings(zero, bigAndHalf)).toBe("1.5e+400");
  expect(addDecimalStrings(milli, negativeMilli)).toBe("0");
  expect(addDecimalStrings(big, one)).toBe(`1.${"0".repeat(399)}1e+400`);
  expect(() => addDecimalStrings(infinite, one)).toThrow("decimal required");
  expect(() => addDecimalStrings(tooFar, one)).toThrow("exponent span");
  // An exponent past Number's safe range is still exact: only the gap between the two exponents is expanded.
  const [vast, vaster] = ["1e1000000000000000000000", "2.5e+1000000000000000000000"] as const;
  expect(addDecimalStrings(vast, vaster)).toBe("3.5e+1000000000000000000000");
  expect(addDecimalStrings(zero, vast)).toBe("1e+1000000000000000000000");
  const huge = finalizeBatch([echo(task(1), "1e+400"), echo(task(0), "1.5e+400")], {
    batchId: "huge",
    backend: "local",
    selection: "local-default",
    workerSpawnMs: 0,
    serializedBytes: 0,
  });
  expect(huge.fullDistribution).toBe(true);
  expect(huge.reduction.endMoney).toBe("2.5e+400");
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
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-failure-boundary #2262fcb Re-read the section, then ran this function: the retry kept the same seed, the aborted batch was not full, three tasks each inside their own window all finished, a thrown trial retried and failed alone, a failed attempt past the window was a timeout with no retry, a pre-aborted batch over the queue bound was cancelled, and an infinite, NaN, or negative budget field threw before any task ran.
 * @evidence ./executionBackend.ts#assertExecutionBudget Refuses a budget field that is not a finite non-negative integer.
 * @evidenceReview ./executionBackend.ts#assertExecutionBudget #4672303 Infinite maxRetries, NaN stepBudget, a negative queueBound, and a 3000000000 ms timeout throw, and the default budget passes.
 * @evidence ./executionBackend.ts#runLocalBatch Bounds each task by its own window and turns a thrown runner into a failed outcome.
 * @evidenceReview ./executionBackend.ts#runLocalBatch #b9ef4bd Re-read admission ahead of measuring, the pre-abort check ahead of the queue bound, and the loop: an oversized batch reports no bytes, the runner sees a frozen budget and a frozen task snapshot, no batch deadline remains, the window applies to every attempt before its status, a 2 ms task under a 5 ms budget is ok in third place, a throw is trial-failed with attempts counted, and a slow failure stops at one attempt.
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
  // Each task gets its own window. Three tasks of 2 ms under a 5 ms budget all finish, though together they take longer.
  let tick = 0;
  const windows = runLocalBatch([task(0), task(1), task(2)], (item) => echo(item, "1"), {
    budget: { ...defaultExecutionBudget, taskTimeoutMs: 5 },
    clock: {
      now: () => {
        tick += 2;
        return tick;
      },
    },
  });
  expect(windows.outcomes.map((outcome) => outcome.status)).toEqual(["ok", "ok", "ok"]);
  expect(windows.fullDistribution).toBe(true);

  // A thrown trial is a failed outcome of that task. It retries within maxRetries and the batch keeps going.
  let throws = 0;
  const thrown = runLocalBatch(
    [task(0), task(1)],
    (item) => {
      if (item.logicalIndex === 0) {
        throws += 1;
        throw new Error("trial blew up");
      }
      return echo(item, "1");
    },
    { budget: { ...defaultExecutionBudget, maxRetries: 1 } },
  );
  expect(throws).toBe(2);
  // A failed attempt that ran past the window is a timeout. It is not retried, as a worker attempt would be cut there.
  let slowCalls = 0;
  let slowNow = 0;
  const slowFailure = runLocalBatch(
    [task(0)],
    (item) => {
      slowCalls += 1;
      return { ...echo(item, "1"), status: "failed", reason: "trial-failed", endMoney: null };
    },
    {
      budget: { ...defaultExecutionBudget, taskTimeoutMs: 5, maxRetries: 2 },
      clock: {
        now: () => {
          slowNow += 10;
          return slowNow;
        },
      },
    },
  );
  expect(slowCalls).toBe(1);
  expect(slowFailure.outcomes[0]).toMatchObject({ status: "incomplete", reason: "timeout", attempts: 1 });
  expect(thrown.outcomes.map((outcome) => [outcome.status, outcome.reason, outcome.attempts])).toEqual([
    ["failed", "trial-failed", 2],
    ["ok", "ok", 1],
  ]);
  expect(thrown.fullDistribution).toBe(false);

  // A budget that could make a loop endless or skip a ceiling is refused before anything runs.
  for (const bad of [
    { maxRetries: Number.POSITIVE_INFINITY },
    { stepBudget: Number.NaN },
    { queueBound: -1 },
    // A worker timer past 2^31 - 1 ms fires after 1 ms, so such a window is refused in both backends.
    { taskTimeoutMs: 3_000_000_000 },
  ]) {
    let ran = 0;
    expect(() =>
      runLocalBatch([task(0)], (item) => {
        ran += 1;
        return { ...echo(item, "1"), status: "failed", reason: "trial-failed" };
      }, { budget: { ...defaultExecutionBudget, ...bad } }),
    ).toThrow("execution budget");
    expect(ran).toBe(0);
  }
  expect(() => assertExecutionBudget(defaultExecutionBudget)).not.toThrow();
  // The runner sees a frozen budget, so raising maxRetries mid-batch cannot extend the loop.
  let mutations = 0;
  const frozenLocal = runLocalBatch([task(0)], (item, ctx) => {
    mutations += 1;
    try {
      (ctx.budget as { maxRetries: number }).maxRetries = Number.POSITIVE_INFINITY;
    } catch {
      // A frozen object refuses the write in strict mode.
    }
    return { ...echo(item, "1"), status: "failed", reason: "trial-failed" };
  }, { budget: { ...defaultExecutionBudget, maxRetries: 1 } });
  expect(mutations).toBe(2);
  expect(frozenLocal.outcomes[0]).toMatchObject({ status: "failed", attempts: 2 });
  const abortedQueue = new AbortController();
  abortedQueue.abort();
  const abortedOverBound = runLocalBatch([task(0), task(1)], (item) => echo(item, "1"), {
    budget: { ...defaultExecutionBudget, queueBound: 1 },
    signal: abortedQueue.signal,
  });
  expect(abortedOverBound.outcomes.map((outcome) => outcome.status)).toEqual(["cancelled", "cancelled"]);
  // An oversized batch is answered before any descriptor is measured, so it reports no bytes.
  const overBoundBytes = runLocalBatch([task(0), task(1)], (item) => echo(item, "1"), {
    budget: { ...defaultExecutionBudget, queueBound: 1 },
  });
  expect(overBoundBytes.cost.serializedBytes).toBe(0);
  const queued = runLocalBatch([task(0), task(1)], () => {
    throw new Error("queue bound must not run");
  }, { budget: { ...defaultExecutionBudget, queueBound: 1 } });
  expect(queued.outcomes.every((outcome) => outcome.reason === "queue-bound")).toBe(true);
  expect(queued.fullDistribution).toBe(false);
}

describe("execution backend", () => {
  it("isolates malformed thrown errors and reflection traps", () => {
    for (const kind of ["null", "undefined", "getter", "reflection"]) {
      let refused = task(0);
      if (kind === "reflection") {
        refused = new Proxy(refused, { getOwnPropertyDescriptor() { throw new Error("reflection"); } });
      } else {
        const error = new Error("bad");
        Object.defineProperty(error, "message", kind === "getter"
          ? { get() { throw new Error("message getter"); } }
          : { value: kind === "null" ? null : undefined });
        Object.defineProperty(refused, "schemaVersion", { enumerable: true, get() { throw error; } });
      }
      const ran: string[] = [];
      const batch = runLocalBatch([refused, task(1)], (item) => { ran.push(item.taskId); return echo(item, "1"); });
      expect(batch.outcomes.map((item) => item.status).sort()).toEqual(["failed", "ok"]);
      expect(ran).toEqual(["trial-1"]);
      const failure = batch.outcomes.find((item) => item.status === "failed")!;
      expect(failure.reason).toBe(kind === "reflection" ? "reflection" : "invalid-task");
      expect(Number.isFinite(failure.logicalIndex)).toBe(true);
      expect(Number.isFinite(failure.seed)).toBe(true);
    }
  });
  it("admits only uint32 seeds and reports finite refused identities", () => {
    for (const seed of [-1, 1.5, 4294967296, NaN, Infinity]) {
      expect(taskRefusals([task(0, { seed })])[0]).not.toBeNull();
      expect(taskIdentity(task(0, { logicalIndex: NaN, seed })).logicalIndex).toBe(-1);
      expect(taskIdentity(task(0, { seed })).seed).toBe(0);
    }
    for (const seed of [0, 4294967295]) expect(taskRefusals([task(0, { seed })])).toEqual([null]);
    const batch = runLocalBatch([task(0, { logicalIndex: NaN, seed: Infinity }), task(1)], (item) => echo(item, "1"));
    expect(batch.outcomes[0]!.logicalIndex).toBe(-1);
    expect(batch.outcomes[0]!.seed).toBe(0);
    expect(batch.outcomes[1]!.status).toBe("ok");
    expect(JSON.stringify(batch)).not.toContain('"logicalIndex":null');
    expect(JSON.stringify(batch)).not.toContain('"seed":null');
  });
  it("keeps an empty thrown message a task refusal", () => {
    const refused = task(0);
    Object.defineProperty(refused, "schemaVersion", { enumerable: true, get() { throw new Error(""); } });
    const ran: string[] = [];
    const batch = runLocalBatch([refused, task(1)], (item) => { ran.push(item.taskId); return echo(item, "1"); });
    expect(ran).toEqual(["trial-1"]);
    expect(batch.outcomes[0]!.reason).toBe("invalid-task");
    expect(batch.fullDistribution).toBe(false);
  });
  it("refuses non-index array properties and inherited serialization", () => {
    for (const key of ["4294967295", "9007199254740991"]) {
      const list: unknown[] = [];
      Object.defineProperty(list, key, { enumerable: true, value: () => 1 });
      expect(taskRefusals([task(0, { payload: { list } })])[0]).not.toBeNull();
    }
    let serialized = false;
    class HiddenJson extends Array<unknown> { toJSON() { serialized = true; return { swapped: true }; } }
    const batch = runLocalBatch([task(0, { payload: { list: new HiddenJson() } }), task(1)], (item) => echo(item, "1"));
    expect(serialized).toBe(false);
    expect(batch.outcomes.map((item) => item.status)).toEqual(["failed", "ok"]);
  });
  it("keeps the local backend as the default", keepsLocalDefault);
  it("keeps tasks serializable", keepsSerializableTasks);
  it("reduces in logical order", reducesInLogicalOrder);
  it("bounds failures", boundsFailures);
});
