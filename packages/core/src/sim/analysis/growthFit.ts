import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import type { AnalysisStatus } from "./contracts";
import { legacyGrowthSpeedBucket } from "./growth";
import type { CompiledScenario, RunResult } from "../types";

/**
 * Growth fit v1.
 * `analyzeGrowth` stays the legacy speed-bucket report.
 * This artifact separates shape from log slope and does not prove an asymptote.
 */

const GROWTH_FIT_ALGORITHM_VERSION = "growth-fit-v1" as const;
const GROWTH_FIT_SCHEMA_ID = "https://idlekit.dev/schemas/growth.fit.v1.schema.json" as const;
const MIN_SAMPLES = 8;
const MIN_SPAN_SEC = 30;
const LOG_RMSE_OK = 1e-4;
const VALUE_REL_OK = 1e-4;
/** A value-space fit this close is exact for a line or parabola, not an approximation. */
const VALUE_EXACT = 1e-9;
const SLOPE_TOLERANCE = 1e-4;
const DROP_LOG10 = 1;

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed Slow and fast exponentials share a shape. Other formulas stay distinct, and a short trace stays unknown.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed #acbd473 Re-read the section: exp(0.001 t) and exp(0.2 t) are both exponential, and the slopes differ.
 */
export const growthShapeIndependentOfSpeed = "shape-independent-of-log-slope" as const;

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-scale-domain A rescaled huge series keeps its shape. Zero, negative, a drop, irregular time, and one point are not a speed claim.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-scale-domain #38e5c42 Re-read the section: 1e400 and a constant multiple match, and abs is not applied to a negative sample.
 */
export const growthDomainNotDisguised = "non-positive-and-discontinuity-are-not-speed" as const;

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-legacy-preserved The old report still names speed buckets. netWorthFallback stays on both results.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-legacy-preserved #1355aa0 Re-read the section: the legacy regime is still a slope bucket, and the fit does not replace it.
 */
export const growthLegacyObservationPreserved = "legacy-report-and-net-worth-fallback" as const;

export function growthFitSchemaId(): typeof GROWTH_FIT_SCHEMA_ID {
  return GROWTH_FIT_SCHEMA_ID;
}

export function growthFitAlgorithmVersion(): typeof GROWTH_FIT_ALGORITHM_VERSION {
  return GROWTH_FIT_ALGORITHM_VERSION;
}

export function growthFitSlopeTolerance(): number {
  return SLOPE_TOLERANCE;
}

export class GrowthFitRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrowthFitRejected";
  }
}

export type GrowthShape = "unknown" | "constant" | "polynomial" | "exponential" | "accelerating-log" | "saturating";

export type GrowthDomain = "positive" | "negative" | "zero" | "mixed" | "nonfinite" | "empty";

export type GrowthDiscontinuityKind = "none" | "purchase" | "reset" | "drop" | "sign";

export type GrowthLegacyBucket = "stall" | "exp" | "super-exp" | "softcap";

/**
 * Later Analyzer adapters must pass this object.
 * `windowSec` is the time window. `samplingBudget` is the only downsample cap.
 */
export type GrowthSamplingContract = Readonly<{
  samplingBudget: number;
  method: typeof GROWTH_FIT_ALGORITHM_VERSION;
  methodVersion: 1;
  windowSec: number;
  cadenceSec?: number;
}>;

export type GrowthSampleInput<N> = Readonly<{
  t: number;
  amount: N;
}>;

export type GrowthDiscontinuity = Readonly<{
  t: number;
  kind: "purchase" | "reset" | "drop" | "sign";
}>;

export type GrowthFitWindowV1 = Readonly<{
  startSec: number;
  endSec: number;
  sampleCount: number;
  domain: GrowthDomain;
  status: AnalysisStatus;
  shape: GrowthShape;
  discontinuity: GrowthDiscontinuityKind;
  speed: Readonly<{
    logSlopePerSec: number | null;
    doublingTimeSec: number | null;
  }>;
  legacySpeedBucket: GrowthLegacyBucket | null;
  residual: Readonly<{
    space: "log10" | "value" | "none";
    rmse: number | null;
  }>;
  quality: string;
}>;

export type GrowthFitArtifactV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: typeof GROWTH_FIT_ALGORITHM_VERSION;
  method: "heuristic-fit";
  status: AnalysisStatus;
  seriesRequested: "money" | "netWorth";
  valueSource: "money" | "netWorth" | "netWorthFallback";
  windowSec: number;
  samplingBudget: number;
  sampleCount: number;
  inputSampleCount: number;
  slopeTolerance: number;
  fitWindow: Readonly<{ windowSec: number; startSec: number; endSec: number }>;
  irregular: boolean;
  claimsResourceBottleneck: false;
  softcap: "configured" | "absent" | "unknown";
  cadenceSec?: number;
  cadenceCoarserThanWindow: boolean;
  downsampled?: Readonly<{ seen: number; kept: number }>;
  retention?: Readonly<{ totalSeen: number; retained: number; dropped: number }>;
  assumptions: readonly string[];
  warnings: readonly string[];
  windows: readonly GrowthFitWindowV1[];
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let growthFitValidator: ((input: unknown) => IValidation<GrowthFitArtifactV1>) | undefined;

function buildGrowthFitJsonSchema() {
  return typia.json.schema<GrowthFitArtifactV1, "3.1">();
}

let growthFitJsonSchemaUnit: ReturnType<typeof buildGrowthFitJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed The generated validator accepts this artifact and rejects a missing status.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed #acbd473 Re-read the section: the wire object is growth fit v1.
 */
export const validateGrowthFitArtifact = (input: unknown): IValidation<GrowthFitArtifactV1> =>
  (growthFitValidator ??= typia.createValidate<GrowthFitArtifactV1>())(input);

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed #acbd473 Re-read the section: schema version is 3.1.
 */
export function growthFitJsonSchema(): ReturnType<typeof buildGrowthFitJsonSchema> {
  growthFitJsonSchemaUnit ??= buildGrowthFitJsonSchema();
  return growthFitJsonSchemaUnit;
}

type Point<N> = Readonly<{
  t: number;
  sign: "positive" | "negative" | "zero" | "nonfinite";
  log10: number | null;
  numeric: number | null;
}>;

type LinearFit = Readonly<{ a: number; b: number; rmse: number }>;
type QuadFit = Readonly<{ a: number; b: number; c: number; rmse: number }>;

type Slice = Readonly<{
  points: readonly Point<unknown>[];
  discontinuity: GrowthDiscontinuityKind;
}>;

const ASSUMPTIONS = [
  "log slope is the least-squares slope of absLog10 per second",
  "shape and speed are separate fields",
  "a candidate fit does not prove an asymptotic regime",
  "negative and zero samples are not passed through abs",
] as const;

function assertSampling(sampling: GrowthSamplingContract): void {
  if (sampling.method !== GROWTH_FIT_ALGORITHM_VERSION || sampling.methodVersion !== 1) {
    throw new GrowthFitRejected("growth fit requires method growth-fit-v1 version 1");
  }
  if (!Number.isInteger(sampling.samplingBudget) || sampling.samplingBudget < 1) {
    throw new GrowthFitRejected("samplingBudget must be a positive integer");
  }
  if (typeof sampling.windowSec !== "number" || !Number.isFinite(sampling.windowSec) || !(sampling.windowSec > 0)) {
    throw new GrowthFitRejected("windowSec must be a finite number > 0");
  }
  if (
    sampling.cadenceSec !== undefined &&
    (typeof sampling.cadenceSec !== "number" || !Number.isFinite(sampling.cadenceSec) || !(sampling.cadenceSec > 0))
  ) {
    throw new GrowthFitRejected("cadenceSec must be a finite number > 0");
  }
}

function readPoint<N>(E: Engine<N>, sample: GrowthSampleInput<N>): Point<N> {
  if (typeof sample.t !== "number" || !Number.isFinite(sample.t)) {
    throw new GrowthFitRejected("sample time must be a finite number");
  }
  if (!E.isFinite(sample.amount)) {
    return { t: sample.t, sign: "nonfinite", log10: null, numeric: null };
  }
  const cmp = E.cmp(sample.amount, E.zero());
  if (cmp === 0) return { t: sample.t, sign: "zero", log10: null, numeric: 0 };
  if (cmp < 0) return { t: sample.t, sign: "negative", log10: null, numeric: null };
  const log10 = E.absLog10(sample.amount);
  if (!Number.isFinite(log10)) return { t: sample.t, sign: "nonfinite", log10: null, numeric: null };
  let numeric: number | null = null;
  if (log10 <= 300 && log10 >= -300) {
    const narrowed = E.toNumber(sample.amount);
    if (Number.isFinite(narrowed) && narrowed > 0) numeric = narrowed;
  }
  return { t: sample.t, sign: "positive", log10, numeric };
}

function preparePoints<N>(E: Engine<N>, samples: readonly GrowthSampleInput<N>[]): Point<N>[] {
  const read = samples.map((sample) => readPoint(E, sample)).sort((left, right) => left.t - right.t);
  const unique: Point<N>[] = [];
  for (const point of read) {
    const previous = unique[unique.length - 1];
    if (previous && previous.t === point.t) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  return unique;
}

function evenKeep<T>(items: readonly T[], budget: number): T[] {
  if (items.length <= budget) return [...items];
  // A one-point budget keeps the first observation instead of dividing by budget - 1.
  if (budget <= 1) return items.slice(0, Math.max(0, budget));
  const last = items.length - 1;
  const kept: T[] = [];
  for (let index = 0; index < budget; index += 1) {
    const at = Math.round((index * last) / (budget - 1));
    const item = items[at];
    if (item !== undefined && kept[kept.length - 1] !== item) kept.push(item);
  }
  return kept;
}

function domainOf(points: readonly Point<unknown>[]): GrowthDomain {
  if (points.length === 0) return "empty";
  if (points.some((point) => point.sign === "nonfinite")) return "nonfinite";
  const signs = new Set(points.map((point) => point.sign));
  if (signs.size === 1 && signs.has("positive")) return "positive";
  if (signs.size === 1 && signs.has("negative")) return "negative";
  if (signs.size === 1 && signs.has("zero")) return "zero";
  return "mixed";
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function rmseAround(predicted: readonly number[], actual: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const error = actual[index]! - predicted[index]!;
    sum += error * error;
  }
  return Math.sqrt(sum / actual.length);
}

function solve(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row;
    }
    const swapped = rows[col]!;
    rows[col] = rows[pivot]!;
    rows[pivot] = swapped;
    const diagonal = rows[col]![col]!;
    if (Math.abs(diagonal) < 1e-18) return null;
    for (let column = col; column <= size; column += 1) rows[col]![column] = rows[col]![column]! / diagonal;
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = rows[row]![col]!;
      for (let column = col; column <= size; column += 1) {
        rows[row]![column] = rows[row]![column]! - factor * rows[col]![column]!;
      }
    }
  }
  return rows.map((row) => row[size]!);
}

/**
 * Largest |x|, so a fit runs on x / scale. Rebased times can still be wide enough that x * x overflows;
 * on the scaled axis the moments stay finite, and the coefficients are mapped back.
 */
function axisScale(xs: readonly number[]): number {
  let scale = 0;
  for (const x of xs) scale = Math.max(scale, Math.abs(x));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function fitLinear(xs: readonly number[], ys: readonly number[]): LinearFit | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const scale = axisScale(xs);
  const fit = fitLinearScaled(xs.map((x) => x / scale), ys);
  if (!fit) return null;
  const b = fit.b / scale;
  if (!Number.isFinite(fit.a) || !Number.isFinite(b) || !Number.isFinite(fit.rmse)) return null;
  return { a: fit.a, b, rmse: fit.rmse };
}

function fitLinearScaled(xs: readonly number[], ys: readonly number[]): LinearFit | null {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let index = 0; index < n; index += 1) {
    const x = xs[index]!;
    const y = ys[index]!;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const b = Math.abs(denom) < 1e-18 ? 0 : (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  const predicted = xs.map((x) => a + b * x);
  return { a, b, rmse: rmseAround(predicted, ys) };
}

function fitQuadratic(xs: readonly number[], ys: readonly number[]): QuadFit | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const scale = axisScale(xs);
  const fit = fitQuadraticScaled(xs.map((x) => x / scale), ys);
  if (!fit) return null;
  const b = fit.b / scale;
  const c = fit.c / scale / scale;
  if (!Number.isFinite(fit.a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(fit.rmse)) return null;
  return { a: fit.a, b, c, rmse: fit.rmse };
}

function fitQuadraticScaled(xs: readonly number[], ys: readonly number[]): QuadFit | null {
  let sx = 0;
  let sx2 = 0;
  let sx3 = 0;
  let sx4 = 0;
  let sy = 0;
  let sxy = 0;
  let sx2y = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index]!;
    const y = ys[index]!;
    const x2 = x * x;
    sx += x;
    sx2 += x2;
    sx3 += x2 * x;
    sx4 += x2 * x2;
    sy += y;
    sxy += x * y;
    sx2y += x2 * y;
  }
  const solved = solve(
    [
      [xs.length, sx, sx2],
      [sx, sx2, sx3],
      [sx2, sx3, sx4],
    ],
    [sy, sxy, sx2y],
  );
  if (!solved) return null;
  const a = solved[0]!;
  const b = solved[1]!;
  const c = solved[2]!;
  const predicted = xs.map((x) => a + b * x + c * x * x);
  return { a, b, c, rmse: rmseAround(predicted, ys) };
}

/**
 * |mean| of the series, computed on halves so a series near the number range does not overflow the sum.
 * It is not floored at 1, so a sub-unit series keeps a relative residual and a unit change does not change shape.
 */
function seriesScale(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value / 2;
  const scale = Math.abs((sum / values.length) * 2);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Saturation: the growth rate per second decays geometrically. Rates are normalized by each gap, so an
 * evenly downsampled trace with gaps of 11 and 12 is read the same as the full-resolution trace.
 */
function saturating(ts: readonly number[], values: readonly number[]): boolean {
  if (values.length < MIN_SAMPLES) return false;
  const mids: number[] = [];
  const logRates: number[] = [];
  let gapSum = 0;
  for (let index = 1; index < values.length; index += 1) {
    const gap = ts[index]! - ts[index - 1]!;
    const step = values[index]! - values[index - 1]!;
    if (!(gap > 0) || !(step > 0)) return false;
    gapSum += gap;
    mids.push((ts[index]! + ts[index - 1]!) / 2);
    logRates.push(Math.log(step / gap));
  }
  if (logRates.length < 4) return false;
  const fit = fitLinear(mids, logRates);
  if (!fit || !(fit.b < 0) || fit.rmse > 0.1) return false;
  const perGap = Math.exp(fit.b * (gapSum / logRates.length));
  if (!(perGap > 0.05 && perGap < 0.95)) return false;
  return Math.exp(logRates[logRates.length - 1]! - logRates[0]!) < 0.25;
}

function irregularSpacing(points: readonly Point<unknown>[]): boolean {
  const gaps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    gaps.push(points[index]!.t - points[index - 1]!.t);
  }
  if (gaps.length < 2) return false;
  const positive = gaps.filter((gap) => gap > 0);
  if (positive.length < 2) return false;
  const smallest = Math.min(...positive);
  const largest = Math.max(...positive);
  return largest / smallest > 3;
}

function blankWindow(
  points: readonly Point<unknown>[],
  discontinuity: GrowthDiscontinuityKind,
  status: AnalysisStatus,
  quality: string,
): GrowthFitWindowV1 {
  const first = points[0];
  const last = points[points.length - 1];
  return {
    startSec: first?.t ?? 0,
    endSec: last?.t ?? 0,
    sampleCount: points.length,
    domain: domainOf(points),
    status,
    shape: "unknown",
    discontinuity,
    speed: { logSlopePerSec: null, doublingTimeSec: null },
    legacySpeedBucket: null,
    residual: { space: "none", rmse: null },
    quality,
  };
}

function classifyPositive(
  points: readonly Point<unknown>[],
  discontinuity: GrowthDiscontinuityKind,
): GrowthFitWindowV1 {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const span = last.t - first.t;
  const logs = points.map((point) => point.log10);
  if (points.length < MIN_SAMPLES || span < MIN_SPAN_SEC || logs.some((value) => value === null)) {
    return blankWindow(points, discontinuity, "insufficient-data", `samples ${points.length} span ${span}`);
  }
  const ys = logs.map((value) => value!);
  // Fit on time since the window start. Raw moments of a large absolute t cancel catastrophically.
  const ts = points.map((point) => point.t - first.t);
  const logSpan = Math.max(...ys) - Math.min(...ys);
  const linear = fitLinear(ts, ys);
  const quadratic = fitQuadratic(ts, ys);
  // ts is already measured from the window start.
  const powerX = ts.map((t) => Math.log10(t + 1));
  const power = fitLinear(powerX, ys);
  const numbers = points.map((point) => point.numeric);
  const valueReady = numbers.every((value): value is number => value !== null);
  // Value-space fits run in units of the series scale, so a large series cannot overflow the squared error.
  const valueScale = valueReady ? seriesScale(numbers) : 1;
  const scaled = valueReady ? numbers.map((value) => value / valueScale) : [];
  const valueLinear = valueReady ? fitLinear(ts, scaled) : null;
  const valueQuadratic = valueReady ? fitQuadratic(ts, scaled) : null;
  const valueLinearRel = valueLinear ? valueLinear.rmse : null;
  const valueQuadraticRel = valueQuadratic ? valueQuadratic.rmse : null;
  const valueRmse =
    valueLinearRel === null
      ? null
      : valueQuadraticRel === null
        ? valueLinearRel
        : Math.min(valueLinearRel, valueQuadraticRel);
  const numericValues = valueReady ? numbers.map((value) => value ?? 0) : [];
  const expOk = linear !== null && linear.rmse <= LOG_RMSE_OK;
  const accelOk =
    quadratic !== null &&
    linear !== null &&
    quadratic.c > 1e-6 &&
    quadratic.rmse <= LOG_RMSE_OK &&
    linear.rmse > 1e-3 &&
    linear.rmse > quadratic.rmse * 4;
  const powerOk =
    power !== null && linear !== null && power.rmse <= 1e-3 && power.rmse * 4 < linear.rmse;
  const valuePolyOk = valueRmse !== null && valueRmse <= VALUE_REL_OK;
  const satOk = valueReady && saturating(ts, numericValues);
  let shape: GrowthShape = "unknown";
  let residual: GrowthFitWindowV1["residual"] = {
    space: "log10",
    rmse: linear?.rmse ?? null,
  };
  // An exact value-space line or parabola is polynomial whatever its intercept. A large intercept can make
  // the same series look nearly straight in log space.
  // An exact log fit keeps precedence: a value fit wins only when it is closer than the log fit's
  // relative error (log10 residual times ln 10), so a slow exponential is not read as a parabola.
  const valueExact =
    valueRmse !== null &&
    valueRmse <= VALUE_EXACT &&
    !(linear !== null && linear.rmse * Math.LN10 < valueRmse);
  if (logSpan < 1e-6) {
    shape = "constant";
    residual = { space: "log10", rmse: rmseAround(ys.map(() => mean(ys)), ys) };
  } else if (valueExact) {
    shape = "polynomial";
    residual = { space: "value", rmse: valueRmse };
  } else if (expOk && !accelOk) {
    shape = "exponential";
    residual = { space: "log10", rmse: linear.rmse };
  } else if (accelOk && quadratic) {
    shape = "accelerating-log";
    residual = { space: "log10", rmse: quadratic.rmse };
  } else if (powerOk && power) {
    shape = "polynomial";
    residual = { space: "log10", rmse: power.rmse };
  } else if (satOk) {
    shape = "saturating";
    residual = { space: "value", rmse: valueRmse };
  } else if (valuePolyOk) {
    shape = "polynomial";
    residual = { space: "value", rmse: valueRmse };
  }
  const slope = linear && Number.isFinite(linear.b) ? linear.b : null;
  const status: AnalysisStatus = shape === "unknown" ? "unknown" : "ok";
  const legacy = status === "ok" && slope !== null ? legacyGrowthSpeedBucket(slope) : null;
  return {
    startSec: first.t,
    endSec: last.t,
    sampleCount: points.length,
    domain: "positive",
    status,
    shape,
    discontinuity,
    speed: {
      logSlopePerSec: slope,
      doublingTimeSec: slope !== null && slope > 1e-12 ? Math.log10(2) / slope : null,
    },
    legacySpeedBucket: legacy,
    residual,
    quality: `shape=${shape}; logSpan=${logSpan}; exp=${linear?.rmse ?? "none"}; quad=${quadratic?.rmse ?? "none"}; quadC=${quadratic?.c ?? "none"}; power=${power?.rmse ?? "none"}; value=${valueRmse ?? "none"}; sat=${satOk}`,
  };
}

function classifySlice(slice: Slice): GrowthFitWindowV1 {
  const domain = domainOf(slice.points);
  if (domain !== "positive") {
    const status: AnalysisStatus = domain === "empty" ? "insufficient-data" : "invalid";
    return blankWindow(slice.points, slice.discontinuity, status, `domain ${domain}`);
  }
  return classifyPositive(slice.points, slice.discontinuity);
}

function pushBreak(breaks: GrowthDiscontinuity[], next: GrowthDiscontinuity): void {
  const rank: Record<GrowthDiscontinuity["kind"], number> = { reset: 4, drop: 3, sign: 2, purchase: 1 };
  const existing = breaks.find((item) => item.t === next.t);
  if (!existing) {
    breaks.push(next);
    return;
  }
  if (rank[next.kind] > rank[existing.kind]) {
    breaks.splice(breaks.indexOf(existing), 1, next);
  }
}

/**
 * Index of the first time-ordered item at or after `t` (strictly after when `strict`), or -1.
 * Binary search keeps break and action lookups at O(log n) per item.
 */
function firstIndexAtOrAfter(items: readonly { readonly t: number }[], t: number, strict: boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const at = items[mid]!.t;
    if (strict ? at > t : at >= t) high = mid;
    else low = mid + 1;
  }
  return low < items.length ? low : -1;
}

function slicesOf(points: readonly Point<unknown>[], breaks: readonly GrowthDiscontinuity[], windowSec: number): Slice[] {
  const opening = points.map(() => "none" as GrowthDiscontinuityKind);
  for (const item of breaks) {
    const index = firstIndexAtOrAfter(points, item.t, false);
    if (index > 0) opening[index] = item.kind;
  }
  const coarse: Array<{ start: number; end: number; discontinuity: GrowthDiscontinuityKind }> = [];
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (opening[index] === "none") continue;
    coarse.push({ start, end: index, discontinuity: opening[start] ?? "none" });
    start = index;
  }
  coarse.push({ start, end: points.length, discontinuity: opening[start] ?? "none" });
  const slices: Slice[] = [];
  for (const segment of coarse) {
    let cursor = segment.start;
    let first = true;
    while (cursor < segment.end) {
      const endTime = points[cursor]!.t + windowSec;
      let next = cursor + 1;
      while (next < segment.end && points[next]!.t <= endTime + 1e-9) next += 1;
      if (next === cursor) next = cursor + 1;
      slices.push({
        points: points.slice(cursor, next),
        discontinuity: first ? segment.discontinuity : "none",
      });
      first = false;
      cursor = next;
    }
  }
  return slices;
}

function rollup(windows: readonly GrowthFitWindowV1[]): AnalysisStatus {
  if (windows.length === 0) return "insufficient-data";
  const statuses = new Set(windows.map((window) => window.status));
  if (statuses.size === 1) return windows[0]!.status;
  if (windows.some((window) => window.status === "ok")) return "ok";
  return "unknown";
}

function baseArtifact(args: {
  seriesRequested: "money" | "netWorth";
  valueSource: GrowthFitArtifactV1["valueSource"];
  sampling: GrowthSamplingContract;
  inputSampleCount: number;
  sampleCount: number;
  points: readonly Point<unknown>[];
  softcap: GrowthFitArtifactV1["softcap"];
  retention?: GrowthFitArtifactV1["retention"];
  downsampled?: GrowthFitArtifactV1["downsampled"];
  irregular: boolean;
  warnings: string[];
  windows: readonly GrowthFitWindowV1[];
}): GrowthFitArtifactV1 {
  const first = args.points[0];
  const last = args.points[args.points.length - 1];
  return {
    schemaVersion: 1,
    algorithmVersion: GROWTH_FIT_ALGORITHM_VERSION,
    method: "heuristic-fit",
    status: rollup(args.windows),
    seriesRequested: args.seriesRequested,
    valueSource: args.valueSource,
    windowSec: args.sampling.windowSec,
    samplingBudget: args.sampling.samplingBudget,
    sampleCount: args.sampleCount,
    inputSampleCount: args.inputSampleCount,
    slopeTolerance: SLOPE_TOLERANCE,
    fitWindow: {
      windowSec: args.sampling.windowSec,
      startSec: first?.t ?? 0,
      endSec: last?.t ?? 0,
    },
    irregular: args.irregular,
    claimsResourceBottleneck: false,
    softcap: args.softcap,
    ...(args.sampling.cadenceSec !== undefined ? { cadenceSec: args.sampling.cadenceSec } : {}),
    cadenceCoarserThanWindow:
      args.sampling.cadenceSec !== undefined && args.sampling.cadenceSec >= args.sampling.windowSec,
    ...(args.downsampled ? { downsampled: args.downsampled } : {}),
    ...(args.retention ? { retention: args.retention } : {}),
    assumptions: ASSUMPTIONS,
    warnings: args.warnings,
    windows: args.windows,
  };
}

/**
 * Fit one observed series.
 * Amounts stay in the Engine until a finite log10, or a safe number, is required.
 */
export function fitGrowth<N>(args: {
  E: Engine<N>;
  samples: readonly GrowthSampleInput<N>[];
  seriesRequested: "money" | "netWorth";
  valueSource: GrowthFitArtifactV1["valueSource"];
  sampling: GrowthSamplingContract;
  discontinuities?: readonly GrowthDiscontinuity[];
  softcap?: GrowthFitArtifactV1["softcap"];
  retention?: GrowthFitArtifactV1["retention"];
  /** "incomplete" when purchases may have happened that `discontinuities` does not list. */
  actionHistory?: "complete" | "incomplete";
}): GrowthFitArtifactV1 {
  assertSampling(args.sampling);
  const prepared = preparePoints(args.E, args.samples);
  // Find sign changes and drops on every prepared point, then keep both sides of each break through the
  // sampling budget, so downsampling cannot hide an invalid domain or a discontinuity.
  const breaks = [...(args.discontinuities ?? [])];
  const boundary = new Set<number>();
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1]!;
    const current = prepared[index]!;
    let found = false;
    if (previous.sign !== current.sign) {
      pushBreak(breaks, { t: current.t, kind: "sign" });
      found = true;
    }
    if (
      previous.sign === "positive" &&
      current.sign === "positive" &&
      previous.log10 !== null &&
      current.log10 !== null &&
      // An exact tenfold drop is a drop. The tolerance absorbs log10 rounding.
      previous.log10 - current.log10 >= DROP_LOG10 - 1e-9
    ) {
      pushBreak(breaks, { t: current.t, kind: "drop" });
      found = true;
    }
    if (found) {
      boundary.add(index - 1);
      boundary.add(index);
    }
  }
  for (const item of breaks) {
    const index = firstIndexAtOrAfter(prepared, item.t, false);
    if (index >= 0) {
      boundary.add(index);
      if (index > 0) boundary.add(index - 1);
    }
  }
  const evenly = evenKeep(prepared, args.sampling.samplingBudget);
  const keptSet = new Set<Point<N>>(evenly);
  for (const index of boundary) keptSet.add(prepared[index]!);
  const kept = prepared.filter((point) => keptSet.has(point));
  const downsampled =
    kept.length === prepared.length ? undefined : { seen: prepared.length, kept: kept.length };
  const warnings = [
    "A candidate fit is not a proof of the asymptotic regime.",
    "legacySpeedBucket is the old slope threshold. It is not the shape and it is not a cause.",
  ];
  if (args.softcap === "configured") {
    warnings.push("A configured softcap is recorded separately. It does not choose the shape.");
  }
  if (downsampled) {
    warnings.push("Samples were evenly reduced to the sampling budget. windowSec is still the time window.");
  }
  if (args.retention && args.retention.dropped > 0) {
    warnings.push("The fit sees the retained trace only.");
  }
  // Irregular spacing is a property of the input cadence; the sampling budget must not hide it.
  const irregular = irregularSpacing(prepared);
  if (irregular) warnings.push("Sample spacing is irregular. Observed times are not rewritten onto a grid.");
  const cadenceCoarse =
    args.sampling.cadenceSec !== undefined && args.sampling.cadenceSec >= args.sampling.windowSec;
  if (cadenceCoarse) {
    warnings.push("Cadence is coarser than windowSec, so the window is not identified.");
    return baseArtifact({
      seriesRequested: args.seriesRequested,
      valueSource: args.valueSource,
      sampling: args.sampling,
      inputSampleCount: prepared.length,
      sampleCount: kept.length,
      points: kept,
      softcap: args.softcap ?? "unknown",
      retention: args.retention,
      downsampled,
      irregular,
      warnings,
      // Coarse cadence hides the window, not the observed domain. Non-positive or nonfinite values stay invalid.
      windows: [
        blankWindow(
          kept,
          "none",
          domainOf(kept) === "positive" || domainOf(kept) === "empty" ? "insufficient-data" : "invalid",
          "cadence coarser than window",
        ),
      ],
    });
  }
  const fitted =
    kept.length === 0
      ? [blankWindow(kept, "none", "insufficient-data", "no retained samples")]
      : slicesOf(kept, breaks, args.sampling.windowSec).map((slice) => classifySlice(slice));
  if (kept.length > args.sampling.samplingBudget) {
    warnings.push("Break boundary points were kept beyond the sampling budget.");
  }
  const incomplete = args.actionHistory === "incomplete";
  if (incomplete) {
    warnings.push("The action history is incomplete, so a purchase break can be missing. Shape claims are withheld.");
  }
  const windows = incomplete
    ? fitted.map((window): GrowthFitWindowV1 =>
        window.status === "ok"
          ? {
              ...window,
              status: "insufficient-data",
              shape: "unknown",
              legacySpeedBucket: null,
              quality: `${window.quality}; action history incomplete`,
            }
          : window,
      )
    : fitted;
  return baseArtifact({
    seriesRequested: args.seriesRequested,
    valueSource: args.valueSource,
    sampling: args.sampling,
    inputSampleCount: prepared.length,
    sampleCount: kept.length,
    points: kept,
    softcap: args.softcap ?? "unknown",
    retention: args.retention,
    downsampled,
    irregular,
    warnings,
    windows,
  });
}

function softcapOf<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars> | undefined,
  explicit: GrowthFitArtifactV1["softcap"] | undefined,
): GrowthFitArtifactV1["softcap"] {
  if (explicit) return explicit;
  if (!scenario?.model.analytic) return scenario ? "absent" : "unknown";
  const hint = scenario.model.analytic(scenario.ctx, scenario.initial);
  return hint?.softcap ? "configured" : "absent";
}

/**
 * Read a run without converting the whole amount to Number first.
 * `netWorthFallback` matches `analyzeGrowth` when the model has no net worth.
 */
export function fitGrowthFromRun<N, U extends string, Vars>(args: {
  run: RunResult<N, U, Vars>;
  series: "money" | "netWorth";
  scenario: CompiledScenario<N, U, Vars>;
  sampling: GrowthSamplingContract;
  softcap?: GrowthFitArtifactV1["softcap"];
}): GrowthFitArtifactV1 {
  if (args.series === "netWorth" && !args.scenario) {
    throw new Error("analyzeGrowth requires compiled scenario when series='netWorth'");
  }
  const hasNetWorth = args.scenario.model.netWorth !== undefined;
  const valueSource = args.series === "money" ? "money" : hasNetWorth ? "netWorth" : "netWorthFallback";
  // A present but empty trace was emptied by retention. It is not replaced by start and end.
  const states = args.run.trace !== undefined ? args.run.trace : [args.run.start, args.run.end];
  const samples = states.map((state) => ({
    t: state.t,
    amount:
      valueSource === "netWorth"
        ? args.scenario.model.netWorth!(args.scenario.ctx, state).amount
        : state.wallet.money.amount,
  }));
  const discontinuities: GrowthDiscontinuity[] = [];
  for (const row of args.run.actionsLog ?? []) {
    const id = row.actionId.toLowerCase();
    // An action row is stamped at decision time; the trace point at that t is the state before it.
    // The break opens at the first trace state strictly after the action, found by binary search.
    const after = states[firstIndexAtOrAfter(states, row.t, true)];
    if (!after) continue;
    discontinuities.push({
      t: after.t,
      kind: id.includes("prestige") || id.includes("reset") ? "reset" : "purchase",
    });
  }
  const loggedEveryAction =
    args.run.actionsLog !== undefined && (args.run.actionsLogMeta?.dropped ?? 0) === 0;
  const noActionApplied = args.run.stats?.actions.applied === 0;
  let previousCount = states[0]?.prestige.count;
  for (const state of states.slice(1)) {
    if (previousCount !== undefined && state.prestige.count !== previousCount) {
      discontinuities.push({ t: state.t, kind: "reset" });
    }
    previousCount = state.prestige.count;
  }
  return fitGrowth({
    E: args.scenario.ctx.E,
    samples,
    seriesRequested: args.series,
    valueSource,
    sampling: args.sampling,
    discontinuities,
    actionHistory: loggedEveryAction || noActionApplied ? "complete" : "incomplete",
    softcap: softcapOf(args.scenario, args.softcap),
    retention: args.run.traceLog
      ? {
          totalSeen: args.run.traceLog.totalSeen,
          retained: args.run.traceLog.retained,
          dropped: args.run.traceLog.dropped,
        }
      : undefined,
  });
}
