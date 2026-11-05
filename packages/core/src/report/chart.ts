/**
 * Chart data contract and helpers shared by the SVG renderer and the JSON export.
 *
 * The data is plain JSON: numbers for coordinates, decimal strings for engine amounts.
 * Nothing here reads a clock, a random source, or the locale, so the same input gives the same bytes.
 */

export const CHART_DATA_CONTRACT = "idlekit.chart-data.v1" as const;
export const CHART_DATA_SCHEMA_REF = "docs/schemas/chart-data.v1.schema.json" as const;
/** Default number of points kept per series after downsampling. */
export const DEFAULT_CHART_MAX_POINTS = 512;
/** Upper bound accepted for `maxPoints`. A chart does not need more and the SVG stays small. */
export const MAX_CHART_MAX_POINTS = 10_000;
/** Lower bound accepted for `maxPoints`. LTTB keeps the first and the last point. */
export const MIN_CHART_MAX_POINTS = 3;

export type ChartPoint = Readonly<{
  /** Seconds since the start of the plotted run. */
  t: number;
  /** Plotted coordinate. `null` marks a value that cannot be plotted (zero on a log axis, non-finite). */
  y: number | null;
  /** Exact engine value as text, when the series plots an amount. */
  value?: string;
}>;

export type ChartSeriesId = "money" | "netWorth" | "growthRate";

export type ChartSeries = Readonly<{
  id: ChartSeriesId | string;
  label: string;
  /** `log10` means `y` is log10 of the absolute amount. `linear` means `y` is the value. */
  yScale: "log10" | "linear";
  unit: string;
  points: readonly ChartPoint[];
}>;

export type ChartMilestone = Readonly<{
  key: string;
  /** Seconds since the start of the plotted run. */
  t: number;
  source: string;
}>;

export type ChartSampling = Readonly<{
  method: "lttb" | "none";
  maxPoints: number;
  /** Points offered to the downsampler, per series. */
  sourcePoints: number;
  /** Points kept, per series. */
  retainedPoints: number;
  /** Runner trace interval in steps. `null` when the trace came from another source. */
  traceEverySteps: number | null;
}>;

export type ProgressionChartData = Readonly<{
  xUnit: "sec";
  /** The series whose slope is the growth-rate series. */
  primarySeries: "money" | "netWorth";
  series: readonly ChartSeries[];
  milestones: readonly ChartMilestone[];
  /** Milestones left out of the chart because the milestone sample was capped. */
  droppedMilestones: number;
  sampling: ChartSampling;
}>;

export type CompareKpiRow = Readonly<{
  metric: string;
  a: string | null;
  b: string | null;
  preference: "higher" | "lower" | "n/a";
  better: "a" | "b" | "tie" | "undetermined";
  /** (B - A) / |A| in percent. `null` when either side is missing, non-finite, or A is zero. */
  relativeChangePct: number | null;
  /** log10(B) - log10(A) for amounts too large for a ratio. `null` when unavailable. */
  log10Delta: number | null;
}>;

export type CompareChartData = Readonly<{
  labels: Readonly<{ a: string; b: string }>;
  kpis: readonly CompareKpiRow[];
  /** Net-worth (or money) progression of the A and B economy runs, when traced. */
  progression?: Readonly<{ a: ProgressionChartData; b: ProgressionChartData }>;
}>;

export type SensitivityCell = Readonly<{
  dimensionId: string;
  candidateId: string;
  metricId: string;
  status: "observed" | "unavailable";
  /** Elasticity as plotted. `null` when unavailable or outside the double range. */
  elasticity: number | null;
  /** Exact elasticity text from the experiment artifact. */
  elasticityText: string | null;
  direction: "higher" | "lower" | "flat" | "unavailable";
}>;

export type SensitivityChartData = Readonly<{
  method: "one-at-a-time-local";
  globalSensitivity: false;
  sobol: false;
  rows: readonly Readonly<{ dimensionId: string; candidateId: string }>[];
  columns: readonly string[];
  cells: readonly SensitivityCell[];
}>;

export type ChartSource = Readonly<{
  command: string;
  scenario?: string | readonly string[];
  seed?: number;
  runId?: string;
}>;

export type ChartDataV1 = Readonly<{
  contract: typeof CHART_DATA_CONTRACT;
  schemaVersion: 1;
  kind: "progression" | "compare" | "sensitivity";
  title: string;
  source: ChartSource;
  progression?: ProgressionChartData;
  compare?: CompareChartData;
  sensitivity?: SensitivityChartData;
}>;

/** Check a requested point budget. Throws a RangeError outside [MIN_CHART_MAX_POINTS, MAX_CHART_MAX_POINTS]. */
export function resolveChartMaxPoints(requested: number | undefined): number {
  const value = requested ?? DEFAULT_CHART_MAX_POINTS;
  if (!Number.isInteger(value) || value < MIN_CHART_MAX_POINTS || value > MAX_CHART_MAX_POINTS) {
    throw new RangeError(
      `chart max points must be an integer in [${MIN_CHART_MAX_POINTS}, ${MAX_CHART_MAX_POINTS}]`,
    );
  }
  return value;
}

/**
 * Runner trace interval that keeps about `oversample * maxPoints` states for a run of `totalSteps`.
 * The downsampler then picks `maxPoints` of them, so memory stays bounded for long runs.
 */
export function chartTraceEverySteps(args: Readonly<{ totalSteps: number | undefined; maxPoints: number; oversample?: number }>): number {
  const budget = args.maxPoints * Math.max(1, Math.floor(args.oversample ?? 4));
  if (args.totalSteps === undefined || !Number.isFinite(args.totalSteps) || args.totalSteps <= budget) return 1;
  return Math.max(1, Math.ceil(args.totalSteps / budget));
}

/**
 * log10 of the absolute value of a decimal string, without going through a double for the exponent.
 * Returns `null` for zero, empty, or non-decimal text such as `unreachable`.
 */
export function decimalLog10(text: string): number | null {
  const match = /^\s*[+-]?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?\s*$/i.exec(text);
  if (!match) return null;
  const mantissa = Number(match[1]);
  if (!Number.isFinite(mantissa) || mantissa === 0) return null;
  const exponent = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(exponent)) return null;
  const result = Math.log10(mantissa) + exponent;
  return Number.isFinite(result) ? result : null;
}

function finiteY(point: ChartPoint): point is ChartPoint & { y: number } {
  return point.y !== null && Number.isFinite(point.y);
}

/**
 * Largest-Triangle-Three-Buckets downsampling. Deterministic: ties keep the earlier point.
 * Points whose `y` is null stay out of the triangle areas but count as candidates with area 0,
 * so a gap is kept only when a bucket holds nothing else.
 */
export function downsampleLttb(points: readonly ChartPoint[], maxPoints: number): ChartPoint[] {
  if (maxPoints < MIN_CHART_MAX_POINTS) throw new RangeError("downsampleLttb needs maxPoints >= 3");
  if (points.length <= maxPoints) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const out: ChartPoint[] = [first];
  const bucketSize = (points.length - 2) / (maxPoints - 2);
  let anchor = first;
  for (let bucket = 0; bucket < maxPoints - 2; bucket += 1) {
    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.min(points.length - 1, Math.floor((bucket + 1) * bucketSize) + 1);
    const nextStart = end;
    const nextEnd = Math.min(points.length, Math.floor((bucket + 2) * bucketSize) + 1);
    let avgT = 0;
    let avgY = 0;
    let count = 0;
    for (let i = nextStart; i < nextEnd; i += 1) {
      const p = points[i]!;
      if (!finiteY(p)) continue;
      avgT += p.t;
      avgY += p.y;
      count += 1;
    }
    if (count === 0) {
      avgT = last.t;
      avgY = finiteY(last) ? last.y : 0;
    } else {
      avgT /= count;
      avgY /= count;
    }
    let best: ChartPoint | undefined;
    let bestArea = -1;
    const anchorY = finiteY(anchor) ? anchor.y : avgY;
    for (let i = start; i < end; i += 1) {
      const p = points[i]!;
      const area = finiteY(p)
        ? Math.abs((anchor.t - avgT) * (p.y - anchorY) - (anchor.t - p.t) * (avgY - anchorY))
        : 0;
      if (area > bestArea) {
        bestArea = area;
        best = p;
      }
    }
    if (best) {
      out.push(best);
      anchor = best;
    }
  }
  out.push(last);
  return out;
}

/**
 * Growth-rate series: average log10 change per second between consecutive retained points.
 * Each value is plotted at the later point. A prestige reset shows as a negative rate.
 */
export function growthRateSeries(points: readonly ChartPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = b.t - a.t;
    if (!finiteY(a) || !finiteY(b) || !(dt > 0)) {
      out.push({ t: b.t, y: null });
      continue;
    }
    const rate = (b.y - a.y) / dt;
    out.push({ t: b.t, y: Number.isFinite(rate) ? rate : null });
  }
  return out;
}

/** Collapse duplicate timestamps (keep the latest state at each t) and sort by t. */
function normalizeTimes(points: readonly ChartPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && point.t === prev.t) out[out.length - 1] = point;
    else if (!prev || point.t > prev.t) out.push(point);
  }
  return out;
}

/** A state sample read by the caller. Amounts are already turned into text and log10. */
export type ProgressionSample = Readonly<{
  t: number;
  money: Readonly<{ text: string; log10: number }>;
  netWorth?: Readonly<{ text: string; log10: number }>;
}>;

function amountPoint(t: number, amount: Readonly<{ text: string; log10: number }>): ChartPoint {
  return { t, y: Number.isFinite(amount.log10) ? amount.log10 : null, value: amount.text };
}

/**
 * Build progression chart data from samples taken in time order.
 * Each amount series is downsampled with LTTB on its own; growth rate reads the primary series after downsampling.
 */
export function buildProgressionChartData(args: Readonly<{
  samples: readonly ProgressionSample[];
  /** Absolute t of the run start. Every x is `t - startT`. */
  startT: number;
  unit: string;
  primarySeries: "money" | "netWorth";
  milestones?: readonly Readonly<{ key: string; t: number; source: string }>[];
  droppedMilestones?: number;
  maxPoints?: number;
  traceEverySteps?: number | null;
}>): ProgressionChartData {
  const maxPoints = resolveChartMaxPoints(args.maxPoints);
  const money = normalizeTimes(args.samples.map((s) => amountPoint(s.t - args.startT, s.money)));
  const hasNetWorth = args.samples.length > 0 && args.samples.every((s) => s.netWorth !== undefined);
  const netWorth = hasNetWorth
    ? normalizeTimes(args.samples.map((s) => amountPoint(s.t - args.startT, s.netWorth!)))
    : undefined;
  const primary = args.primarySeries === "netWorth" && netWorth ? "netWorth" : "money";
  const keptMoney = downsampleLttb(money, maxPoints);
  const keptNetWorth = netWorth ? downsampleLttb(netWorth, maxPoints) : undefined;
  const primaryPoints = primary === "netWorth" && keptNetWorth ? keptNetWorth : keptMoney;
  const series: ChartSeries[] = [
    { id: "money", label: "Money", yScale: "log10", unit: args.unit, points: keptMoney },
    ...(keptNetWorth ? [{ id: "netWorth", label: "Net worth", yScale: "log10" as const, unit: args.unit, points: keptNetWorth }] : []),
    {
      id: "growthRate",
      label: `Growth rate (${primary === "netWorth" ? "net worth" : "money"})`,
      yScale: "linear",
      unit: "log10/sec",
      points: growthRateSeries(primaryPoints),
    },
  ];
  const milestones = [...(args.milestones ?? [])]
    .map((m) => ({ key: m.key, t: m.t, source: m.source }))
    .sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    xUnit: "sec",
    primarySeries: primary,
    series,
    milestones,
    droppedMilestones: args.droppedMilestones ?? 0,
    sampling: {
      method: money.length > maxPoints ? "lttb" : "none",
      maxPoints,
      sourcePoints: money.length,
      retainedPoints: keptMoney.length,
      traceEverySteps: args.traceEverySteps ?? null,
    },
  };
}

const HIGHER_IS_BETTER = new Set(["endMoney", "endNetWorth", "visibleChangesPerMinute"]);
const LOWER_IS_BETTER = new Set(["droppedRate", "etaToTargetWorth", "timeToMilestone", "maxNoRewardGapSec"]);

export function compareMetricPreference(metric: string): "higher" | "lower" | "n/a" {
  return HIGHER_IS_BETTER.has(metric) ? "higher" : LOWER_IS_BETTER.has(metric) ? "lower" : "n/a";
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** KPI rows of a compare result list. Values stay as measured text; the change columns are derived. */
export function buildCompareKpiRows(results: readonly Readonly<Record<string, unknown>>[]): CompareKpiRow[] {
  return results.map((result) => {
    const metric = typeof result.metric === "string" ? result.metric : "unknown";
    const measured = (typeof result.measured === "object" && result.measured !== null ? result.measured : {}) as Record<string, unknown>;
    const side = (key: "a" | "b") => {
      const row = measured[key];
      return typeof row === "object" && row !== null ? asText((row as Record<string, unknown>)[metric]) : null;
    };
    const a = side("a");
    const b = side("b");
    const na = a === null ? Number.NaN : Number(a);
    const nb = b === null ? Number.NaN : Number(b);
    // A nonzero decimal that converts to 0 underflowed; leave the percentage to the log-delta fallback.
    const underflow = (text: string | null, n: number) => text !== null && n === 0 && decimalLog10(text) !== null;
    const relative = !underflow(a, na) && !underflow(b, nb) && Number.isFinite(na) && Number.isFinite(nb) && Number.isFinite(nb)
      ? na === nb ? 0 : na !== 0 ? ((nb - na) / Math.abs(na)) * 100 : null
      : null;
    const la = a === null ? null : decimalLog10(a);
    const lb = b === null ? null : decimalLog10(b);
    const better = result.better === "a" || result.better === "b" || result.better === "tie" ? result.better : "undetermined";
    return {
      metric,
      a,
      b,
      preference: compareMetricPreference(metric),
      better,
      relativeChangePct: relative !== null && Number.isFinite(relative) ? relative : null,
      log10Delta: la !== null && lb !== null && Number.isFinite(lb - la) ? lb - la : null,
    };
  });
}

/** Heatmap data from experiment elasticity rows. Row and column order follow first appearance. */
export function buildSensitivityChartData(
  elasticities: readonly Readonly<{
    dimensionId: string;
    candidateId: string;
    metricId: string;
    status: "observed" | "unavailable";
    elasticity: string | null;
    direction: "higher" | "lower" | "flat" | "unavailable";
  }>[],
): SensitivityChartData {
  const rows: { dimensionId: string; candidateId: string }[] = [];
  const rowKeys = new Set<string>();
  const columns: string[] = [];
  for (const entry of elasticities) {
    const key = `${entry.dimensionId}\u0000${entry.candidateId}`;
    if (!rowKeys.has(key)) {
      rowKeys.add(key);
      rows.push({ dimensionId: entry.dimensionId, candidateId: entry.candidateId });
    }
    if (!columns.includes(entry.metricId)) columns.push(entry.metricId);
  }
  const cells = elasticities.map((entry) => {
    const parsed = entry.elasticity === null ? Number.NaN : Number(entry.elasticity);
    return {
      dimensionId: entry.dimensionId,
      candidateId: entry.candidateId,
      metricId: entry.metricId,
      status: entry.status,
      elasticity: entry.status === "observed" && Number.isFinite(parsed) ? parsed : null,
      elasticityText: entry.elasticity,
      direction: entry.direction,
    };
  });
  return { method: "one-at-a-time-local", globalSensitivity: false, sobol: false, rows, columns, cells };
}

export function createChartData(args: Readonly<{
  kind: ChartDataV1["kind"];
  title: string;
  source: ChartSource;
  progression?: ProgressionChartData;
  compare?: CompareChartData;
  sensitivity?: SensitivityChartData;
}>): ChartDataV1 {
  return {
    contract: CHART_DATA_CONTRACT,
    schemaVersion: 1,
    kind: args.kind,
    title: args.title,
    source: args.source,
    ...(args.progression ? { progression: args.progression } : {}),
    ...(args.compare ? { compare: args.compare } : {}),
    ...(args.sensitivity ? { sensitivity: args.sensitivity } : {}),
  };
}
