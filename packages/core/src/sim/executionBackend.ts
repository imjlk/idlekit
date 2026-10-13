import { canonicalJson, sha256Text } from "../scenario/scenarioContract";
import { logicalDrawSeed } from "./random";

/**
 * Local execution backend.
 * This module does not start a worker, open a file, or call the network.
 * A Bun pool is a CLI adapter. The default batch is local.
 */

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-local-default The default backend is local. Worker count is not selected here.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-local-default #db57164 Re-read the section: maxWorkers 0 is the local default and there is no automatic worker selection.
 */
export const executionLocalDefault = "local-default" as const;

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-serializable-task A task is a plain JSON descriptor. The seed is the logical draw seed.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-serializable-task #6102bda Re-read the section: functions, class instances, cyclic payloads, and a bad step budget are refused before cost is measured, a shared reference is allowed, and the seed does not read a worker slot.
 */
export const executionSerializableTask = "json-descriptor" as const;

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction Outcomes are ordered by logical index. The money total is a decimal-string sum.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-stable-reduction #8cb1440 Re-read the section: completion order is not the addition order, Number() is not the sum, and a scientific amount is summed exactly.
 */
export const executionStableReduction = "logical-index" as const;

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-failure-boundary Failure, cancellation, and incomplete stays are distinct. A partial batch is not a full distribution.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-failure-boundary #733c96f Re-read the section: timeout and abort do not become a successful distribution, a retry keeps the same id and seed, the timeout is per task and per attempt, and a thrown runner is a failed task.
 */
export const executionFailureBoundary = "not-a-partial-distribution" as const;

/**
 * @evidence docs/requirements/active/worker-execution-backend.md#req-dx05-local-default The local budget keeps maxWorkers at 0 and records spawn cost on the batch.
 * @evidenceReview docs/requirements/active/worker-execution-backend.md#req-dx05-local-default #db57164 Re-read the section: a small batch does not choose a worker count.
 */
export const defaultExecutionBudget = {
  maxWorkers: 0,
  queueBound: 64,
  taskTimeoutMs: 30_000,
  stepBudget: 100_000,
  maxRetries: 0,
} as const;

export type ExecutionBudgetV1 = Readonly<{
  maxWorkers: number;
  queueBound: number;
  taskTimeoutMs: number;
  stepBudget: number;
  maxRetries: number;
}>;

export type AnalysisTrialTaskV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.execution-task.v1";
  taskId: string;
  logicalIndex: number;
  seed: number;
  stepBudget: number;
  kind: "analysis-trial";
  payload: unknown;
  pluginPaths: readonly string[];
  pluginRoots: readonly string[];
  pluginDigests: Readonly<Record<string, string>>;
}>;

export type AnalysisTrialStatus = "ok" | "failed" | "cancelled" | "incomplete";

export type AnalysisTrialOutcomeV1 = Readonly<{
  taskId: string;
  logicalIndex: number;
  seed: number;
  status: AnalysisTrialStatus;
  reason: string;
  attempts: number;
  semanticDigest: string | null;
  endMoney: string | null;
}>;

export type ExecutionBatchV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.execution-batch.v1";
  batchId: string;
  backend: "local" | "worker";
  selection: "local-default" | "explicit-worker";
  complete: boolean;
  fullDistribution: boolean;
  outcomes: readonly AnalysisTrialOutcomeV1[];
  reduction: Readonly<{
    order: "logical-index";
    endMoney: string | null;
  }>;
  cost: Readonly<{
    workerSpawnMs: number;
    serializedBytes: number;
  }>;
}>;

export type TrialContext = Readonly<{
  signal: AbortSignal;
  attempt: number;
  budget: ExecutionBudgetV1;
}>;

export type TrialRunner = (task: AnalysisTrialTaskV1, ctx: TrialContext) => AnalysisTrialOutcomeV1;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
/*
 * Two amounts whose exponents differ by more than this many digits are not summed exactly.
 * Break-infinity end money such as 1e+400 sits well inside it.
 */
const MAX_EXPONENT_SPAN = 100_000;

function budgetOf(budget: ExecutionBudgetV1 | undefined): ExecutionBudgetV1 {
  return budget ?? defaultExecutionBudget;
}

function assertPlain(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return;
  }
  if (typeof value !== "object") throw new Error("not serializable");
  // `seen` holds only the objects on the current path. A shared, acyclic reference serializes fine.
  if (seen.has(value)) throw new Error("cycle");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertPlain(item, seen);
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error("not a plain object");
    for (const entry of Object.values(value)) assertPlain(entry, seen);
  } finally {
    seen.delete(value);
  }
}

export function assertSerializableTask(task: AnalysisTrialTaskV1): void {
  if (task.schemaVersion !== 1 || task.contract !== "idlekit.execution-task.v1") {
    throw new Error("unsupported task contract");
  }
  if (task.kind !== "analysis-trial") throw new Error("unsupported task kind");
  if (!Number.isInteger(task.logicalIndex) || task.logicalIndex < 0) throw new Error("logical index");
  if (typeof task.seed !== "number" || !Number.isFinite(task.seed)) throw new Error("seed");
  if (typeof task.taskId !== "string" || task.taskId.length === 0) throw new Error("task id");
  if (!Number.isSafeInteger(task.stepBudget) || task.stepBudget < 0) throw new Error("step budget");
  assertPlain(task.payload, new WeakSet());
  assertPlain([...task.pluginPaths], new WeakSet());
  assertPlain([...task.pluginRoots], new WeakSet());
  assertPlain({ ...task.pluginDigests }, new WeakSet());
  // The descriptor itself is posted, so an extra own property such as a function is refused here too.
  assertPlain(task, new WeakSet());
}

/** Logical draw seed. Worker count and completion order are not arguments. */
export function analysisTaskSeed(baseSeed: number, logicalIndex: number): number {
  return logicalDrawSeed(baseSeed, logicalIndex);
}

/** value = digits * 10^exponent. `scientific` records that the input carried an exponent. */
type ScaledDecimal = Readonly<{ digits: bigint; exponent: number; scientific: boolean }>;

function parseDecimal(value: string): ScaledDecimal {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error("decimal required");
  const [, sign = "", whole = "0", frac = "", exponentText] = match;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isSafeInteger(exponent)) throw new Error("exponent out of range");
  const magnitude = BigInt(`${whole}${frac}`);
  return {
    digits: sign === "-" ? -magnitude : magnitude,
    exponent: exponent - frac.length,
    scientific: exponentText !== undefined,
  };
}

function renderPlain(sum: bigint, scale: number): string {
  const negative = sum < 0n;
  const abs = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? abs : abs.slice(0, abs.length - scale);
  const frac = scale === 0 ? "" : abs.slice(abs.length - scale).replace(/0+$/, "");
  const text = frac.length > 0 ? `${whole}.${frac}` : whole.replace(/^0+(?=\d)/, "");
  if (text === "0") return "0";
  return negative ? `-${text}` : text;
}

/** Exact scientific form: every significant digit stays, so no rounding happens here. */
function renderScientific(sum: bigint, exponent: number): string {
  if (sum === 0n) return "0";
  const negative = sum < 0n;
  let digits = negative ? -sum : sum;
  let power = exponent;
  while (digits % 10n === 0n) {
    digits /= 10n;
    power += 1;
  }
  const text = digits.toString();
  const scientificExponent = power + text.length - 1;
  const mantissa = text.length > 1 ? `${text[0]}.${text.slice(1)}` : text;
  return `${negative ? "-" : ""}${mantissa}e${scientificExponent >= 0 ? "+" : ""}${scientificExponent}`;
}

export function addDecimalStrings(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scientific = a.scientific || b.scientific;
  // A zero term has no exponent to align, so a far exponent on zero does not widen the sum.
  if (a.digits === 0n || b.digits === 0n) {
    const only = a.digits === 0n ? b : a;
    if (scientific) return renderScientific(only.digits, only.exponent);
    return renderPlain(only.digits, -Math.min(0, only.exponent));
  }
  const low = Math.min(a.exponent, b.exponent);
  const high = Math.max(a.exponent, b.exponent);
  if (high - low > MAX_EXPONENT_SPAN) throw new Error("exponent span too wide for an exact sum");
  const sum = a.digits * 10n ** BigInt(a.exponent - low) + b.digits * 10n ** BigInt(b.exponent - low);
  // Plain inputs have exponent <= 0, so the plain form keeps the earlier output exactly.
  if (scientific) return renderScientific(sum, low);
  return renderPlain(sum, -low);
}

/** UTF-8 bytes of the JSON message that carries one task. JSON.stringify().length counts UTF-16 units instead. */
export function serializedTaskBytes(task: AnalysisTrialTaskV1): number {
  return new TextEncoder().encode(JSON.stringify(task)).byteLength;
}

/** The refusal reason for each task, in input order, or null for a task that may run. */
export function taskRefusals(tasks: readonly AnalysisTrialTaskV1[]): (string | null)[] {
  return tasks.map((task) => {
    try {
      assertSerializableTask(task);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "invalid-task";
    }
  });
}

function outcomeOf(
  task: AnalysisTrialTaskV1,
  status: AnalysisTrialStatus,
  reason: string,
  attempts: number,
): AnalysisTrialOutcomeV1 {
  return {
    taskId: task.taskId,
    logicalIndex: task.logicalIndex,
    seed: task.seed,
    status,
    reason,
    attempts,
    semanticDigest: null,
    endMoney: null,
  };
}

function orderedTasks(tasks: readonly AnalysisTrialTaskV1[]): AnalysisTrialTaskV1[] {
  return [...tasks].sort(
    (left, right) => left.logicalIndex - right.logicalIndex || (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0),
  );
}

export function finalizeBatch(
  outcomes: readonly AnalysisTrialOutcomeV1[],
  cost: Readonly<{
    batchId: string;
    backend: "local" | "worker";
    selection: "local-default" | "explicit-worker";
    workerSpawnMs: number;
    serializedBytes: number;
  }>,
): ExecutionBatchV1 {
  const sorted = [...outcomes].sort(
    (left, right) => left.logicalIndex - right.logicalIndex || (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0),
  );
  const full = sorted.length > 0 && sorted.every((outcome) => outcome.status === "ok");
  let endMoney: string | null = null;
  if (full) {
    try {
      endMoney = sorted.reduce<string | null>((sum, outcome) => {
        if (sum === null || outcome.endMoney === null) return null;
        return addDecimalStrings(sum, outcome.endMoney);
      }, "0");
    } catch {
      endMoney = null;
    }
  }
  return {
    schemaVersion: 1,
    contract: "idlekit.execution-batch.v1",
    batchId: cost.batchId,
    backend: cost.backend,
    selection: cost.selection,
    complete: true,
    fullDistribution: full,
    outcomes: sorted,
    reduction: { order: "logical-index", endMoney },
    cost: { workerSpawnMs: cost.workerSpawnMs, serializedBytes: cost.serializedBytes },
  };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

export function runLocalBatch(
  tasks: readonly AnalysisTrialTaskV1[],
  runner: TrialRunner,
  options?: Readonly<{
    budget?: ExecutionBudgetV1;
    signal?: AbortSignal;
    batchId?: string;
    clock?: Readonly<{ now(): number }>;
  }>,
): ExecutionBatchV1 {
  const budget = budgetOf(options?.budget);
  const batchId = options?.batchId ?? `local-${tasks.length}`;
  const clock = options?.clock ?? { now: () => Date.now() };
  // Validate before measuring, so a cyclic payload fails its own task instead of throwing out of the batch.
  const reasons = taskRefusals(tasks);
  const refusals = new Map(tasks.map((task, index) => [task, reasons[index] ?? null] as const));
  const serializedBytes = tasks.reduce((sum, task) => (refusals.get(task) === null ? sum + serializedTaskBytes(task) : sum), 0);
  const header = {
    batchId,
    backend: "local" as const,
    selection: "local-default" as const,
    workerSpawnMs: 0,
    serializedBytes,
  };
  if (tasks.length === 0) return finalizeBatch([], header);
  if (tasks.length > budget.queueBound) {
    return finalizeBatch(
      tasks.map((task) => outcomeOf(task, "incomplete", "queue-bound", 0)),
      header,
    );
  }
  // taskTimeoutMs bounds each task on its own, as in the worker pool. There is no batch-wide window.
  const outcomes: AnalysisTrialOutcomeV1[] = [];
  for (const task of orderedTasks(tasks)) {
    if (options?.signal?.aborted) {
      outcomes.push(outcomeOf(task, "cancelled", "abort", 0));
      continue;
    }
    const invalid = refusals.get(task) ?? null;
    if (invalid) {
      outcomes.push(outcomeOf(task, "failed", invalid, 1));
      continue;
    }
    let attempt = 0;
    let outcome: AnalysisTrialOutcomeV1 | null = null;
    while (outcome === null) {
      if (options?.signal?.aborted) {
        outcome = outcomeOf(task, "cancelled", "abort", attempt);
        break;
      }
      const started = clock.now();
      let raw: AnalysisTrialOutcomeV1;
      try {
        raw = runner(task, { signal: options?.signal ?? new AbortController().signal, attempt, budget });
      } catch {
        // A thrown trial is a retryable failure of that task, as a crashed worker is. The batch keeps going.
        raw = outcomeOf(task, "failed", "trial-failed", attempt + 1);
      }
      if (isPromise(raw)) {
        throw new Error("local execution runner must be synchronous");
      }
      const elapsed = clock.now() - started;
      const next: AnalysisTrialOutcomeV1 = {
        ...raw,
        taskId: task.taskId,
        logicalIndex: task.logicalIndex,
        seed: task.seed,
        attempts: attempt + 1,
      };
      // Every attempt is bounded, whatever it returned. A worker attempt is cut at the same window.
      if (elapsed > budget.taskTimeoutMs) {
        outcome = outcomeOf(task, "incomplete", "timeout", attempt + 1);
        break;
      }
      if (next.status === "failed" && next.reason !== "plugin-trust" && attempt < budget.maxRetries) {
        attempt += 1;
        continue;
      }
      outcome = next;
    }
    outcomes.push(outcome);
  }
  return finalizeBatch(outcomes, header);
}

export function createLocalExecutionBackend(runner: TrialRunner, budget: ExecutionBudgetV1 = defaultExecutionBudget) {
  const inflight = new Map<string, AbortController>();
  return {
    kind: executionLocalDefault,
    budget: () => budget,
    cancel(batchId: string): void {
      inflight.get(batchId)?.abort();
    },
    submit(
      tasks: readonly AnalysisTrialTaskV1[],
      options?: Readonly<{ signal?: AbortSignal; batchId?: string; clock?: Readonly<{ now(): number }> }>,
    ): ExecutionBatchV1 {
      const batchId = options?.batchId ?? `local-${tasks.length}-${tasks[0]?.taskId ?? "empty"}`;
      const controller = new AbortController();
      const parent = options?.signal;
      const onAbort = () => controller.abort();
      // A signal that was aborted before submit fires no event, so carry it over now.
      if (parent?.aborted) controller.abort();
      else parent?.addEventListener("abort", onAbort);
      inflight.set(batchId, controller);
      try {
        return runLocalBatch(tasks, runner, { budget, signal: controller.signal, batchId, clock: options?.clock });
      } finally {
        inflight.delete(batchId);
        parent?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function semanticDigest(value: unknown): string {
  return sha256Text(canonicalJson(value));
}
