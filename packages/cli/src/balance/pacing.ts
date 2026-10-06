/** Hard safety ceilings. A plan may lower these limits, but cannot raise them. */
export const PACING_LIMITS = Object.freeze({
  maxRuns: 1_000,
  maxResults: 10_000,
  maxHorizonSec: 31_536_000,
  maxSeeds: 1_000,
  maxTargets: 1_000,
  maxParameters: 1_000,
  maxVariants: 1_000,
  maxTextLength: 200,
});

export type PacingStatus = "pass" | "breach" | "unreached" | "error";

/** Bounds are inclusive and use the metric's declared unit, without conversion. */
export type PacingTarget = Readonly<{
  metric: string;
  unit: string;
  min?: number;
  max?: number;
}>;

export type PacingConfig = Readonly<{
  horizonSec: number;
  seeds: readonly number[];
  strategy: string;
  targets: readonly PacingTarget[];
  /** Explicit allowlist and baseline values. Keys are opaque IDs, never evaluated. */
  parameters?: Readonly<Record<string, number>>;
  /** One-at-a-time absolute values, not a Cartesian product or percentage deltas. */
  sensitivity?: readonly Readonly<{ path: string; values: readonly number[] }>[];
  limits?: Readonly<{
    maxRuns?: number;
    maxResults?: number;
    maxHorizonSec?: number;
  }>;
}>;

export type PacingRunDescriptor = Readonly<{
  seed: number;
  horizonSec: number;
  strategy: string;
  variantId: string;
}>;

export type PacingVariant = Readonly<{
  id: string;
  /** A complete shallow overlay, including unchanged baseline parameters. */
  patches: Readonly<Record<string, number>>;
}>;

export type PacingPlan = Readonly<{
  horizonSec: number;
  seeds: readonly number[];
  strategy: string;
  targets: readonly PacingTarget[];
  parameters: Readonly<Record<string, number>>;
  variants: readonly PacingVariant[];
  runs: readonly PacingRunDescriptor[];
  limits: Readonly<{ maxRuns: number; maxResults: number; maxHorizonSec: number }>;
}>;

/**
 * The adapter owns applying the overlay and honoring the horizon, strategy and seed.
 * Return null only for a metric that was not reached within the horizon. Omitted or
 * nonfinite metrics are errors. Reported values must already use the target units.
 */
export type PacingEvaluator = (
  run: PacingRunDescriptor,
  patches: Readonly<Record<string, number>>,
) => Readonly<Record<string, number | null>> | Promise<Readonly<Record<string, number | null>>>;

export type PacingTargetResult = PacingTarget & Readonly<{
  value: number | null;
  status: PacingStatus;
  message?: string;
}>;

export type PacingRunResult = Readonly<{
  run: PacingRunDescriptor;
  patches: Readonly<Record<string, number>>;
  status: PacingStatus;
  results: readonly PacingTargetResult[];
}>;

export type PacingReport = Readonly<{
  ok: boolean;
  status: PacingStatus;
  horizonSec: number;
  seeds: readonly number[];
  strategy: string;
  targets: readonly PacingTarget[];
  variants: readonly PacingVariant[];
  runs: readonly PacingRunResult[];
  summary: Readonly<{
    totalRuns: number;
    totalResults: number;
    pass: number;
    breach: number;
    unreached: number;
    error: number;
  }>;
}>;

function invalid(message: string): never {
  throw new Error(`Invalid pacing config: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${label}.${key} is not supported`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0
    || value.length > PACING_LIMITS.maxTextLength || /[\x00-\x1f\x7f]/.test(value)) {
    invalid(`${label} must be a nonempty, trimmed string of at most ${PACING_LIMITS.maxTextLength} characters`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} must be finite`);
  // Avoid different JSON/text representations of the same numeric parameter or seed.
  return Object.is(value, -0) ? 0 : value;
}

function limit(value: unknown, maximum: number, label: string): number {
  if (value === undefined) return maximum;
  const parsed = finite(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    invalid(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

function list(value: unknown, label: string, maximum: number, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    invalid(`${label} must be an array with ${allowEmpty ? "0" : "1"} to ${maximum} entries`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parameterPath(value: unknown, label: string): string {
  const path = text(value, label);
  // Dotted paths and stable sheet IDs are labels only. Never traverse objects or eval them.
  if (!/^[A-Za-z0-9_-]+(?:[./:][A-Za-z0-9_-]+)*$/.test(path)
    || path.split(/[./:]/).some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    invalid(`${label} must be a safe parameter ID without prototype or executable segments`);
  }
  return path;
}

/** Validate the entire bounded sweep before invoking any evaluator. */
export function planPacingRuns(input: unknown): PacingPlan {
  const config = record(input, "config");
  keysOnly(config, ["horizonSec", "seeds", "strategy", "targets", "parameters", "sensitivity", "limits"], "config");
  const rawLimits = config.limits === undefined ? {} : record(config.limits, "limits");
  keysOnly(rawLimits, ["maxRuns", "maxResults", "maxHorizonSec"], "limits");
  const limits = Object.freeze({
    maxRuns: limit(rawLimits.maxRuns, PACING_LIMITS.maxRuns, "limits.maxRuns"),
    maxResults: limit(rawLimits.maxResults, PACING_LIMITS.maxResults, "limits.maxResults"),
    maxHorizonSec: limit(rawLimits.maxHorizonSec, PACING_LIMITS.maxHorizonSec, "limits.maxHorizonSec"),
  });
  const horizonSec = finite(config.horizonSec, "horizonSec");
  if (horizonSec <= 0 || horizonSec > limits.maxHorizonSec) {
    invalid(`horizonSec must be positive and no greater than ${limits.maxHorizonSec}`);
  }
  const strategy = text(config.strategy, "strategy");
  const seeds = list(config.seeds, "seeds", PACING_LIMITS.maxSeeds).map((value, index) => {
    const seed = finite(value, `seeds[${index}]`);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      invalid(`seeds[${index}] must be an unsigned 32-bit integer`);
    }
    return seed;
  }).sort((left, right) => left - right);
  if (new Set(seeds).size !== seeds.length) invalid("seeds must be unique");

  const metrics = new Set<string>();
  const targets = list(config.targets, "targets", PACING_LIMITS.maxTargets).map((entry, index) => {
    const raw = record(entry, `targets[${index}]`);
    keysOnly(raw, ["metric", "unit", "min", "max"], `targets[${index}]`);
    const metric = text(raw.metric, `targets[${index}].metric`);
    const unit = text(raw.unit, `targets[${index}].unit`);
    if (metrics.has(metric)) invalid(`duplicate target metric ${metric}`);
    metrics.add(metric);
    const min = raw.min === undefined ? undefined : finite(raw.min, `targets[${index}].min`);
    const max = raw.max === undefined ? undefined : finite(raw.max, `targets[${index}].max`);
    if (min === undefined && max === undefined) invalid(`target ${metric} needs min or max`);
    if (min !== undefined && max !== undefined && min > max) invalid(`target ${metric} min exceeds max`);
    return Object.freeze({ metric, unit, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  }).sort((left, right) => compareText(left.metric, right.metric));

  const rawParameters = config.parameters === undefined ? {} : record(config.parameters, "parameters");
  const parameterKeys = Object.keys(rawParameters).sort(compareText);
  if (parameterKeys.length > PACING_LIMITS.maxParameters) invalid("too many parameters");
  const parameters: Record<string, number> = {};
  for (const path of parameterKeys) {
    parameterPath(path, `parameters.${path}`);
    parameters[path] = finite(rawParameters[path], `parameters.${path}`);
  }
  Object.freeze(parameters);

  const paths = new Set<string>();
  const sensitivity = list(config.sensitivity === undefined ? [] : config.sensitivity, "sensitivity", PACING_LIMITS.maxParameters, true)
    .map((entry, index) => {
      const raw = record(entry, `sensitivity[${index}]`);
      keysOnly(raw, ["path", "values"], `sensitivity[${index}]`);
      const path = parameterPath(raw.path, `sensitivity[${index}].path`);
      if (!Object.hasOwn(parameters, path)) invalid(`sensitivity path ${path} is not declared in parameters`);
      if (paths.has(path)) invalid(`duplicate sensitivity path ${path}`);
      paths.add(path);
      const values = list(raw.values, `sensitivity[${index}].values`, PACING_LIMITS.maxVariants)
        .map((value, valueIndex) => finite(value, `sensitivity[${index}].values[${valueIndex}]`))
        .sort((left, right) => left - right);
      if (new Set(values).size !== values.length) invalid(`sensitivity values for ${path} must be unique`);
      return { path, values: values.filter((value) => value !== parameters[path]) };
    }).sort((left, right) => compareText(left.path, right.path));

  const variantCount = 1 + sensitivity.reduce((total, entry) => total + entry.values.length, 0);
  const runCount = variantCount * seeds.length;
  const resultCount = runCount * targets.length;
  if (variantCount > PACING_LIMITS.maxVariants) invalid(`variant count ${variantCount} exceeds ${PACING_LIMITS.maxVariants}`);
  if (runCount > limits.maxRuns) invalid(`run count ${runCount} exceeds maxRuns ${limits.maxRuns}`);
  if (resultCount > limits.maxResults) invalid(`result count ${resultCount} exceeds maxResults ${limits.maxResults}`);

  const variants: PacingVariant[] = [Object.freeze({ id: "baseline", patches: parameters })];
  for (const { path, values } of sensitivity) {
    for (const value of values) {
      variants.push(Object.freeze({
        id: `${path}=${value}`,
        patches: Object.freeze({ ...parameters, [path]: value }),
      }));
    }
  }
  const runs = variants.flatMap((variant) => seeds.map((seed) => Object.freeze({
    seed, horizonSec, strategy, variantId: variant.id,
  })));
  return Object.freeze({
    horizonSec, seeds: Object.freeze(seeds), strategy, targets: Object.freeze(targets), parameters,
    variants: Object.freeze(variants), runs: Object.freeze(runs), limits,
  });
}

const statusPriority: Readonly<Record<PacingStatus, number>> = { pass: 0, unreached: 1, breach: 2, error: 3 };

function worse(left: PacingStatus, right: PacingStatus): PacingStatus {
  return statusPriority[left] >= statusPriority[right] ? left : right;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown evaluator error";
  return `Evaluator failed: ${message.slice(0, 500)}`;
}

function checkTarget(target: PacingTarget, metrics: Readonly<Record<string, unknown>>): PacingTargetResult {
  if (!Object.hasOwn(metrics, target.metric)) {
    return { ...target, value: null, status: "error", message: "Evaluator omitted the target metric" };
  }
  const value = metrics[target.metric];
  if (value === null) return { ...target, value, status: "unreached", message: "Metric not reached within the run horizon" };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ...target, value: null, status: "error", message: "Evaluator metric must be a finite number or null" };
  }
  const breached = (target.min !== undefined && value < target.min) || (target.max !== undefined && value > target.max);
  return { ...target, value: Object.is(value, -0) ? 0 : value, status: breached ? "breach" : "pass" };
}

/**
 * Runs baseline first, then sorted one-at-a-time variants; each uses sorted seeds.
 * Calls are serial for deterministic invocation order. A callback failure records
 * errors for that run and does not discard the remaining bounded sweep.
 * These are in-process callbacks, not a sandbox or a wall-clock timeout mechanism.
 */
export async function runPacingChecks(input: unknown, evaluator: PacingEvaluator): Promise<PacingReport> {
  const plan = planPacingRuns(input);
  if (typeof evaluator !== "function") throw new Error("Pacing evaluator must be a function");
  const variants = new Map(plan.variants.map((variant) => [variant.id, variant]));
  const summary = { totalRuns: plan.runs.length, totalResults: 0, pass: 0, breach: 0, unreached: 0, error: 0 };
  const runs: PacingRunResult[] = [];
  let status: PacingStatus = "pass";
  for (const run of plan.runs) {
    const patches = variants.get(run.variantId)!.patches;
    let results: PacingTargetResult[];
    try {
      const metrics: unknown = await evaluator(run, patches);
      if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
        throw new Error("expected an object containing named numeric metrics or null");
      }
      results = plan.targets.map((target) => checkTarget(target, metrics as Record<string, unknown>));
    } catch (error) {
      const message = errorMessage(error);
      results = plan.targets.map((target) => ({ ...target, value: null, status: "error", message }));
    }
    let runStatus: PacingStatus = "pass";
    for (const result of results) {
      summary[result.status] += 1;
      summary.totalResults += 1;
      runStatus = worse(runStatus, result.status);
    }
    status = worse(status, runStatus);
    runs.push({ run, patches, status: runStatus, results });
  }
  return {
    ok: status === "pass", status, horizonSec: plan.horizonSec, seeds: plan.seeds, strategy: plan.strategy,
    targets: plan.targets, variants: plan.variants, runs, summary,
  };
}
