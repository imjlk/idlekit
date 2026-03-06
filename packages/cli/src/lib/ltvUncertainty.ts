import { estimateLtvPerUser } from "./ltvProjection";
import type { LtvPointEstimate, MonetizationConfig } from "./ltvTypes";

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
