import { expect, test } from "bun:test";
import {
  deriveMonetizationConfig, estimateLtvPerUser, estimateLtvDistribution, progressionFactor, retentionAtDay,
  type LtvDistribution, type LtvDistributionArgs, type LtvEstimateArgs, type ScenarioV1,
} from "../index";

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

test("seeded distribution preserves means and order statistics regardless of requested quantile order", () => {
  const { monetization: _monetization, ...defaults } = scenario;
  const config = deriveMonetizationConfig(defaults);
  const before = JSON.stringify(config);
  // Two days: the install day at retention 1 and D1 sampled around the default 0.42.
  const args = { config, horizonDays: 2, progression: 0.5, draws: 201,
    quantiles: [0, 0.25, 0.5, 0.75, 1], seed: 42 };
  const result = estimateLtvDistribution(args);
  expect(result.mean.cumulativeGrossRevenuePerUser).toBeCloseTo(0.06752585676819484, 14);
  expect(result.mean.cumulativeNetRevenuePerUser).toBeCloseTo(0.043486651758717465, 14);
  expect(result.mean.cumulativeLtvPerUser).toBeCloseTo(0.043486651758717465, 14);
  const expected = { q0: 0.028448764856669098, q25: 0.03869409365347889,
    q50: 0.042444200245438636, q75: 0.048839482895839934, q100: 0.06500738962365567 };
  for (const [key, value] of Object.entries(expected)) {
    expect(result.quantiles[key]).toBeCloseTo(value, 14);
  }
  expect(estimateLtvDistribution({ ...args, quantiles: [...args.quantiles].reverse() })).toEqual(result);
  expect(JSON.stringify(config)).toBe(before);
});

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
  for (const quantiles of [[], [NaN], [-0.1], [1.1], [0.5, 0.5], [0, -0], new Array<number>(1), Object.assign(new Array<number>(2), { 1: 0.5 })]) {
    expect(() => estimateLtvDistribution({ ...args, quantiles })).toThrow();
  }
  expect(() => estimateLtvPerUser({ ...args, progression: NaN })).toThrow();
  // Seeds are uint32 integers; the sampler no longer folds others with `>>> 0`.
  for (const seed of [Infinity, NaN, 1.5, -1, 2 ** 32]) {
    expect(() => estimateLtvDistribution({ ...args, seed })).toThrow(/seed/);
  }
  expect(estimateLtvDistribution({ ...args, seed: 2 ** 32 - 1 })).toEqual(estimateLtvDistribution({ ...args, seed: 2 ** 32 - 1 }));
  expect(() => estimateLtvDistribution({ ...args, draws: 100000, horizonDays: 1000 })).toThrow();
  expect(() => estimateLtvPerUser({ ...args, config: { ...config,
    revenue: { ...config.revenue, adArpDau: NaN } } })).toThrow();
});

test("partial retention keeps the CLI's independent defaults while explicit invalid curves fail", () => {
  const partial: ScenarioV1 = { ...scenario, monetization: {
    ...scenario.monetization, retention: { d1: 0.1 },
  } };
  const config = deriveMonetizationConfig(partial);
  expect(config.retention).toEqual({ d1: 0.1, d7: 0.2, d30: 0.09, d90: 0.04, longTailDailyDecay: 0.02 });
  // Daily revenue is 2: the install day, then half of day 1 at d1.
  const args = { config, horizonDays: 1.5, progression: 0 };
  expect(estimateLtvPerUser(args).cumulativeGrossRevenuePerUser).toBeCloseTo(2 + 0.5 * 0.1 * 2);
  // The rise from d1 0.1 to the default d7 0.2 is interpolated as given by both the
  // point projection and the zero-sigma distribution, which no longer clips it.
  for (const horizonDays of [1.5, 7.5, 45]) {
    const point = estimateLtvPerUser({ ...args, horizonDays });
    const sampled = estimateLtvDistribution({ ...args, horizonDays, draws: 1, seed: 42, quantiles: [0.5] });
    expect(sampled.mean.cumulativeGrossRevenuePerUser).toBeCloseTo(point.cumulativeGrossRevenuePerUser, 12);
  }
  expect(() => deriveMonetizationConfig({ ...partial, monetization: {
    retention: { d1: 0.1, d7: 0.2, d30: 0.09, d90: 0.04 },
  } })).toThrow(/d1 >= d7/);
  expect(() => estimateLtvPerUser({ ...args, config: { ...config, retention: { ...config.retention, d1: NaN } } })).toThrow(/retention.d1/);
});

test("public config and distribution quantiles both accept endpoints", () => {
  const base = deriveMonetizationConfig(scenario);
  const config = { ...base, uncertainty: { ...base.uncertainty, quantiles: [0, 1] } };
  const args = { config, horizonDays: 1.5, progression: 0 };
  const point = estimateLtvPerUser(args);
  const result = estimateLtvDistribution({ ...args, draws: 2, seed: 42, quantiles: [0, 1] });
  expect(result.quantiles.q0).toBeCloseTo(point.cumulativeLtvPerUser);
  expect(result.quantiles.q100).toBeCloseTo(point.cumulativeLtvPerUser);
  // Config draws, quantiles and seed are the distribution's defaults; explicit args win.
  const seeded = { ...config, uncertainty: { ...config.uncertainty, draws: 2, seed: 42 } };
  expect(estimateLtvDistribution({ ...args, config: seeded })).toEqual(result);
  expect(Object.keys(estimateLtvDistribution({ ...args, config: seeded, quantiles: [0.5] }).quantiles)).toEqual(["q50"]);
  expect(() => estimateLtvDistribution({ ...args, draws: 2 })).toThrow(/seed is required/);
  expect(() => estimateLtvDistribution({ ...args, config: { ...seeded, uncertainty: { ...seeded.uncertainty, seed: 0.5 } } })).toThrow(/seed/);
  expect(() => estimateLtvDistribution({ ...args, config: { ...seeded, uncertainty: { ...seeded.uncertainty, quantiles: [0.5, 0.5] } } })).toThrow(/distinct/);
  // The point estimate reads none of them, so it accepts any in-range config quantiles.
  expect(estimateLtvPerUser({ ...args, config: { ...config, uncertainty: {
    ...config.uncertainty, quantiles: [0.5, 0.5],
  } } })).toEqual(point);
  expect(() => estimateLtvPerUser({ ...args, config: { ...config, uncertainty: {
    ...config.uncertainty, quantiles: new Array<number>(1),
  } } })).toThrow(/quantiles/);
  expect(() => estimateLtvDistribution({ ...args, draws: 1, seed: 42, quantiles: new Array<number>(102) })).toThrow(/101/);
});

test("the horizon covers install days [0, H), so install-day revenue is counted", () => {
  // Every user pays 1.0 IAP and 0.1 ad revenue on day 0, then churns (d1 = 0).
  const config = deriveMonetizationConfig({ ...scenario, monetization: {
    retention: { d1: 0, d7: 0, d30: 0, d90: 0 },
    revenue: { payerConversion: 1, arppuDaily: 1, adArpDau: 0.1,
      platformFeeRate: 0, grossMarginRate: 1, progressionRevenueLift: 0 },
    uncertainty: { sigma: { retention: 0, conversion: 0, arppu: 0, ad: 0 } },
  } });
  const gross = (horizonDays: number) => estimateLtvPerUser({ config, horizonDays, progression: 0 }).cumulativeGrossRevenuePerUser;
  expect(gross(0)).toBe(0);
  expect(gross(0.5)).toBeCloseTo(0.55);
  expect(gross(1)).toBeCloseTo(1.1);
  expect(gross(30)).toBeCloseTo(1.1);
  const sampled = estimateLtvDistribution({ config, horizonDays: 30, progression: 0, draws: 1, seed: 7, quantiles: [0.5] });
  expect(sampled.mean.cumulativeGrossRevenuePerUser).toBeCloseTo(1.1);
});

test("distribution quantile keys are exact percents and never collide", () => {
  const config = deriveMonetizationConfig(scenario);
  const quantiles = [0, 1e-7, 0.005, 0.025, 0.07, 0.124, 0.29, 0.5, 0.975, 1];
  const result = estimateLtvDistribution({ config, horizonDays: 1, progression: 0, draws: 3, seed: 1, quantiles });
  expect(Object.keys(result.quantiles)).toEqual(
    ["q0", "q0.00001", "q0.5", "q2.5", "q7", "q12.4", "q29", "q50", "q97.5", "q100"]);
  expect(Object.keys(estimateLtvDistribution({ config, horizonDays: 1, progression: 0, draws: 3, seed: 1,
    quantiles: [0.5, 0.504] }).quantiles)).toEqual(["q50", "q50.4"]);
  // The named public types describe the same call.
  const pointArgs: LtvEstimateArgs = { config, horizonDays: 1, progression: 0 };
  const distributionArgs: LtvDistributionArgs = { ...pointArgs, draws: 3, seed: 1, quantiles };
  const typed: LtvDistribution = estimateLtvDistribution(distributionArgs);
  expect(typed).toEqual(result);
});

test("exported curve helpers reject inputs they cannot evaluate", () => {
  const { retention } = deriveMonetizationConfig(scenario);
  expect(retentionAtDay(retention, 0)).toBe(1);
  expect(retentionAtDay(retention, 0.5)).toBe(1);
  expect(retentionAtDay(retention, 1)).toBe(1);
  for (const day of [NaN, -1, Infinity]) expect(() => retentionAtDay(retention, day)).toThrow(/day/);
  expect(() => retentionAtDay({ ...retention, d7: NaN }, 3)).toThrow(/retention.d7/);
  expect(progressionFactor(0, 3, 6)).toBe(0.5);
  // An infinite worth log, such as log10 of zero worth, contributes no progression.
  expect(progressionFactor(-Infinity, 3, 6)).toBe(0);
  for (const [start, end, span] of [[NaN, 1, 6], [0, NaN, 6], [0, 1, 0], [0, 1, NaN], [0, 1, Infinity]]) {
    expect(() => progressionFactor(start!, end!, span!)).toThrow(RangeError);
  }
});
