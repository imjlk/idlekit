import type { ScenarioV1 } from "@idlekit/core";

export type MonetizationConfig = Readonly<{
  cohorts: Readonly<{
    baseUsers: number;
  }>;
  retention: Readonly<{
    d1: number;
    d7: number;
    d30: number;
    d90: number;
    longTailDailyDecay: number;
  }>;
  revenue: Readonly<{
    payerConversion: number;
    arppuDaily: number;
    adArpDau: number;
    platformFeeRate: number;
    grossMarginRate: number;
    progressionRevenueLift: number;
    progressionLogSpan: number;
  }>;
  acquisition: Readonly<{
    cpi: number;
  }>;
  uncertainty: Readonly<{
    enabled: boolean;
    draws: number;
    quantiles: number[];
    seed?: number;
    sigma: Readonly<{
      retention: number;
      conversion: number;
      arppu: number;
      ad: number;
    }>;
    correlation: Readonly<{
      retentionConversion: number;
      retentionArppu: number;
      retentionAd: number;
      conversionArppu: number;
      conversionAd: number;
      arppuAd: number;
    }>;
  }>;
}>;

export type LtvPointEstimate = Readonly<{
  cumulativeGrossRevenuePerUser: number;
  cumulativeNetRevenuePerUser: number;
  cumulativeLtvPerUser: number;
}>;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function deriveMonetizationConfig(scenario: ScenarioV1): MonetizationConfig {
  const m = scenario.monetization;
  const q = (m?.uncertainty?.quantiles ?? [0.5, 0.9]).filter((x): x is number => typeof x === "number");
  const quantiles = q.length > 0 ? [...new Set(q)].sort((a, b) => a - b) : [0.5, 0.9];
  return {
    cohorts: {
      baseUsers: m?.cohorts?.baseUsers ?? 1,
    },
    retention: {
      d1: m?.retention?.d1 ?? 0.42,
      d7: m?.retention?.d7 ?? 0.2,
      d30: m?.retention?.d30 ?? 0.09,
      d90: m?.retention?.d90 ?? 0.04,
      longTailDailyDecay: m?.retention?.longTailDailyDecay ?? 0.02,
    },
    revenue: {
      payerConversion: m?.revenue?.payerConversion ?? 0.03,
      arppuDaily: m?.revenue?.arppuDaily ?? 0.7,
      adArpDau: m?.revenue?.adArpDau ?? 0.02,
      platformFeeRate: m?.revenue?.platformFeeRate ?? 0.3,
      grossMarginRate: m?.revenue?.grossMarginRate ?? 0.92,
      progressionRevenueLift: m?.revenue?.progressionRevenueLift ?? 0.4,
      progressionLogSpan: m?.revenue?.progressionLogSpan ?? 6,
    },
    acquisition: {
      cpi: m?.acquisition?.cpi ?? 0,
    },
    uncertainty: {
      enabled: m?.uncertainty?.enabled ?? false,
      draws: m?.uncertainty?.draws ?? 300,
      quantiles,
      seed: m?.uncertainty?.seed,
      sigma: {
        retention: m?.uncertainty?.sigma?.retention ?? 0.08,
        conversion: m?.uncertainty?.sigma?.conversion ?? 0.12,
        arppu: m?.uncertainty?.sigma?.arppu ?? 0.2,
        ad: m?.uncertainty?.sigma?.ad ?? 0.15,
      },
      correlation: {
        retentionConversion: m?.uncertainty?.correlation?.retentionConversion ?? 0,
        retentionArppu: m?.uncertainty?.correlation?.retentionArppu ?? 0,
        retentionAd: m?.uncertainty?.correlation?.retentionAd ?? 0,
        conversionArppu: m?.uncertainty?.correlation?.conversionArppu ?? 0,
        conversionAd: m?.uncertainty?.correlation?.conversionAd ?? 0,
        arppuAd: m?.uncertainty?.correlation?.arppuAd ?? 0,
      },
    },
  };
}

export type Random = () => number;

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randNormal(rng: Random): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clampCorrelation(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function buildCorrelationMatrix(base: MonetizationConfig["uncertainty"]["correlation"]): number[][] {
  const rc = clampCorrelation(base.retentionConversion);
  const ra = clampCorrelation(base.retentionArppu);
  const rd = clampCorrelation(base.retentionAd);
  const ca = clampCorrelation(base.conversionArppu);
  const cd = clampCorrelation(base.conversionAd);
  const ad = clampCorrelation(base.arppuAd);
  return [
    [1, rc, ra, rd],
    [rc, 1, ca, cd],
    [ra, ca, 1, ad],
    [rd, cd, ad, 1],
  ];
}

function withOffDiagonalScale(matrix: number[][], alpha: number): number[][] {
  return matrix.map((row, i) =>
    row.map((v, j) => {
      if (i === j) return 1;
      return v * alpha;
    }));
}

function cholesky4(matrix: number[][]): number[][] | null {
  const n = 4;
  const l: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += (l[i]?.[k] ?? 0) * (l[j]?.[k] ?? 0);
      }
      if (i === j) {
        const val = (matrix[i]?.[i] ?? 0) - sum;
        if (val <= 1e-9) return null;
        l[i]![j] = Math.sqrt(val);
      } else {
        const denom = l[j]?.[j] ?? 0;
        if (Math.abs(denom) < 1e-9) return null;
        l[i]![j] = ((matrix[i]?.[j] ?? 0) - sum) / denom;
      }
    }
  }
  return l;
}

function multiplyLowerTriangular(l: number[][], z: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) {
      sum += (l[i]?.[j] ?? 0) * (z[j] ?? 0);
    }
    out[i] = sum;
  }
  return out;
}

function sampleCorrelatedNormals(
  rng: Random,
  corr: MonetizationConfig["uncertainty"]["correlation"],
): Readonly<{
  retention: number;
  conversion: number;
  arppu: number;
  ad: number;
}> {
  const z = [randNormal(rng), randNormal(rng), randNormal(rng), randNormal(rng)];
  const matrix = buildCorrelationMatrix(corr);
  let l = cholesky4(matrix);

  // If the provided correlation tuple is not positive-definite, keep shrinking
  // off-diagonal terms toward 0 until Cholesky succeeds.
  let alpha = 0.99;
  while (!l && alpha > 1e-6) {
    l = cholesky4(withOffDiagonalScale(matrix, alpha));
    alpha *= 0.8;
  }

  if (!l) {
    return {
      retention: z[0] ?? 0,
      conversion: z[1] ?? 0,
      arppu: z[2] ?? 0,
      ad: z[3] ?? 0,
    };
  }
  const c = multiplyLowerTriangular(l, z);
  return {
    retention: c[0] ?? 0,
    conversion: c[1] ?? 0,
    arppu: c[2] ?? 0,
    ad: c[3] ?? 0,
  };
}

function applyLogNormalShock(mean: number, sigma: number, z: number): number {
  if (sigma <= 0) return mean;
  return mean * Math.exp(sigma * z - 0.5 * sigma * sigma);
}

export function makeUncertainConfig(base: MonetizationConfig, rng: Random): MonetizationConfig {
  const shock = sampleCorrelatedNormals(rng, base.uncertainty.correlation);
  const d1 = clamp01(applyLogNormalShock(base.retention.d1, base.uncertainty.sigma.retention, shock.retention));
  const d7 = Math.min(
    d1,
    clamp01(applyLogNormalShock(base.retention.d7, base.uncertainty.sigma.retention, shock.retention)),
  );
  const d30 = Math.min(
    d7,
    clamp01(applyLogNormalShock(base.retention.d30, base.uncertainty.sigma.retention, shock.retention)),
  );
  const d90 = Math.min(
    d30,
    clamp01(applyLogNormalShock(base.retention.d90, base.uncertainty.sigma.retention, shock.retention)),
  );
  return {
    ...base,
    retention: {
      ...base.retention,
      d1,
      d7,
      d30,
      d90,
    },
    revenue: {
      ...base.revenue,
      payerConversion: clamp01(
        applyLogNormalShock(base.revenue.payerConversion, base.uncertainty.sigma.conversion, shock.conversion),
      ),
      arppuDaily: Math.max(0, applyLogNormalShock(base.revenue.arppuDaily, base.uncertainty.sigma.arppu, shock.arppu)),
      adArpDau: Math.max(0, applyLogNormalShock(base.revenue.adArpDau, base.uncertainty.sigma.ad, shock.ad)),
    },
  };
}

export function retentionAtDay(ret: MonetizationConfig["retention"], day: number): number {
  if (day <= 0) return 1;
  if (day <= 1) return ret.d1;
  if (day <= 7) return ret.d1 + ((ret.d7 - ret.d1) * (day - 1)) / 6;
  if (day <= 30) return ret.d7 + ((ret.d30 - ret.d7) * (day - 7)) / 23;
  if (day <= 90) return ret.d30 + ((ret.d90 - ret.d30) * (day - 30)) / 60;
  const extra = day - 90;
  return clamp01(ret.d90 * Math.exp(-ret.longTailDailyDecay * extra));
}

export function progressionFactor(startWorthLog10: number, endWorthLog10: number, span: number): number {
  if (!Number.isFinite(startWorthLog10) || !Number.isFinite(endWorthLog10) || !Number.isFinite(span) || span <= 0) {
    return 0;
  }
  return clamp01((endWorthLog10 - startWorthLog10) / span);
}

export function estimateLtvPerUser(args: {
  config: MonetizationConfig;
  horizonDays: number;
  progression: number;
}): LtvPointEstimate {
  const { config, horizonDays } = args;
  const progression = clamp01(args.progression);

  const arppuDaily = config.revenue.arppuDaily * (1 + progression * config.revenue.progressionRevenueLift);
  const adArpDau = config.revenue.adArpDau * (1 + progression * config.revenue.progressionRevenueLift * 0.5);
  const payerConversion = config.revenue.payerConversion;

  const fullDays = Math.floor(Math.max(0, horizonDays));
  const remainder = Math.max(0, horizonDays - fullDays);

  let gross = 0;
  for (let day = 1; day <= fullDays; day++) {
    const active = retentionAtDay(config.retention, day);
    gross += active * (payerConversion * arppuDaily + adArpDau);
  }
  if (remainder > 0) {
    const active = retentionAtDay(config.retention, fullDays + 1);
    gross += remainder * active * (payerConversion * arppuDaily + adArpDau);
  }

  const net = gross * (1 - config.revenue.platformFeeRate) * config.revenue.grossMarginRate;
  const ltv = net - config.acquisition.cpi;

  return {
    cumulativeGrossRevenuePerUser: gross,
    cumulativeNetRevenuePerUser: net,
    cumulativeLtvPerUser: ltv,
  };
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx] ?? 0;
}

export function estimateLtvDistribution(args: {
  config: MonetizationConfig;
  horizonDays: number;
  progression: number;
  draws: number;
  quantiles: number[];
  seed: number;
}): Readonly<{
  mean: LtvPointEstimate;
  quantiles: Record<string, number>;
}> {
  const rng = mulberry32(args.seed);
  const grossSamples: number[] = [];
  const netSamples: number[] = [];
  const ltvSamples: number[] = [];

  const draws = Math.max(1, args.draws);
  for (let i = 0; i < draws; i++) {
    const sampled = makeUncertainConfig(args.config, rng);
    const point = estimateLtvPerUser({
      config: sampled,
      horizonDays: args.horizonDays,
      progression: args.progression,
    });
    grossSamples.push(point.cumulativeGrossRevenuePerUser);
    netSamples.push(point.cumulativeNetRevenuePerUser);
    ltvSamples.push(point.cumulativeLtvPerUser);
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const byQuantile: Record<string, number> = {};
  for (const q of args.quantiles) {
    byQuantile[`q${Math.round(q * 100)}`] = quantile(ltvSamples, q);
  }

  return {
    mean: {
      cumulativeGrossRevenuePerUser: avg(grossSamples),
      cumulativeNetRevenuePerUser: avg(netSamples),
      cumulativeLtvPerUser: avg(ltvSamples),
    },
    quantiles: byQuantile,
  };
}

export type TelemetryRow = Readonly<{
  userId: string;
  day: number;
  iapRevenue: number;
  adRevenue: number;
  acquisitionCost?: number;
  active?: boolean;
}>;

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
          retentionConversion: 0.25,
          retentionArppu: 0.2,
          retentionAd: 0.15,
          conversionArppu: 0.35,
          conversionAd: 0.2,
          arppuAd: 0.3,
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
    },
  };
}
