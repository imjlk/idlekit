import type { ScenarioV1 } from "../scenario/types";
import { validateScenarioV1 } from "../scenario/validate";
import {
  deriveMonetizationConfig as derive,
  estimateLtvPerUser as point,
  progressionFactor as progressionFactorUnchecked,
  retentionAtDay as retentionAtDayUnchecked,
} from "./projection";
import { estimateLtvDistribution as distribution, quantileKey } from "./uncertainty";
import type {
  LtvDistribution,
  LtvDistributionArgs,
  LtvEstimateArgs,
  LtvPointEstimate,
  MonetizationConfig,
} from "./types";

export type {
  MonetizationConfig,
  LtvPointEstimate,
  LtvEstimateArgs,
  LtvDistributionArgs,
  LtvDistribution,
} from "./types";

function assertMonetization(monetization: NonNullable<ScenarioV1["monetization"]>): void {
  const valid = validateScenarioV1({
    schemaVersion: 1, unit: { code: "LTV" }, policy: { mode: "drop" },
    model: { id: "ltv-input", version: 1 },
    initial: { wallet: { unit: "LTV", amount: "0" } },
    clock: { stepSec: 1, durationSec: 1 }, monetization,
  });
  if (!valid.ok) throw new RangeError(valid.issues.map((issue) => issue.message).join("; "));
}

function assertQuantileValues(quantiles: readonly number[]): void {
  if (quantiles.length === 0) throw new RangeError("quantiles must be nonempty and in 0..1");
  // Iteration visits sparse slots as undefined, unlike Array.every/map.
  for (const q of quantiles) {
    if (!Number.isFinite(q) || q < 0 || q > 1) throw new RangeError("quantiles must be nonempty and in 0..1");
  }
}

function assertRetention(retention: MonetizationConfig["retention"]): void {
  // Partial scenario retention has historically used independent defaults. Do not
  // impose a new ordering constraint after filling those defaults in the CLI; the
  // point estimate and the distribution both interpolate the anchors as given.
  for (const day of ["d1", "d7", "d30", "d90"] as const) {
    if (!Number.isFinite(retention[day]) || retention[day] < 0 || retention[day] > 1) {
      throw new RangeError(`retention.${day} must be finite and in 0..1`);
    }
  }
  if (!Number.isFinite(retention.longTailDailyDecay) || retention.longTailDailyDecay < 0) {
    throw new RangeError("retention.longTailDailyDecay must be finite and >= 0");
  }
}

function assertConfig(config: MonetizationConfig): void {
  const { retention, ...other } = config;
  assertRetention(retention);
  const { quantiles, ...uncertainty } = other.uncertainty;
  assertQuantileValues(quantiles);
  // The public estimator permits endpoints; ScenarioV1's authored quantile schema
  // is narrower. The whole config is checked once because draws, quantiles and seed
  // are the distribution's defaults.
  assertMonetization({ ...other, uncertainty });
}

/** Complete a scenario's hypothetical assumptions; this does not fit observed player data. */
export function deriveMonetizationConfig(scenario: ScenarioV1): MonetizationConfig {
  assertMonetization(scenario.monetization ?? {});
  const config = derive(scenario);
  assertConfig(config);
  return config;
}

/**
 * Retention on install-day index `day`. Day 0 is the install day (1) and any day in (0, 1]
 * reads D1; there is no ramp from day 0. From D1 to D90 it is linear between the anchors,
 * and after D90 it decays. The LTV estimators only read whole days.
 */
export function retentionAtDay(retention: MonetizationConfig["retention"], day: number): number {
  assertRetention(retention);
  if (!Number.isFinite(day) || day < 0) throw new RangeError("day must be finite and >= 0");
  return retentionAtDayUnchecked(retention, day);
}

/**
 * Share of `span` log10 steps between two worth logs, clamped to 0..1. An infinite
 * worth log (zero or unbounded worth) contributes no progression.
 */
export function progressionFactor(startWorthLog10: number, endWorthLog10: number, span: number): number {
  if (Number.isNaN(startWorthLog10) || Number.isNaN(endWorthLog10)) {
    throw new RangeError("worth logs must not be NaN");
  }
  if (!Number.isFinite(span) || span <= 0) throw new RangeError("span must be finite and > 0");
  return progressionFactorUnchecked(startWorthLog10, endWorthLog10, span);
}

function assertPoint(args: LtvEstimateArgs): void {
  assertConfig(args.config);
  if (!Number.isFinite(args.horizonDays) || args.horizonDays < 0 || args.horizonDays > 36500) {
    throw new RangeError("horizonDays must be finite and in 0..36500");
  }
  if (!Number.isFinite(args.progression)) throw new RangeError("progression must be finite");
}
function finiteResult<T extends object>(result: T): T {
  if (!Object.values(result).every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new RangeError("LTV calculation overflowed; reduce the input magnitudes");
  }
  return result;
}

/**
 * Undiscounted per-install value over install days [0, horizonDays), in one
 * caller-chosen currency, including acquisition cost.
 */
export function estimateLtvPerUser(args: LtvEstimateArgs): LtvPointEstimate {
  assertPoint(args);
  return finiteResult(point(args));
}

/**
 * Seeded assumption sensitivity, not a confidence interval fitted to a player population.
 * Omitted `draws`, `quantiles` and `seed` use `config.uncertainty`. It always samples;
 * `config.uncertainty.enabled` is the caller's switch for whether to call it.
 */
export function estimateLtvDistribution(args: LtvDistributionArgs): LtvDistribution {
  assertPoint(args);
  const draws = args.draws ?? args.config.uncertainty.draws;
  const quantiles = args.quantiles ?? args.config.uncertainty.quantiles;
  const seed = args.seed ?? args.config.uncertainty.seed;
  if (!Number.isSafeInteger(draws) || draws < 1 || draws > 100000
    || draws * Math.max(1, Math.ceil(args.horizonDays)) > 10000000) {
    throw new RangeError("draws must be 1..100000 and draws × ceil(horizonDays) at most 10000000");
  }
  if (seed === undefined) throw new RangeError("seed is required: pass seed or set config.uncertainty.seed");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be an integer in 0..4294967295");
  }
  if (quantiles.length > 101) throw new RangeError("quantiles exceed 101 entries");
  assertQuantileValues(quantiles);
  if (new Set(quantiles.map(quantileKey)).size !== quantiles.length) {
    throw new RangeError("quantiles must be distinct values in 0..1");
  }
  const result = distribution({ ...args, draws, quantiles, seed });
  finiteResult(result.mean);
  finiteResult(result.quantiles);
  return result;
}
