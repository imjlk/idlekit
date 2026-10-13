/**
 * Performance artifacts separate compiler prepare from simulation runtime.
 * alloc/step is unsupported. Missing counters stay absent. Worker startup and
 * serialization stay absent until a later worker backend exists.
 * This module does not enter the planner rollout or a Monte Carlo draw loop.
 */

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-bench-schema The artifact names idlekit.performance-budget at schemaVersion 1 and keeps alloc/step unsupported.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #26f2a73 Re-read the section: worker startup and serialization stay absent, and alloc/step is unsupported.
 */
export const budgetSchema = "bench-output-schema" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-workload-denominator Steps per second divide workload count by runtime seconds only.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-workload-denominator #4eb5d17 Re-read the section: prepare-cold and prepare-warm stay out of the quotient.
 */
export const budgetDenominator = "runtime-denominator" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-empty-duration An empty runtime duration does not become a rate of 0 or Infinity.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-empty-duration #02d4927 Re-read the section: no samples are absent, and a measured 0ms median stays measured while steps/sec stays absent.
 */
export const budgetEmptyDuration = "empty-duration-absent" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-unknown-metric Missing planner, draw, and retention counters are absent. A real 0 stays measured.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-unknown-metric #4278c4c Re-read the section: omitted counters are absent and alloc/step stays unsupported.
 */
export const budgetUnknownMetric = "unknown-is-not-zero" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-gate-failure A regression fails only when the relative slowdown and the absolute floor are both exceeded.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-gate-failure #9bd2c8d Re-read the section: too few repeats fail closed and the baseline writer is not called.
 */
export const budgetGateFailure = "unfavorable-fails" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-baseline-hash A config hash that does not match its config rejects the comparison.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-baseline-hash #d4cb210 Re-read the section: mismatch does not write a new baseline.
 */
export const budgetHashMismatch = "baseline-hash-rejected" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config Only matching engine, seed, model, step, trace, observer, worker, and planner configs are compared.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #3c5907d Re-read the section: a small absolute change can pass, and a different observer, engine, or trace cannot be compared.
 */
export const budgetSameConfig = "same-config-only" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-phase-labels prepare-cold stays cold and prepare-warm stays warm.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-phase-labels #4e1a2c4 Re-read the section: runtime median ignores prepare samples.
 */
export const budgetPhaseLabels = "cold-warm-labels" as const;

export type Metric =
  | Readonly<{ status: "measured"; value: number }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "unsupported" }>;

export type BenchConfig = Readonly<{
  engineId: string;
  seed: number | null;
  modelId: string;
  modelVersion: number;
  stepSec: number;
  trace: "off" | "bounded" | "unbounded";
  observer: "off" | "on";
  worker: "none";
  planner: "off" | "on";
}>;

export type HostInfo = Readonly<{
  bun: string;
  cpu: string;
  os: string;
  arch: string;
}>;

export type PhaseName = "install" | "prepare-cold" | "prepare-warm" | "check" | "build" | "runtime";
export type PhaseLabel = "cold" | "warm" | "runtime" | "other";

export type PhaseSample = Readonly<{
  phase: PhaseName;
  label: PhaseLabel;
  durationMs: number;
}>;

export type PerformanceArtifact = Readonly<{
  contract: "idlekit.performance-budget";
  schemaVersion: 1;
  corpus: "representative" | "long";
  scenario: string | null;
  /** sha256 of the canonical scenario JSON. Duration, params, and strategy inputs live here, not in config. */
  scenarioHash: string | null;
  config: BenchConfig;
  configHash: string;
  host: HostInfo;
  iterations: number;
  warmup: number;
  workloadCount: number | null;
  phases: readonly PhaseSample[];
  metrics: Readonly<{
    totalTimeMedianMs: Metric;
    totalTimeP95Ms: Metric;
    stepsPerSec: Metric;
    plannerExpandedNodes: Metric;
    plannerNodesPerSec: Metric;
    drawsPerSec: Metric;
    rssDeltaBytes: Metric;
    heapDeltaBytes: Metric;
    peakRssBytes: Metric;
    observationRetainedSamples: Metric;
    allocPerStep: Metric;
  }>;
  worker: Readonly<{
    startupMs: Metric;
    serializationMs: Metric;
  }>;
}>;

export type BudgetPolicy = Readonly<{
  minIterations: number;
  relativeSlowdown: number;
  absoluteMedianMs: number;
}>;

export type BudgetComparison =
  | Readonly<{ status: "pass"; reason: "within-budget" }>
  | Readonly<{ status: "fail"; reason: "regression" | "too-few-repeats" | "unmeasured" }>
  | Readonly<{
    status: "rejected";
    reason: "baseline-hash-mismatch" | "config-mismatch" | "workload-mismatch" | "host-mismatch";
  }>;

export type ArtifactInput = Readonly<{
  corpus: "representative" | "long";
  scenario?: string | null;
  scenarioHash?: string | null;
  config: BenchConfig;
  host: HostInfo;
  iterations: number;
  warmup: number;
  workloadCount: number | null;
  phases: Readonly<{
    installMs?: number;
    prepareColdMs?: number;
    prepareWarmMs?: readonly number[];
    checkMs?: number;
    buildMs?: number;
    runtimeMs: readonly number[];
  }>;
  plannerExpandedNodes?: number | null;
  draws?: number | null;
  retainedSamples?: number | null;
  rssDeltaBytes?: number | null;
  heapDeltaBytes?: number | null;
  peakRssBytes?: number | null;
}>;

const ABSENT: Metric = { status: "absent" };
const UNSUPPORTED: Metric = { status: "unsupported" };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function configHash(config: BenchConfig): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(canonicalJson(config));
  return hasher.digest("hex");
}

export function scenarioHash(scenario: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(canonicalJson(scenario));
  return hasher.digest("hex");
}

export function sameBenchConfig(left: BenchConfig, right: BenchConfig): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** Bun, OS, and arch must match. CPU brand is recorded but not compared, since CI runner CPUs vary. */
export function sameHost(left: HostInfo, right: HostInfo): boolean {
  return left.bun === right.bun && left.os === right.os && left.arch === right.arch;
}

function finiteMetric(value: number | null | undefined): Metric {
  if (value === null || value === undefined || !Number.isFinite(value)) return ABSENT;
  return { status: "measured", value };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1];
    const right = sorted[mid];
    if (left === undefined || right === undefined) return null;
    return (left + right) / 2;
  }
  return sorted[mid] ?? null;
}

/** Nearest-rank percentile: the smallest sample with at least p of the samples at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx] ?? null;
}

/** Comma-separated duration samples. Each must be a finite number >= 0, or the flag is rejected. */
export function readSamples(flag: string, value: string | undefined): number[] {
  if (value === undefined || value.trim().length === 0) throw new Error(`${flag} needs at least one sample`);
  return value.split(",").map((item) => {
    const text = item.trim();
    const parsed = Number(text);
    if (text.length === 0 || !Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${flag} samples must be finite numbers >= 0 (received: ${item})`);
    }
    return parsed;
  });
}

/** A finite number > 0, or the flag is rejected. */
export function readPositive(flag: string, value: string | undefined): number {
  const parsed = value === undefined || value.trim().length === 0 ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a finite number > 0 (received: ${value})`);
  return parsed;
}

/** A nonblank value, or the flag is rejected. */
export function readText(flag: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`${flag} needs a value`);
  return value;
}

/** One of the listed values, or the flag is rejected. */
export function readChoice<T extends string>(flag: string, value: string | undefined, choices: readonly T[]): T {
  const match = choices.find((choice) => choice === value);
  if (match === undefined) throw new Error(`${flag} must be one of ${choices.join(", ")} (received: ${value})`);
  return match;
}

/** A counter: an integer >= 0, or the flag is rejected. */
export function readCount(flag: string, value: string | undefined): number {
  const parsed = value === undefined || value.trim().length === 0 ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be an integer >= 0 (received: ${value})`);
  return parsed;
}

function rate(count: number | null | undefined, runtimeMs: readonly number[]): Metric {
  if (count === null || count === undefined || !Number.isFinite(count)) return ABSENT;
  const mid = median(runtimeMs);
  if (mid === null || mid <= 0) return ABSENT;
  return { status: "measured", value: count / (mid / 1000) };
}

function timeEpsilon(limitSec: number): number {
  const magnitude = Math.abs(limitSec);
  const scaled = Number.isFinite(magnitude) ? magnitude * 1e-12 : 0;
  return Math.max(1e-12, scaled);
}

const MAX_COUNTED_STEPS = 100_000_000;

/**
 * Duration steps, including a shorter last tick. A missing duration is null.
 * A duration past the counting limit is null, never a truncated count.
 */
export function workloadStepCount(durationSec: number, stepSec: number): number | null {
  if (!Number.isFinite(durationSec) || !Number.isFinite(stepSec) || stepSec <= 0 || durationSec < 0) return null;
  if (durationSec / stepSec > MAX_COUNTED_STEPS) return null;
  let elapsed = 0;
  let steps = 0;
  while (elapsed < durationSec - timeEpsilon(durationSec)) {
    const dt = Math.min(stepSec, durationSec - elapsed);
    if (!(dt > 0)) break;
    elapsed += dt;
    steps += 1;
    if (steps > MAX_COUNTED_STEPS) return null;
  }
  return steps;
}

/** What simulate reported for a run: `_meta.effectiveEngine` and `_meta.seed`. */
export type EffectiveRun = Readonly<{ engine: string; seed: number | null }>;

/**
 * The comparable config of a scenario file. Workload size and params are in scenarioHash.
 * Engine and seed are the ones the run used. `scenario.engine` is metadata and does not select the
 * engine, and a scenario file has no seed. A scenario file cannot turn off the observation recorder,
 * which runScenario enables by default, so observer is on.
 */
export function benchConfigFromScenario(raw: unknown, run: EffectiveRun): BenchConfig {
  const scenario = raw && typeof raw === "object" ? raw as {
    model?: { id?: unknown; version?: unknown };
    clock?: { stepSec?: unknown; durationSec?: unknown };
    strategy?: { id?: unknown };
    outputs?: { report?: { includeTrace?: unknown; traceEverySteps?: unknown } };
  } : {};
  const includeTrace = scenario.outputs?.report?.includeTrace === true;
  // The compiler defaults traceEverySteps to 1, which traces every step.
  const every = scenario.outputs?.report?.traceEverySteps;
  const trace = !includeTrace ? "off" : typeof every === "number" && every > 1 ? "bounded" : "unbounded";
  return {
    engineId: run.engine,
    seed: run.seed,
    modelId: typeof scenario.model?.id === "string" ? scenario.model.id : "unknown",
    modelVersion: typeof scenario.model?.version === "number" ? scenario.model.version : 0,
    stepSec: typeof scenario.clock?.stepSec === "number" ? scenario.clock.stepSec : 1,
    trace,
    observer: "on",
    worker: "none",
    planner: scenario.strategy?.id === "planner" ? "on" : "off",
  };
}

/** Steps the scenario clock runs, or null when an until expression or a missing duration leaves it unknown. */
export function scenarioWorkload(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const clock = (raw as { clock?: { durationSec?: unknown; stepSec?: unknown; untilExpr?: unknown } }).clock;
  if (typeof clock?.durationSec !== "number" || typeof clock.stepSec !== "number") return null;
  // A nonblank until expression can stop before the duration, so the step count is unknown.
  // The compiler ignores a blank one.
  if (typeof clock.untilExpr === "string" && clock.untilExpr.trim().length > 0) return null;
  if (clock.untilExpr !== undefined && typeof clock.untilExpr !== "string") return null;
  return workloadStepCount(clock.durationSec, clock.stepSec);
}

function phasesFrom(input: ArtifactInput["phases"]): PhaseSample[] {
  const phases: PhaseSample[] = [];
  if (input.installMs !== undefined) phases.push({ phase: "install", label: "other", durationMs: input.installMs });
  if (input.prepareColdMs !== undefined) {
    phases.push({ phase: "prepare-cold", label: "cold", durationMs: input.prepareColdMs });
  }
  for (const durationMs of input.prepareWarmMs ?? []) {
    phases.push({ phase: "prepare-warm", label: "warm", durationMs });
  }
  if (input.checkMs !== undefined) phases.push({ phase: "check", label: "other", durationMs: input.checkMs });
  if (input.buildMs !== undefined) phases.push({ phase: "build", label: "other", durationMs: input.buildMs });
  for (const durationMs of input.runtimeMs) {
    phases.push({ phase: "runtime", label: "runtime", durationMs });
  }
  return phases;
}

export function buildPerformanceArtifact(input: ArtifactInput): PerformanceArtifact {
  const runtimeMs = input.phases.runtimeMs;
  const mid = median(runtimeMs);
  const p95 = percentile(runtimeMs, 0.95);
  return {
    contract: "idlekit.performance-budget",
    schemaVersion: 1,
    corpus: input.corpus,
    scenario: input.scenario ?? null,
    scenarioHash: input.scenarioHash ?? null,
    config: input.config,
    configHash: configHash(input.config),
    host: input.host,
    iterations: input.iterations,
    warmup: input.warmup,
    workloadCount: input.workloadCount,
    phases: phasesFrom(input.phases),
    metrics: {
      totalTimeMedianMs: mid === null ? ABSENT : { status: "measured", value: mid },
      totalTimeP95Ms: p95 === null ? ABSENT : { status: "measured", value: p95 },
      stepsPerSec: rate(input.workloadCount, runtimeMs),
      plannerExpandedNodes: finiteMetric(input.plannerExpandedNodes),
      plannerNodesPerSec: rate(input.plannerExpandedNodes, runtimeMs),
      drawsPerSec: rate(input.draws, runtimeMs),
      rssDeltaBytes: finiteMetric(input.rssDeltaBytes),
      heapDeltaBytes: finiteMetric(input.heapDeltaBytes),
      peakRssBytes: finiteMetric(input.peakRssBytes),
      observationRetainedSamples: finiteMetric(input.retainedSamples),
      allocPerStep: UNSUPPORTED,
    },
    worker: {
      startupMs: ABSENT,
      serializationMs: ABSENT,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isMetric(value: unknown, allowed: ReadonlySet<Metric["status"]>): value is Metric {
  if (!isRecord(value) || typeof value.status !== "string" || !allowed.has(value.status as Metric["status"])) {
    return false;
  }
  if (value.status === "measured") return typeof value.value === "number" && Number.isFinite(value.value);
  return value.value === undefined;
}

const MEASURED_OR_ABSENT = new Set<Metric["status"]>(["measured", "absent"]);

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function readPerformanceArtifact(value: unknown): PerformanceArtifact | null {
  if (!isRecord(value)) return null;
  if (value.contract !== "idlekit.performance-budget" || value.schemaVersion !== 1) return null;
  if (value.corpus !== "representative" && value.corpus !== "long") return null;
  if (!isRecord(value.config) || typeof value.configHash !== "string") return null;
  if (!isRecord(value.host) || typeof value.host.bun !== "string" || typeof value.host.os !== "string") return null;
  if (typeof value.host.arch !== "string" || typeof value.host.cpu !== "string") return null;
  if (!isNullableString(value.scenario) || !isNullableString(value.scenarioHash)) return null;
  if (!isCount(value.iterations, 1) || !isCount(value.warmup, 0)) return null;
  if (value.workloadCount !== null && !isCount(value.workloadCount, 0)) return null;
  if (!Array.isArray(value.phases)) return null;
  if (!isRecord(value.metrics) || !isRecord(value.worker)) return null;
  if (!isMetric(value.metrics.allocPerStep, new Set(["unsupported"]))) return null;
  if (!isMetric(value.worker.startupMs, new Set(["absent"]))) return null;
  if (!isMetric(value.worker.serializationMs, new Set(["absent"]))) return null;
  const metricNames = [
    "totalTimeMedianMs",
    "totalTimeP95Ms",
    "stepsPerSec",
    "plannerExpandedNodes",
    "plannerNodesPerSec",
    "drawsPerSec",
    "rssDeltaBytes",
    "heapDeltaBytes",
    "peakRssBytes",
    "observationRetainedSamples",
  ] as const;
  for (const name of metricNames) {
    if (!isMetric(value.metrics[name], MEASURED_OR_ABSENT)) return null;
  }
  return value as unknown as PerformanceArtifact;
}

/**
 * Read a baseline file: one artifact, or the bench-sim `--out` result whose
 * `perScenario[].budget` entries are artifacts. Any invalid entry rejects the file.
 */
export function readBaselineArtifacts(value: unknown): PerformanceArtifact[] | null {
  const direct = readPerformanceArtifact(value);
  if (direct) return [direct];
  if (!isRecord(value) || !Array.isArray(value.perScenario) || value.perScenario.length === 0) return null;
  const artifacts: PerformanceArtifact[] = [];
  for (const entry of value.perScenario) {
    const artifact = isRecord(entry) ? readPerformanceArtifact(entry.budget) : null;
    if (!artifact) return null;
    artifacts.push(artifact);
  }
  return artifacts;
}

/**
 * Baseline entries after a refresh: each fresh artifact replaces the entries on the same host with
 * the same scenario path or the same scenario hash, so an edited scenario does not leave its old
 * entry behind. Other hosts' entries stay.
 */
export function mergeBaselines(
  existing: readonly PerformanceArtifact[],
  fresh: readonly PerformanceArtifact[],
): PerformanceArtifact[] {
  const replaced = (old: PerformanceArtifact) =>
    fresh.some((next) =>
      sameHost(next.host, old.host) &&
      ((next.scenario !== null && next.scenario === old.scenario) ||
        (next.scenarioHash !== null && next.scenarioHash === old.scenarioHash))
    );
  return [...existing.filter((old) => !replaced(old)), ...fresh];
}

/**
 * The baseline for the same scenario content on the same host, then for the same scenario on any
 * host, then the only baseline when the file has one.
 */
export function selectBaseline(
  baselines: readonly PerformanceArtifact[],
  current: PerformanceArtifact,
): PerformanceArtifact | null {
  const sameScenario = baselines.filter((item) => item.scenarioHash !== null && item.scenarioHash === current.scenarioHash);
  const sameHostToo = sameScenario.find((item) => sameHost(item.host, current.host));
  if (sameHostToo) return sameHostToo;
  if (sameScenario[0]) return sameScenario[0];
  return baselines.length === 1 ? baselines[0] ?? null : null;
}

/**
 * Compare two artifacts from the same runner.
 * A pass, a failure, and a rejected hash all leave the baseline file untouched.
 */
export function comparePerformanceBudgets(
  baseline: PerformanceArtifact,
  current: PerformanceArtifact,
  policy: BudgetPolicy,
  onBaselineWrite?: (next: PerformanceArtifact) => void,
): BudgetComparison {
  void onBaselineWrite;
  if (baseline.configHash !== configHash(baseline.config) || current.configHash !== configHash(current.config)) {
    return { status: "rejected", reason: "baseline-hash-mismatch" };
  }
  if (!sameBenchConfig(baseline.config, current.config)) {
    return { status: "rejected", reason: "config-mismatch" };
  }
  if (baseline.scenarioHash !== current.scenarioHash || baseline.workloadCount !== current.workloadCount) {
    return { status: "rejected", reason: "workload-mismatch" };
  }
  if (!sameHost(baseline.host, current.host)) {
    return { status: "rejected", reason: "host-mismatch" };
  }
  if (current.iterations < policy.minIterations || baseline.iterations < policy.minIterations) {
    return { status: "fail", reason: "too-few-repeats" };
  }
  const before = baseline.metrics.totalTimeMedianMs;
  const after = current.metrics.totalTimeMedianMs;
  if (before.status !== "measured" || after.status !== "measured") {
    return { status: "fail", reason: "unmeasured" };
  }
  const slowed = after.value > before.value * (1 + policy.relativeSlowdown);
  const overAbsolute = after.value > policy.absoluteMedianMs;
  if (slowed && overAbsolute) return { status: "fail", reason: "regression" };
  return { status: "pass", reason: "within-budget" };
}

export function currentHost(): HostInfo {
  let cpu = "unsupported";
  if (process.platform === "darwin") {
    const proc = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
    if (text.length > 0) cpu = text;
  }
  return {
    bun: Bun.version,
    cpu,
    os: process.platform,
    arch: process.arch,
  };
}

export function representativeConfig(overrides: Partial<BenchConfig> = {}): BenchConfig {
  return {
    engineId: "number",
    seed: null,
    modelId: "linear",
    modelVersion: 1,
    stepSec: 1,
    trace: "off",
    observer: "off",
    worker: "none",
    planner: "off",
    ...overrides,
  };
}
