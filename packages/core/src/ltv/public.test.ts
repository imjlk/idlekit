import { expect, test } from "bun:test";
import { deriveMonetizationConfig, estimateLtvPerUser, estimateLtvDistribution, type ScenarioV1 } from "../index";

const scenario: ScenarioV1 = {
  schemaVersion: 1, unit: { code: "COIN" }, policy: { mode: "drop" },
  model: { id: "linear", version: 1 }, initial: { wallet: { unit: "COIN", amount: "0" } },
  clock: { stepSec: 1, durationSec: 1 },
  monetization: {
    retention: { d1: 1, d7: 1, d30: 1, d90: 1 },
    revenue: { payerConversion: 0.5, arppuDaily: 2, adArpDau: 1,
      platformFeeRate: 0.25, grossMarginRate: 0.8, progressionRevenueLift: 0 },
    acquisition: { cpi: 1 },
    uncertainty: { sigma: { retention: 0, conversion: 0, arppu: 0, ad: 0 } },
  },
};

test("public LTV API accounts for fractional days, fees, margin and acquisition cost", () => {
  const config = deriveMonetizationConfig(scenario);
  const args = { config, horizonDays: 1.5, progression: 0 };
  const before = JSON.stringify(config);
  const point = estimateLtvPerUser(args);
  expect(point.cumulativeGrossRevenuePerUser).toBe(3);
  expect(point.cumulativeNetRevenuePerUser).toBeCloseTo(1.8);
  expect(point.cumulativeLtvPerUser).toBeCloseTo(0.8);
  const distribution = { ...args, draws: 10, quantiles: [0.5, 0.9], seed: 42 };
  expect(estimateLtvDistribution(distribution)).toEqual(estimateLtvDistribution(distribution));
  expect(estimateLtvDistribution(distribution).mean.cumulativeLtvPerUser).toBeCloseTo(0.8);
  expect(JSON.stringify(config)).toBe(before);
  expect(estimateLtvPerUser({ ...args, horizonDays: 0 }).cumulativeLtvPerUser).toBe(-1);
});

test("public LTV API rejects invalid or unbounded synchronous inputs", () => {
  const config = deriveMonetizationConfig(scenario);
  const args = { config, horizonDays: 1, progression: 0, draws: 10, quantiles: [0.5], seed: 1 };
  for (const horizonDays of [NaN, Infinity, -1, 1e12]) {
    expect(() => estimateLtvPerUser({ ...args, horizonDays })).toThrow();
  }
  for (const draws of [NaN, Infinity, -1, 0, 1.5, 1e9]) {
    expect(() => estimateLtvDistribution({ ...args, draws })).toThrow();
  }
  for (const quantiles of [[], [NaN], [-0.1], [1.1], [0.5, 0.504]]) {
    expect(() => estimateLtvDistribution({ ...args, quantiles })).toThrow();
  }
  expect(() => estimateLtvPerUser({ ...args, progression: NaN })).toThrow();
  expect(() => estimateLtvDistribution({ ...args, seed: Infinity })).toThrow();
  expect(() => estimateLtvDistribution({ ...args, draws: 100000, horizonDays: 1000 })).toThrow();
  expect(() => estimateLtvPerUser({ ...args, config: { ...config,
    revenue: { ...config.revenue, adArpDau: NaN } } })).toThrow();
});
