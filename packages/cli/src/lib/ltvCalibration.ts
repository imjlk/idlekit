import type { ScenarioV1 } from "@idlekit/core";
import type { TelemetryRow } from "./ltvTypes";

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
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return acc / values.length;
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
  const sx = x.slice(0, n);
  const sy = y.slice(0, n);
  const mx = mean(sx);
  const my = mean(sy);

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (sx[i] ?? 0) - mx;
    const dy = (sy[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  const varianceX = vx / n;
  const varianceY = vy / n;
  if (vx <= 1e-12 || vy <= 1e-12) {
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

  const raw = clampCorrelation(cov / Math.sqrt(vx * vy));
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

export function calibrateMonetization(rows: readonly TelemetryRow[]): Readonly<{
  monetization: ScenarioV1["monetization"];
  diagnostics: Record<string, unknown>;
}> {
  if (rows.length === 0) {
    throw new Error("calibration rows cannot be empty");
  }

  const users = new Map<string, { days: Set<number>; iap: number; ad: number; acq?: number }>();
  for (const row of rows) {
    const day = Math.max(0, Math.floor(row.day));
    const u = users.get(row.userId) ?? { days: new Set<number>(), iap: 0, ad: 0, acq: undefined };
    if (row.active ?? true) u.days.add(day);
    u.iap += Math.max(0, row.iapRevenue);
    u.ad += Math.max(0, row.adRevenue);
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
  const userConversion: number[] = [];
  const userArppu: number[] = [];
  const userAdArpDau: number[] = [];

  for (const user of users.values()) {
    const activeDays = Math.max(1, user.days.size);
    const retentionScore = clamp01(activeDays / 30);
    const conversionScore = user.iap > 0 ? 1 : 0;
    const arppuScore = user.iap > 0 ? user.iap / activeDays : 0;
    const adScore = user.ad / activeDays;

    userRetention.push(retentionScore);
    userConversion.push(conversionScore);
    userArppu.push(arppuScore);
    userAdArpDau.push(adScore);
  }

  const estimatedCorrelationPair = {
    retentionConversion: estimateCorrelation(userRetention, userConversion),
    retentionArppu: estimateCorrelation(userRetention, userArppu),
    retentionAd: estimateCorrelation(userRetention, userAdArpDau),
    conversionArppu: estimateCorrelation(userConversion, userArppu),
    conversionAd: estimateCorrelation(userConversion, userAdArpDau),
    arppuAd: estimateCorrelation(userArppu, userAdArpDau),
  } as const;

  const estimatedCorrelation = {
    retentionConversion: estimatedCorrelationPair.retentionConversion.value,
    retentionArppu: estimatedCorrelationPair.retentionArppu.value,
    retentionAd: estimatedCorrelationPair.retentionAd.value,
    conversionArppu: estimatedCorrelationPair.conversionArppu.value,
    conversionAd: estimatedCorrelationPair.conversionAd.value,
    arppuAd: estimatedCorrelationPair.arppuAd.value,
  } as const;

  const estimatedCorrelationRaw = {
    retentionConversion: estimatedCorrelationPair.retentionConversion.raw,
    retentionArppu: estimatedCorrelationPair.retentionArppu.raw,
    retentionAd: estimatedCorrelationPair.retentionAd.raw,
    conversionArppu: estimatedCorrelationPair.conversionArppu.raw,
    conversionAd: estimatedCorrelationPair.conversionAd.raw,
    arppuAd: estimatedCorrelationPair.arppuAd.raw,
  } as const;

  const correlationConfidence = {
    retentionConversion: estimatedCorrelationPair.retentionConversion.confidence,
    retentionArppu: estimatedCorrelationPair.retentionArppu.confidence,
    retentionAd: estimatedCorrelationPair.retentionAd.confidence,
    conversionArppu: estimatedCorrelationPair.conversionArppu.confidence,
    conversionAd: estimatedCorrelationPair.conversionAd.confidence,
    arppuAd: estimatedCorrelationPair.arppuAd.confidence,
  } as const;

  return {
    monetization: {
      cohorts: {
        baseUsers: cohortSize,
      },
      retention: {
        d1: clamp01(d1),
        d7: clamp01(Math.min(d1, d7)),
        d30: clamp01(Math.min(d7, d30)),
        d90: clamp01(Math.min(d30, d90)),
        longTailDailyDecay: 0.02,
      },
      revenue: {
        payerConversion: clamp01(payerConversion),
        arppuDaily: Math.max(0, arppuDaily),
        adArpDau: Math.max(0, adArpDau),
        platformFeeRate: 0.3,
        grossMarginRate: 0.92,
      },
      acquisition: {
        cpi: Math.max(0, cpi),
      },
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
        correlation: {
          retentionConversion: estimatedCorrelation.retentionConversion,
          retentionArppu: estimatedCorrelation.retentionArppu,
          retentionAd: estimatedCorrelation.retentionAd,
          conversionArppu: estimatedCorrelation.conversionArppu,
          conversionAd: estimatedCorrelation.conversionAd,
          arppuAd: estimatedCorrelation.arppuAd,
        },
      },
    },
    diagnostics: {
      users: cohortSize,
      totalRows: rows.length,
      totalIap,
      totalAd,
      activeUserDays,
      payerUsers,
      payerDays,
      retention: {
        d1,
        d7,
        d30,
        d90,
      },
      userFeatureVariance: {
        retention: variance(userRetention),
        conversion: variance(userConversion),
        arppu: variance(userArppu),
        adArpDau: variance(userAdArpDau),
      },
      estimatedCorrelation,
      estimatedCorrelationRaw,
      correlationConfidence,
      correlationDiagnostics: estimatedCorrelationPair,
    },
  };
}
