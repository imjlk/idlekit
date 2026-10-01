/**
 * Performance artifacts separate compiler prepare from simulation runtime.
 * alloc/step is unsupported. Missing counters stay absent. Worker startup and
 * serialization stay absent until a later worker backend exists.
 * This module does not enter the planner rollout or a Monte Carlo draw loop.
 */

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-bench-schema The artifact names idlekit.performance-budget at schemaVersion 1 and keeps alloc/step unsupported.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-bench-schema #b85a868 Re-read the section: worker startup and serialization stay absent, and alloc/step is unsupported.
 */
export const budgetSchema = "bench-output-schema" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-workload-denominator Steps per second divide workload count by runtime seconds only.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-workload-denominator #11a4355 Re-read the section: prepare-cold and prepare-warm stay out of the quotient.
 */
export const budgetDenominator = "runtime-denominator" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-empty-duration An empty runtime duration does not become a rate of 0 or Infinity.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-empty-duration #02d4927 Re-read the section: no samples are absent, and a measured 0ms median stays measured while steps/sec stays absent.
 */
export const budgetEmptyDuration = "empty-duration-absent" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-unknown-metric Missing planner, draw, and retention counters are absent. A real 0 stays measured.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-unknown-metric #f80c38b Re-read the section: omitted counters are absent and alloc/step stays unsupported.
 */
export const budgetUnknownMetric = "unknown-is-not-zero" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-gate-failure A regression fails only when the relative slowdown and the absolute floor are both exceeded.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-gate-failure #c1a6c6b Re-read the section: too few repeats fail closed and the baseline writer is not called.
 */
export const budgetGateFailure = "unfavorable-fails" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-baseline-hash A config hash that does not match its config rejects the comparison.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-baseline-hash #654f6b5 Re-read the section: mismatch does not write a new baseline.
 */
export const budgetHashMismatch = "baseline-hash-rejected" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-same-config Only matching engine, seed, model, step, trace, observer, worker, and planner configs are compared.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-same-config #2373b21 Re-read the section: a small absolute change can pass, and a different observer, engine, or trace cannot be compared.
 */
export const budgetSameConfig = "same-config-only" as const;

/**
 * @evidence docs/requirements/active/performance-budget.md#req-dx04-phase-labels prepare-cold stays cold and prepare-warm stays warm.
 * @evidenceReview docs/requirements/active/performance-budget.md#req-dx04-phase-labels #9da1e03 Re-read the section: runtime median ignores prepare samples.
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
  | Readonly<{ status: "rejected"; reason: "baseline-hash-mismatch" | "config-mismatch" }>;

export type ArtifactInput = Readonly<{
  corpus: "representative" | "long";
  scenario?: string | null;
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

export function sameBenchConfig(left: BenchConfig, right: BenchConfig): boolean {
  return canonicalJson(left) === canonicalJson(right);
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

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? null;
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

/** Duration steps, including a shorter last tick. A missing duration is null. */
export function workloadStepCount(durationSec: number, stepSec: number): number | null {
  if (!Number.isFinite(durationSec) || !Number.isFinite(stepSec) || stepSec <= 0 || durationSec < 0) return null;
  let elapsed = 0;
  let steps = 0;
  while (steps < 1_000_000) {
    if (elapsed >= durationSec - timeEpsilon(durationSec)) break;
    const dt = Math.min(stepSec, durationSec - elapsed);
    if (!(dt > 0)) break;
    elapsed += dt;
    steps += 1;
  }
  return steps;
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

export function readPerformanceArtifact(value: unknown): PerformanceArtifact | null {
  if (!isRecord(value)) return null;
  if (value.contract !== "idlekit.performance-budget" || value.schemaVersion !== 1) return null;
  if (value.corpus !== "representative" && value.corpus !== "long") return null;
  if (!isRecord(value.config) || typeof value.configHash !== "string") return null;
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
    "observationRetainedSamples",
  ] as const;
  for (const name of metricNames) {
    if (!isMetric(value.metrics[name], MEASURED_OR_ABSENT)) return null;
  }
  return value as unknown as PerformanceArtifact;
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
