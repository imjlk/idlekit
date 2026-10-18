import type { ScenarioV1 } from "@idlekit/core";
import type { TelemetryRow } from "./ltvTypes";

function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Calibration requires finite numbers; numeric overflow at ${path}`);
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) assertFiniteNumbers(child, `${path}.${key}`);
  }
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampCorrelation(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  if (Number.isFinite(sum)) return sum / values.length;
  // Large finite values: divide before summing so the running sum stays finite.
  return values.reduce((a, b) => a + b / values.length, 0);
}

type Moments = Readonly<{ cov: number; vx: number; vy: number; scaleX: number; scaleY: number }>;

/**
 * Sums of deviation products, in units of `scaleX`/`scaleY`. Ordinary inputs keep
 * scale 1 and their existing arithmetic. When a square would overflow, deviations
 * are divided by the largest one first, so a representable moment still computes.
 */
function moments(x: readonly number[], y: readonly number[]): Moments {
  const n = Math.min(x.length, y.length);
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  const sums = (scaleX: number, scaleY: number): Moments => {
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < n; i++) {
      const dx = ((x[i] ?? 0) - mx) / scaleX;
      const dy = ((y[i] ?? 0) - my) / scaleY;
      cov += dx * dy;
      vx += dx * dx;
      vy += dy * dy;
    }
    return { cov, vx, vy, scaleX, scaleY };
  };
  const plain = sums(1, 1);
  if (Number.isFinite(plain.cov) && Number.isFinite(plain.vx) && Number.isFinite(plain.vy)) return plain;
  let scaleX = 0;
  let scaleY = 0;
  for (let i = 0; i < n; i++) {
    scaleX = Math.max(scaleX, Math.abs((x[i] ?? 0) - mx));
    scaleY = Math.max(scaleY, Math.abs((y[i] ?? 0) - my));
  }
  return sums(scaleX || 1, scaleY || 1);
}

/** Population variance of `sum` squared deviations in units of `scale`; overflows only when the variance does. */
function scaledVariance(sum: number, scale: number, n: number): number {
  if (scale === 1) return sum / n;
  const deviation = scale * Math.sqrt(sum / n);
  return deviation * deviation;
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const { vx, scaleX } = moments(values, values);
  return scaledVariance(vx, scaleX, values.length);
}

type CorrelationEstimate = Readonly<{
  raw: number;
  value: number;
  confidence: number;
  shrinkage: number;
  sampleSize: number;
  varianceX: number;
  varianceY: number;
}>;

function estimateCorrelation(x: readonly number[], y: readonly number[]): CorrelationEstimate {
  const n = Math.min(x.length, y.length);
  if (n < 3) {
    return {
      raw: 0,
      value: 0,
      confidence: 0,
      shrinkage: 0,
      sampleSize: n,
      varianceX: 0,
      varianceY: 0,
    };
  }
  const { cov, vx, vy, scaleX, scaleY } = moments(x.slice(0, n), y.slice(0, n));
  const varianceX = scaledVariance(vx, scaleX, n);
  const varianceY = scaledVariance(vy, scaleY, n);
  // The unscaled sum of squares is scale² × sum; compare its root to avoid squaring the scale.
  const flat = (sum: number, scale: number) => (scale === 1 ? sum <= 1e-12 : scale * Math.sqrt(sum) <= 1e-6);
  if (flat(vx, scaleX) || flat(vy, scaleY)) {
    return {
      raw: 0,
      value: 0,
      confidence: 0,
      shrinkage: 0,
      sampleSize: n,
      varianceX,
      varianceY,
    };
  }

  const raw = clampCorrelation(cov / Math.sqrt(vx) / Math.sqrt(vy));
  const ci95 = 1.96 / Math.sqrt(Math.max(1, n - 3));
  const sampleConfidence = clamp01(1 - ci95);
  const varianceConfidenceX = varianceX / (varianceX + 0.01);
  const varianceConfidenceY = varianceY / (varianceY + 0.01);
  const varianceConfidence = Math.sqrt(varianceConfidenceX * varianceConfidenceY);
  const confidence = clamp01(sampleConfidence * varianceConfidence);
  const shrinkage = confidence;
  const value = raw * shrinkage;
  return {
    raw,
    value,
    confidence,
    shrinkage,
    sampleSize: n,
    varianceX,
    varianceY,
  };
}

type TelemetrySource = "iapRevenue" | "adRevenue" | "acquisitionCost";
type FeatureKey = "conversion" | "arppu" | "adArpDau";
type CorrelationKey = keyof NonNullable<NonNullable<NonNullable<ScenarioV1["monetization"]>["uncertainty"]>["correlation"]>;

// Retention is always measured; each other feature needs its source column.
const FEATURE_SOURCES: Readonly<Record<FeatureKey, readonly TelemetrySource[]>> = {
  conversion: ["iapRevenue"],
  arppu: ["iapRevenue"],
  adArpDau: ["adRevenue"],
};
const CORRELATION_SOURCES: Readonly<Record<CorrelationKey, readonly TelemetrySource[]>> = {
  retentionConversion: ["iapRevenue"],
  retentionArppu: ["iapRevenue"],
  retentionAd: ["adRevenue"],
  conversionArppu: ["iapRevenue"],
  conversionAd: ["iapRevenue", "adRevenue"],
  arppuAd: ["iapRevenue", "adRevenue"],
};

function pickMeasured<K extends string, V>(
  keys: Readonly<Record<K, readonly TelemetrySource[]>>,
  measured: ReadonlySet<TelemetrySource>,
  value: (key: K) => V,
): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  for (const key of Object.keys(keys) as K[]) {
    if (keys[key].every((source) => measured.has(source))) out[key] = value(key);
  }
  return out;
}

/**
 * Fit exploratory monetization suggestions. A revenue or acquisition source that no row
 * supplies is unmeasured, not zero: its fitted fields, correlations and totals are omitted.
 */
export function calibrateMonetization(rows: readonly TelemetryRow[]): Readonly<{
  monetization: ScenarioV1["monetization"];
  diagnostics: Record<string, unknown>;
}> {
  if (rows.length === 0) {
    throw new Error("calibration rows cannot be empty");
  }

  const measured = new Set<TelemetrySource>();
  for (const source of ["iapRevenue", "adRevenue"] as const) {
    const supplied = rows.filter((row) => row[source] !== undefined).length;
    if (supplied > 0 && supplied < rows.length) {
      throw new RangeError(`${source} must be supplied on every telemetry row or omitted from every row`);
    }
    if (supplied > 0) measured.add(source);
  }
  // Acquisition cost is per user, usually on one row, so any supplied value measures it.
  if (rows.some((row) => row.acquisitionCost !== undefined)) measured.add("acquisitionCost");
  const iapMeasured = measured.has("iapRevenue");
  const adMeasured = measured.has("adRevenue");
  const revenueMeasured = iapMeasured || adMeasured;

  const users = new Map<string, { days: Set<number>; iap: number; ad: number; acq?: number }>();
  for (const row of rows) {
    const day = Math.max(0, Math.floor(row.day));
    const u = users.get(row.userId) ?? { days: new Set<number>(), iap: 0, ad: 0, acq: undefined };
    if (row.active ?? true) u.days.add(day);
    u.iap += Math.max(0, row.iapRevenue ?? 0);
    u.ad += Math.max(0, row.adRevenue ?? 0);
    if (row.acquisitionCost !== undefined && Number.isFinite(row.acquisitionCost)) {
      u.acq = (u.acq ?? 0) + Math.max(0, row.acquisitionCost);
    }
    users.set(row.userId, u);
  }

  const cohortSize = Math.max(1, users.size);
  const dayActiveCount = (targetDay: number): number => {
    let count = 0;
    for (const user of users.values()) if (user.days.has(targetDay)) count += 1;
    return count;
  };

  const d1 = dayActiveCount(1) / cohortSize;
  const d7 = dayActiveCount(7) / cohortSize;
  const d30 = dayActiveCount(30) / cohortSize;
  const d90 = dayActiveCount(90) / cohortSize;

  let totalIap = 0;
  let totalAd = 0;
  let payerUsers = 0;
  let activeUserDays = 0;
  let payerDays = 0;
  let totalAcq = 0;
  let acqUsers = 0;
  for (const user of users.values()) {
    totalIap += user.iap;
    totalAd += user.ad;
    if (user.iap > 0) payerUsers += 1;
    activeUserDays += user.days.size;
    for (const day of user.days) {
      if (day >= 0 && user.iap > 0) payerDays += 1;
    }
    if (user.acq !== undefined) {
      totalAcq += user.acq;
      acqUsers += 1;
    }
  }

  const payerConversion = payerUsers / cohortSize;
  const arppuDaily = totalIap / Math.max(1, payerDays);
  const adArpDau = totalAd / Math.max(1, activeUserDays);
  const cpi = totalAcq / Math.max(1, acqUsers);

  const userRetention: number[] = [];
  const features: Record<FeatureKey, number[]> = { conversion: [], arppu: [], adArpDau: [] };

  for (const user of users.values()) {
    const activeDays = Math.max(1, user.days.size);
    userRetention.push(clamp01(activeDays / 30));
    features.conversion.push(user.iap > 0 ? 1 : 0);
    features.arppu.push(user.iap > 0 ? user.iap / activeDays : 0);
    features.adArpDau.push(user.ad / activeDays);
  }

  const correlationInputs: Readonly<Record<CorrelationKey, readonly [readonly number[], readonly number[]]>> = {
    retentionConversion: [userRetention, features.conversion],
    retentionArppu: [userRetention, features.arppu],
    retentionAd: [userRetention, features.adArpDau],
    conversionArppu: [features.conversion, features.arppu],
    conversionAd: [features.conversion, features.adArpDau],
    arppuAd: [features.arppu, features.adArpDau],
  };
  const estimatedCorrelationPair = pickMeasured(CORRELATION_SOURCES, measured, (key) =>
    estimateCorrelation(...correlationInputs[key]));
  const correlationField = <F extends keyof CorrelationEstimate>(field: F) =>
    pickMeasured(CORRELATION_SOURCES, measured, (key) => estimatedCorrelationPair[key]![field]);
  const estimatedCorrelation = correlationField("value");

  const result: ReturnType<typeof calibrateMonetization> = {
    monetization: {
      cohorts: {
        baseUsers: cohortSize,
      },
      retention: {
        d1: clamp01(d1),
        d7: clamp01(Math.min(d1, d7)),
        d30: clamp01(Math.min(d1, d7, d30)),
        d90: clamp01(Math.min(d1, d7, d30, d90)),
        longTailDailyDecay: 0.02,
      },
      ...(revenueMeasured
        ? {
            revenue: {
              ...(iapMeasured ? { payerConversion: clamp01(payerConversion), arppuDaily: Math.max(0, arppuDaily) } : {}),
              ...(adMeasured ? { adArpDau: Math.max(0, adArpDau) } : {}),
              platformFeeRate: 0.3,
              grossMarginRate: 0.92,
            },
          }
        : {}),
      ...(measured.has("acquisitionCost") ? { acquisition: { cpi: Math.max(0, cpi) } } : {}),
      ...(revenueMeasured
        ? {
            uncertainty: {
              enabled: true,
              draws: 300,
              quantiles: [0.5, 0.9],
              sigma: {
                retention: 0.08,
                conversion: 0.12,
                arppu: 0.2,
                ad: 0.15,
              },
              correlation: estimatedCorrelation,
            },
          }
        : {}),
    },
    diagnostics: {
      users: cohortSize,
      totalRows: rows.length,
      ...(iapMeasured ? { totalIap } : {}),
      ...(adMeasured ? { totalAd } : {}),
      activeUserDays,
      ...(iapMeasured ? { payerUsers, payerDays } : {}),
      ...(measured.size < 3
        ? { unmeasured: (["iapRevenue", "adRevenue", "acquisitionCost"] as const).filter((source) => !measured.has(source)) }
        : {}),
      retention: {
        d1,
        d7,
        d30,
        d90,
      },
      userFeatureVariance: {
        retention: variance(userRetention),
        ...pickMeasured(FEATURE_SOURCES, measured, (key) => variance(features[key])),
      },
      ...(revenueMeasured
        ? {
            estimatedCorrelation,
            estimatedCorrelationRaw: correlationField("raw"),
            correlationConfidence: correlationField("confidence"),
            correlationDiagnostics: estimatedCorrelationPair,
          }
        : {}),
    },
  };
  assertFiniteNumbers(result, "calibration");
  return result;
}
