import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import {
  calibrateMonetization,
  deriveMonetizationConfig,
  makeUncertainConfig,
  mulberry32,
  type MonetizationConfig,
} from "./ltvModel";

function baseConfig(overrides?: Partial<MonetizationConfig["uncertainty"]["correlation"]>): MonetizationConfig {
  return {
    cohorts: { baseUsers: 1000 },
    retention: {
      d1: 0.62,
      d7: 0.54,
      d30: 0.45,
      d90: 0.38,
      longTailDailyDecay: 0.02,
    },
    revenue: {
      payerConversion: 0.09,
      arppuDaily: 0.8,
      adArpDau: 0.03,
      platformFeeRate: 0.3,
      grossMarginRate: 0.92,
      progressionRevenueLift: 0.4,
      progressionLogSpan: 6,
    },
    acquisition: { cpi: 1.2 },
    uncertainty: {
      enabled: true,
      draws: 1000,
      quantiles: [0.5, 0.9],
      sigma: {
        retention: 0.05,
        conversion: 0.05,
        arppu: 0.05,
        ad: 0.05,
      },
      correlation: {
        retentionConversion: overrides?.retentionConversion ?? 0,
        retentionArppu: overrides?.retentionArppu ?? 0,
        retentionAd: overrides?.retentionAd ?? 0,
        conversionArppu: overrides?.conversionArppu ?? 0,
        conversionAd: overrides?.conversionAd ?? 0,
        arppuAd: overrides?.arppuAd ?? 0,
      },
    },
  };
}

function inferredShock(sample: number, mean: number, sigma: number): number {
  return (Math.log(sample / mean) + 0.5 * sigma * sigma) / sigma;
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(1, n);
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(1, n);

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }

  const denom = Math.sqrt(vx * vy);
  if (denom <= 0) return 0;
  return cov / denom;
}

describe("ltvModel correlation sampling", () => {
  it("respects positive retention-conversion correlation over many draws", () => {
    const cfg = baseConfig({ retentionConversion: 0.9 });
    const rng = mulberry32(12345);
    const rs: number[] = [];
    const cs: number[] = [];

    for (let i = 0; i < 3000; i++) {
      const sampled = makeUncertainConfig(cfg, rng);
      rs.push(inferredShock(sampled.retention.d1, cfg.retention.d1, cfg.uncertainty.sigma.retention));
      cs.push(
        inferredShock(
          sampled.revenue.payerConversion,
          cfg.revenue.payerConversion,
          cfg.uncertainty.sigma.conversion,
        ),
      );
    }

    expect(pearson(rs, cs)).toBeGreaterThan(0.75);
  });

  it("keeps near-zero cross-correlation when correlation is zero", () => {
    const cfg = baseConfig({ retentionConversion: 0 });
    const rng = mulberry32(54321);
    const rs: number[] = [];
    const cs: number[] = [];

    for (let i = 0; i < 3000; i++) {
      const sampled = makeUncertainConfig(cfg, rng);
      rs.push(inferredShock(sampled.retention.d1, cfg.retention.d1, cfg.uncertainty.sigma.retention));
      cs.push(
        inferredShock(
          sampled.revenue.payerConversion,
          cfg.revenue.payerConversion,
          cfg.uncertainty.sigma.conversion,
        ),
      );
    }

    expect(Math.abs(pearson(rs, cs))).toBeLessThan(0.1);
  });

  it("falls back safely when correlation matrix is not positive-definite", () => {
    const cfg = baseConfig({
      retentionConversion: 1,
      retentionArppu: 1,
      retentionAd: -1,
      conversionArppu: -1,
      conversionAd: 1,
      arppuAd: 1,
    });
    const rng = mulberry32(11);
    const sampled = makeUncertainConfig(cfg, rng);

    expect(Number.isFinite(sampled.retention.d1)).toBeTrue();
    expect(Number.isFinite(sampled.revenue.payerConversion)).toBeTrue();
    expect(sampled.retention.d1).toBeGreaterThanOrEqual(0);
    expect(sampled.retention.d1).toBeLessThanOrEqual(1);
    expect(sampled.revenue.payerConversion).toBeGreaterThanOrEqual(0);
    expect(sampled.revenue.payerConversion).toBeLessThanOrEqual(1);
  });
});

describe("ltvModel config calibration", () => {
  it("derives correlation defaults when scenario omits monetization", () => {
    const sc = {
      schemaVersion: 1,
      unit: { code: "COIN" },
      policy: { mode: "drop" },
      model: { id: "linear", version: 1 },
      initial: { wallet: { unit: "COIN", amount: "0" } },
      clock: { stepSec: 1, durationSec: 10 },
    } satisfies ScenarioV1;

    const cfg = deriveMonetizationConfig(sc);
    expect(cfg.uncertainty.correlation.retentionConversion).toBe(0);
    expect(cfg.uncertainty.correlation.arppuAd).toBe(0);
  });

  it("calibration payload includes correlation defaults", () => {
    const calibrated = calibrateMonetization([
      { userId: "u1", day: 1, iapRevenue: 0.3, adRevenue: 0.02, active: true, acquisitionCost: 1.2 },
      { userId: "u1", day: 7, iapRevenue: 0, adRevenue: 0.01, active: true },
      { userId: "u2", day: 1, iapRevenue: 0, adRevenue: 0.02, active: true, acquisitionCost: 1.1 },
      { userId: "u3", day: 1, iapRevenue: 0, adRevenue: 0.01, active: true, acquisitionCost: 1.0 },
    ]);

    const corr = calibrated.monetization?.uncertainty?.correlation;
    expect(corr).toBeDefined();
    expect(typeof corr?.retentionConversion).toBe("number");
    expect(typeof corr?.arppuAd).toBe("number");
  });
});
