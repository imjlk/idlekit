import typia, { type IValidation } from "typia";
import { mulberry32, logicalDrawId, logicalDrawSeed } from "../random";

/**
 * Distribution summary v1.
 * Completion-conditioned quantiles stay labeled. They are not the population quantile.
 * `mean-of-log10` is not an arithmetic mean.
 */

const DISTRIBUTION_ALGORITHM_VERSION = "distribution-v1" as const;
const DISTRIBUTION_SCHEMA_ID = "https://idlekit.dev/schemas/distribution.v1.schema.json" as const;
const QUANTILE_METHOD = "inclusive-floor-index" as const;
const QUANTILE_METHOD_VERSION = 1 as const;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-sample-accounting Each sample is observed, censored, failed, or unsupported. A censored tail is not an observed p95.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-sample-accounting #6e4e90e Re-read the section: 90 of 100 complete, the population p95 stays null, and an all-censored run is not mean 0.
 */
export const distributionSampleAccounting = "observed-censored-failed-unsupported" as const;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention The default quantile is inclusive floor of (n-1)*q. Keys are canonical, not rounded percents.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention #2413847 Re-read the section: the five-point array hits 1, 3, 4, and 5, an empty sample stays null, and q0.946 does not share a key with q0.954.
 */
export const distributionQuantileConvention = "inclusive-floor-index-v1" as const;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws Logical draw id and seed ignore worker count and call order. Common random numbers need the execution stream.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws #6e3688a Re-read the section: reversed calls keep draw 2, and an unsupported stream refuses pairing.
 */
export const distributionLogicalDraws = "logical-index-not-worker-slot" as const;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-empirical-drop A seeded 1% Bernoulli draw is checked inside a fixed tolerance. A deterministic model may report zero variance.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-empirical-drop #466e88b Re-read the section: the rate is not required to equal 0.01 exactly, and identical draws stay zero variance.
 */
export const distributionEmpiricalDrop = "seeded-bernoulli-tolerance" as const;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-mean-identity Arithmetic mean, mean of log10, and log10 of the mean are different slots. A missing first visible change is censored.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-mean-identity #5fa6bcc Re-read the section: mean of log10 of 10 and 1000 is 2, and an absent first visible change does not become active time or 0.
 */
export const distributionMeanIdentity = "arithmetic-mean-log-and-log-mean" as const;

export function distributionSchemaId(): typeof DISTRIBUTION_SCHEMA_ID {
  return DISTRIBUTION_SCHEMA_ID;
}

export function distributionAlgorithmVersion(): typeof DISTRIBUTION_ALGORITHM_VERSION {
  return DISTRIBUTION_ALGORITHM_VERSION;
}

export class DistributionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributionRejected";
  }
}

export type DistributionSampleStatus = "observed" | "censored" | "failed" | "unsupported";

export type DistributionUncertaintySource = "model-strategy-session" | "monetization" | "mixed";

export type DistributionSample = Readonly<{
  drawIndex: number;
  seed: number;
  status: DistributionSampleStatus;
  value: string | null;
  source: Exclude<DistributionUncertaintySource, "mixed">;
}>;

export type DistributionQuantilePoint = Readonly<{
  key: string;
  q: number;
  conditioning: "completed-only";
  status: "observed" | "unavailable";
  value: string | null;
}>;

export type DistributionPopulationQuantile = Readonly<{
  key: string;
  q: number;
  conditioning: "all-eligible-draws";
  estimator: "common-horizon-order-statistic" | "not-estimated";
  status: "observed" | "outside-observed-range" | "unavailable";
  value: string | null;
}>;

export type DistributionMeanSlot = Readonly<{
  label: "arithmetic-mean" | "mean-of-log10" | "log10-of-arithmetic-mean";
  status: "observed" | "unavailable" | "unsupported";
  value: string | null;
}>;

export type DistributionArtifactV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: typeof DISTRIBUTION_ALGORITHM_VERSION;
  method: Readonly<{ id: typeof QUANTILE_METHOD; version: typeof QUANTILE_METHOD_VERSION }>;
  status: "ok" | "unavailable" | "unsupported";
  horizonSec: number | null;
  accounting: Readonly<{
    draws: number;
    observed: number;
    rightCensored: number;
    failed: number;
    unsupported: number;
    completionRate: number | null;
  }>;
  seeds: readonly Readonly<{ drawId: string; drawIndex: number; seed: number }>[];
  uncertainty: Readonly<{
    source: DistributionUncertaintySource;
    zeroVariance: boolean;
    variance: number | null;
  }>;
  population: DistributionPopulationQuantile;
  conditional: readonly DistributionQuantilePoint[];
  means: Readonly<{
    arithmetic: DistributionMeanSlot;
    meanLog10: DistributionMeanSlot;
    log10OfMean: DistributionMeanSlot;
  }>;
  reduction: Readonly<{ order: "logical-draw-index"; workerCountIndependent: true }>;
  warnings: readonly string[];
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateDistributionArtifactValidator: ((input: unknown) => IValidation<DistributionArtifactV1>) | undefined;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention The generated validator accepts this artifact.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention #2413847 Re-read the section: the wire object is distribution v1 and the method is inclusive-floor-index.
 */
export const validateDistributionArtifact = (input: unknown): IValidation<DistributionArtifactV1> =>
  (validateDistributionArtifactValidator ??= typia.createValidate<DistributionArtifactV1>())(input);

function buildDistributionJsonSchema() {
  return typia.json.schema<DistributionArtifactV1, "3.1">();
}

let distributionJsonSchemaUnit: ReturnType<typeof buildDistributionJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention #2413847 Re-read the section: schema version is 3.1.
 */
export function distributionJsonSchema(): ReturnType<typeof buildDistributionJsonSchema> {
  distributionJsonSchemaUnit ??= buildDistributionJsonSchema();
  return distributionJsonSchemaUnit;
}

export type DistributionRequest = Readonly<{
  samples: readonly DistributionSample[];
  quantiles: readonly number[];
  horizonSec?: number | null;
  populationProbability?: number;
  coupling?: Readonly<{ commonRandomNumbers: boolean; executionStream: boolean }>;
}>;

const WARNINGS = [
  "a censored sample is not a zero-second completion",
  "a failed or unsupported sample is not an observed improvement",
  "completion-conditioned quantiles are not the population quantile",
  "mean of log10 is not the arithmetic mean, and log10 of the mean is a third metric",
  "this estimator is not a survival model for varying censoring times",
  "logical draw seeds ignore worker count and call order",
  "zero variance is a valid result when the model consumes no randomness",
] as const;

export function canonicalQuantileKey(q: number): string {
  if (typeof q !== "number" || !Number.isFinite(q) || q < 0 || q > 1) {
    throw new DistributionRejected("distribution quantile must be a finite number from 0 to 1");
  }
  return `q${Object.is(q, -0) ? "0" : String(q)}`;
}

/**
 * Inclusive floor index on the ordered finite values.
 * Empty input is null, not 0. This is method `inclusive-floor-index` version 1.
 */
export function quantileInclusiveFloor(values: readonly number[], q: number): number | null {
  canonicalQuantileKey(q);
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index] ?? null;
}

export function assertDistributionRun(args: Readonly<{
  draws: number;
  seed: number;
  quantiles: readonly number[];
  budget?: number;
  coupling?: DistributionRequest["coupling"];
}>): number {
  if (typeof args.draws !== "number" || !Number.isFinite(args.draws) || args.draws < 1) {
    throw new DistributionRejected("distribution draws must be a finite number >= 1");
  }
  const count = Math.floor(args.draws);
  if (count < 1) throw new DistributionRejected("distribution draws must be a finite number >= 1");
  if (typeof args.seed !== "number" || !Number.isFinite(args.seed)) {
    throw new DistributionRejected("distribution seed must be finite");
  }
  if (args.budget !== undefined && (typeof args.budget !== "number" || !Number.isFinite(args.budget) || args.budget < count)) {
    throw new DistributionRejected("distribution budget must be a finite number >= draws");
  }
  quantileKeys(args.quantiles);
  if (args.coupling?.commonRandomNumbers && args.coupling.executionStream !== true) {
    throw new DistributionRejected("common random numbers require the execution stream");
  }
  return count;
}

/** One uniform from the logical draw seed. Worker count is not an argument. */
export function independentBernoulli(seed: number, drawIndex: number, probability: number): boolean {
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new DistributionRejected("distribution probability must be a finite number from 0 to 1");
  }
  return mulberry32(logicalDrawSeed(seed, drawIndex))() < probability;
}

/**
 * A missing first visible change is censored.
 * It is not replaced with active time or with 0.
 */
export function firstVisibleDistributionSample(args: Readonly<{
  drawIndex: number;
  seed: number;
  firstVisibleChangeSec: number | undefined;
}>): DistributionSample {
  if (!Number.isInteger(args.drawIndex) || args.drawIndex < 0) {
    throw new DistributionRejected("distribution drawIndex must be an integer >= 0");
  }
  if (typeof args.seed !== "number" || !Number.isFinite(args.seed)) {
    throw new DistributionRejected("distribution seed must be finite");
  }
  if (args.firstVisibleChangeSec === undefined) {
    return {
      drawIndex: args.drawIndex,
      seed: args.seed,
      status: "censored",
      value: null,
      source: "model-strategy-session",
    };
  }
  // Seconds since the session start. A non-finite or negative time is not a completion.
  if (!Number.isFinite(args.firstVisibleChangeSec) || args.firstVisibleChangeSec < 0) {
    return {
      drawIndex: args.drawIndex,
      seed: args.seed,
      status: "failed",
      value: null,
      source: "model-strategy-session",
    };
  }
  return {
    drawIndex: args.drawIndex,
    seed: args.seed,
    status: "observed",
    value: String(args.firstVisibleChangeSec),
    source: "model-strategy-session",
  };
}

function quantileKeys(quantiles: readonly number[]): string[] {
  if (quantiles.length === 0) throw new DistributionRejected("distribution quantiles must be non-empty");
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const q of quantiles) {
    const key = canonicalQuantileKey(q);
    if (seen.has(key)) throw new DistributionRejected(`distribution quantile key ${key} is duplicated`);
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function formatFinite(value: number): string {
  if (Object.is(value, -0)) return "0";
  return String(value);
}

const DECIMAL_WIRE = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

/** Sign, significant digits, and exponent of a decimal spelling, so two spellings of one value compare equal. */
function decimalKey(text: string): string | null {
  const match = DECIMAL_WIRE.exec(text.trim());
  if (!match) return null;
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  if (whole === "" && fraction === "") return null;
  // Index scans, not /0+$/: a regex anchored at the end rescans a long run of zeros from every start.
  const raw = `${whole}${fraction}`;
  let first = 0;
  while (first < raw.length && raw[first] === "0") first += 1;
  let last = raw.length;
  while (last > first && raw[last - 1] === "0") last -= 1;
  if (first === last) return "0";
  const exponent = Number(match[4] ?? "0") - fraction.length + (raw.length - last);
  return `${match[1] === "-" ? "-" : ""}${raw.slice(first, last)}e${exponent}`;
}

/**
 * The observed value as a number, only when the number is the value the caller wrote.
 * A spelling that rounds, such as 9007199254740993, is rejected rather than reported as a neighbour.
 */
function parseObserved(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const written = decimalKey(value);
  if (written === null) return null;
  if (written !== decimalKey(String(parsed)) && !(written === "0" && parsed === 0)) {
    throw new DistributionRejected(`distribution observed value ${value} is not exactly representable`);
  }
  return parsed;
}

/**
 * Mean that stays finite when the values are finite. The plain sum is used when it is finite. Otherwise the
 * values are divided by the largest magnitude, and the result is kept inside [min, max], where every mean lies,
 * so rounding at the number limit cannot step past it.
 */
function finiteMean(values: readonly number[]): number {
  const plain = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (Number.isFinite(plain)) return plain;
  let scale = 0;
  let smallest = Number.POSITIVE_INFINITY;
  let largest = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    scale = Math.max(scale, Math.abs(value));
    smallest = Math.min(smallest, value);
    largest = Math.max(largest, value);
  }
  const scaled = (values.reduce((sum, value) => sum + value / scale, 0) / values.length) * scale;
  return Math.min(largest, Math.max(smallest, scaled));
}

/** Population variance, rescaled when the squares overflow. Null when the variance itself is not a finite number. */
function finiteVariance(values: readonly number[], mean: number): number | null {
  const plain = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  if (Number.isFinite(plain)) return plain;
  let scale = 0;
  for (const value of values) scale = Math.max(scale, Math.abs(value - mean));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const scaled = values.reduce((sum, value) => sum + ((value - mean) / scale) ** 2, 0) / values.length;
  const variance = scaled * scale * scale;
  return Number.isFinite(variance) ? variance : null;
}

function meanSlot(
  label: DistributionMeanSlot["label"],
  status: DistributionMeanSlot["status"],
  value: number | null,
): DistributionMeanSlot {
  return {
    label,
    status,
    value: status === "observed" && value !== null && Number.isFinite(value) ? formatFinite(value) : null,
  };
}

function populationAt(
  observed: readonly number[],
  censored: number,
  probability: number,
  horizonSec: number | null,
): DistributionPopulationQuantile {
  const key = canonicalQuantileKey(probability);
  if (horizonSec === null) {
    return {
      key,
      q: probability,
      conditioning: "all-eligible-draws",
      estimator: "not-estimated",
      status: "unavailable",
      value: null,
    };
  }
  const eligible = observed.length + censored;
  if (eligible === 0 || observed.length === 0) {
    return {
      key,
      q: probability,
      conditioning: "all-eligible-draws",
      estimator: "common-horizon-order-statistic",
      status: "unavailable",
      value: null,
    };
  }
  const sorted = [...observed].sort((left, right) => left - right);
  const index = Math.floor((eligible - 1) * probability);
  if (index >= sorted.length) {
    return {
      key,
      q: probability,
      conditioning: "all-eligible-draws",
      estimator: "common-horizon-order-statistic",
      status: "outside-observed-range",
      value: null,
    };
  }
  const value = sorted[index];
  if (value === undefined) {
    return {
      key,
      q: probability,
      conditioning: "all-eligible-draws",
      estimator: "common-horizon-order-statistic",
      status: "unavailable",
      value: null,
    };
  }
  return {
    key,
    q: probability,
    conditioning: "all-eligible-draws",
    estimator: "common-horizon-order-statistic",
    status: "observed",
    value: formatFinite(value),
  };
}

/**
 * Summarise fixed samples. Empty observed values stay unavailable.
 * The population p95 uses a common horizon only. It does not copy the conditional quantile.
 */
export function analyzeDistribution(request: DistributionRequest): DistributionArtifactV1 {
  if (request.coupling?.commonRandomNumbers && request.coupling.executionStream !== true) {
    throw new DistributionRejected("common random numbers require the execution stream");
  }
  const keys = quantileKeys(request.quantiles);
  const probability = request.populationProbability ?? 0.95;
  canonicalQuantileKey(probability);
  const horizonSec = request.horizonSec === undefined ? null : request.horizonSec;
  if (horizonSec !== null && (typeof horizonSec !== "number" || !Number.isFinite(horizonSec) || horizonSec < 0)) {
    throw new DistributionRejected("distribution horizonSec must be a finite number >= 0 or null");
  }

  const ordered = [...request.samples].sort((left, right) => left.drawIndex - right.drawIndex);
  const seen = new Set<number>();
  const observed: number[] = [];
  let rightCensored = 0;
  let failed = 0;
  let unsupported = 0;
  const sources = new Set<DistributionSample["source"]>();
  for (const sample of ordered) {
    if (!Number.isInteger(sample.drawIndex) || sample.drawIndex < 0) {
      throw new DistributionRejected("distribution drawIndex must be an integer >= 0");
    }
    if (seen.has(sample.drawIndex)) throw new DistributionRejected("distribution drawIndex must be unique");
    seen.add(sample.drawIndex);
    if (typeof sample.seed !== "number" || !Number.isFinite(sample.seed)) {
      throw new DistributionRejected("distribution seed must be finite");
    }
    // Untyped input can carry any source. The artifact names only the two the contract declares.
    if (sample.source !== "model-strategy-session" && sample.source !== "monetization") {
      throw new DistributionRejected("distribution sample source must be model-strategy-session or monetization");
    }
    sources.add(sample.source);
    if (sample.status === "censored") {
      rightCensored += 1;
      continue;
    }
    if (sample.status === "failed") {
      failed += 1;
      continue;
    }
    if (sample.status === "unsupported") {
      unsupported += 1;
      continue;
    }
    // Untyped input can carry any status. Only "observed" is counted as a completion.
    if (sample.status !== "observed") {
      throw new DistributionRejected(
        "distribution sample status must be observed, censored, failed, or unsupported",
      );
    }
    const parsed = parseObserved(sample.value);
    if (parsed === null) {
      failed += 1;
      continue;
    }
    // The common-horizon estimator ranks every censored draw after every completion. A completion past the
    // horizon would make that rank unknowable.
    if (horizonSec !== null && parsed > horizonSec) {
      throw new DistributionRejected("distribution observed value exceeds the common horizonSec");
    }
    observed.push(parsed);
  }

  const eligible = observed.length + rightCensored;
  const completionRate = eligible > 0 ? observed.length / eligible : null;
  const arithmetic = observed.length > 0 ? finiteMean(observed) : null;
  const variance = arithmetic === null ? null : finiteVariance(observed, arithmetic);
  const positive = observed.every((value) => value > 0);
  const meanLog = arithmetic !== null && positive ? observed.reduce((sum, value) => sum + Math.log10(value), 0) / observed.length : null;
  const logMean = arithmetic !== null && arithmetic > 0 ? Math.log10(arithmetic) : null;
  const source: DistributionUncertaintySource = sources.size > 1 ? "mixed" : ([...sources][0] ?? "model-strategy-session");
  const population = populationAt(observed, rightCensored, probability, horizonSec);
  const conditional: DistributionQuantilePoint[] = request.quantiles.map((q, index) => {
    const value = quantileInclusiveFloor(observed, q);
    return {
      key: keys[index] ?? canonicalQuantileKey(q),
      q,
      conditioning: "completed-only" as const,
      status: value === null ? ("unavailable" as const) : ("observed" as const),
      value: value === null ? null : formatFinite(value),
    };
  });
  const status: DistributionArtifactV1["status"] =
    ordered.length > 0 && unsupported === ordered.length
      ? "unsupported"
      : observed.length === 0
        ? "unavailable"
        : "ok";

  return {
    schemaVersion: 1,
    algorithmVersion: DISTRIBUTION_ALGORITHM_VERSION,
    method: { id: QUANTILE_METHOD, version: QUANTILE_METHOD_VERSION },
    status,
    horizonSec,
    accounting: {
      draws: ordered.length,
      observed: observed.length,
      rightCensored,
      failed,
      unsupported,
      completionRate,
    },
    seeds: ordered.map((sample) => ({
      drawId: logicalDrawId(sample.drawIndex),
      drawIndex: sample.drawIndex,
      seed: sample.seed,
    })),
    uncertainty: {
      source,
      zeroVariance: variance === 0,
      variance,
    },
    population,
    conditional,
    means: {
      arithmetic: meanSlot("arithmetic-mean", arithmetic === null ? "unavailable" : "observed", arithmetic),
      meanLog10: meanSlot(
        "mean-of-log10",
        arithmetic === null ? "unavailable" : positive ? "observed" : "unsupported",
        meanLog,
      ),
      log10OfMean: meanSlot(
        "log10-of-arithmetic-mean",
        arithmetic === null ? "unavailable" : arithmetic > 0 ? "observed" : "unsupported",
        logMean,
      ),
    },
    reduction: { order: "logical-draw-index", workerCountIndependent: true },
    warnings:
      arithmetic !== null && variance === null ? [...WARNINGS, "variance exceeds the number range and is not reported"] : WARNINGS,
  };
}
