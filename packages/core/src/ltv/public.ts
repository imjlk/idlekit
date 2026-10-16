import type { ScenarioV1 } from "../scenario/types";
import { validateScenarioV1 } from "../scenario/validate";
import { deriveMonetizationConfig as derive, estimateLtvPerUser as point } from "./projection";
import { estimateLtvDistribution as distribution } from "./uncertainty";
import type { MonetizationConfig } from "./types";

export type { MonetizationConfig, LtvPointEstimate } from "./types";
export { progressionFactor, retentionAtDay } from "./projection";

function assertMonetization(monetization: NonNullable<ScenarioV1["monetization"]>): void {
  const valid = validateScenarioV1({
    schemaVersion: 1, unit: { code: "LTV" }, policy: { mode: "drop" },
    model: { id: "ltv-input", version: 1 },
    initial: { wallet: { unit: "LTV", amount: "0" } },
    clock: { stepSec: 1, durationSec: 1 }, monetization,
  });
  if (!valid.ok) throw new RangeError(valid.issues.map((issue) => issue.message).join("; "));
}

function assertConfig(config: MonetizationConfig): void {
  const { retention, ...other } = config;
  // Partial scenario retention has historically used independent defaults. Do not
  // impose a new ordering constraint after filling those defaults in the CLI.
  for (const day of ["d1", "d7", "d30", "d90"] as const) {
    if (!Number.isFinite(retention[day]) || retention[day] < 0 || retention[day] > 1) {
      throw new RangeError(`retention.${day} must be finite and in 0..1`);
    }
  }
  if (!Number.isFinite(retention.longTailDailyDecay) || retention.longTailDailyDecay < 0) {
    throw new RangeError("retention.longTailDailyDecay must be finite and >= 0");
  }
  assertMonetization(other);
}

/** Complete a scenario's hypothetical assumptions; this does not fit observed player data. */
export function deriveMonetizationConfig(scenario: ScenarioV1): MonetizationConfig {
  assertMonetization(scenario.monetization ?? {});
  const config = derive(scenario);
  assertConfig(config);
  return config;
}

function assertPoint(args: Parameters<typeof point>[0]): void {
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

/** Per-install value in one caller-chosen currency, including acquisition cost. */
export function estimateLtvPerUser(args: Parameters<typeof point>[0]) {
  assertPoint(args);
  return finiteResult(point(args));
}

/** Seeded assumption sensitivity, not a confidence interval fitted to a player population. */
export function estimateLtvDistribution(args: Parameters<typeof distribution>[0]) {
  assertPoint(args);
  if (!Number.isSafeInteger(args.draws) || args.draws < 1 || args.draws > 100000
    || args.draws * Math.max(1, Math.ceil(args.horizonDays)) > 10000000) {
    throw new RangeError("draws must be 1..100000 and draws × ceil(horizonDays) at most 10000000");
  }
  if (!Number.isFinite(args.seed)) throw new RangeError("seed must be finite");
  if (args.quantiles.length === 0 || !Array.from(args.quantiles).every((q) => Number.isFinite(q) && q >= 0 && q <= 1)
    || new Set(args.quantiles.map((q) => Math.round(q * 100))).size !== args.quantiles.length) {
    throw new RangeError("quantiles must be nonempty, in 0..1 and have distinct rounded percent keys");
  }
  const result = distribution(args);
  finiteResult(result.mean);
  finiteResult(result.quantiles);
  return result;
}
