/*
 * Distribution summaries with confidence intervals for Monte Carlo draws.
 *
 * Quantiles use the same inclusive-floor rule as the experience summary. Their intervals are distribution-free:
 * order statistics picked from the binomial count of draws below the quantile (normal approximation), so they
 * hold for any shape of metric. The mean interval is the normal approximation `mean ± z * sd / sqrt(n)`.
 * An interval that the draws cannot support is null instead of a clamped bound.
 */

export type ConfidenceInterval = Readonly<{ lower: number; upper: number }>;

export type QuantileWithInterval = Readonly<{
  q: number;
  value: number;
  /** Order-statistic interval at `confidence`. Null when n is too small to bracket q. */
  interval: ConfidenceInterval | null;
}>;

export type SampleSummaryV1 = Readonly<{
  n: number;
  confidence: number;
  method: "normal-mean-order-statistic-quantiles";
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** Null for n < 2. */
  meanInterval: ConfidenceInterval | null;
  quantiles: readonly QuantileWithInterval[];
}>;

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("normalQuantile p must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

function sortedFinite(values: readonly number[]): number[] {
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError("sample values must be finite numbers");
  }
  return [...values].sort((a, b) => a - b);
}

/** Inclusive-floor quantile of sorted values: index floor(q * (n - 1)). */
function floorQuantile(sorted: readonly number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))]!;
}

/** Order-statistic interval for quantile q. Ranks are 1-based; null when a rank falls outside 1..n. */
export function quantileInterval(sorted: readonly number[], q: number, confidence: number): ConfidenceInterval | null {
  const n = sorted.length;
  if (n < 2) return null;
  const z = normalQuantile(0.5 + confidence / 2);
  const center = n * q;
  const spread = z * Math.sqrt(n * q * (1 - q));
  const lowRank = Math.floor(center - spread);
  const highRank = Math.ceil(center + spread) + 1;
  if (lowRank < 1 || highRank > n) return null;
  return { lower: sorted[lowRank - 1]!, upper: sorted[highRank - 1]! };
}

/**
 * Mean, spread, quantiles, and their confidence intervals for a set of finite draws.
 * Throws on an empty set, a non-finite value, a quantile outside [0, 1], or a confidence outside (0, 1).
 */
export function summarizeSamples(
  values: readonly number[],
  options: Readonly<{ quantiles?: readonly number[]; confidence?: number }> = {},
): SampleSummaryV1 {
  const sorted = sortedFinite(values);
  const n = sorted.length;
  if (n === 0) throw new RangeError("summarizeSamples needs at least one value");
  const confidence = options.confidence ?? 0.95;
  if (!(confidence > 0 && confidence < 1)) throw new RangeError("confidence must be in (0, 1)");
  const quantiles = [...new Set(options.quantiles ?? [0.1, 0.5, 0.9])].sort((a, b) => a - b);
  for (const q of quantiles) {
    if (!(q >= 0 && q <= 1)) throw new RangeError("quantiles must be in [0, 1]");
  }
  // Mean by a scaled sum so large magnitudes do not overflow.
  const scale = Math.max(Math.abs(sorted[0]!), Math.abs(sorted[n - 1]!)) || 1;
  let scaledSum = 0;
  for (const value of sorted) scaledSum += value / scale;
  const mean = (scaledSum / n) * scale;
  let squares = 0;
  for (const value of sorted) squares += ((value - mean) / scale) ** 2;
  const sd = n > 1 ? Math.sqrt(squares / (n - 1)) * scale : 0;
  const z = normalQuantile(0.5 + confidence / 2);
  const half = n > 1 ? (z * sd) / Math.sqrt(n) : null;
  return {
    n,
    confidence,
    method: "normal-mean-order-statistic-quantiles",
    mean,
    sd,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    meanInterval: half === null ? null : { lower: mean - half, upper: mean + half },
    quantiles: quantiles.map((q) => ({ q, value: floorQuantile(sorted, q), interval: quantileInterval(sorted, q, confidence) })),
  };
}
