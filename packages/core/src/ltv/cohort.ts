import type { ScenarioV1 } from "../scenario/types";
import { validateScenarioV1 } from "../scenario/validate";
import { deepClonePreservingPrototype } from "../utils/deepClone";

/** Aggregated activity for a complete install cohort. Missing revenue is not measured zero. */
export type CohortActivityRow = Readonly<{
  userId: string;
  day: number;
  active?: boolean;
  iapRevenue?: number;
  adRevenue?: number;
  acquisitionCost?: number;
}>;

export const RETENTION_DAYS = Object.freeze([1, 7, 30, 90] as const);
export type RetentionKey = `d${typeof RETENTION_DAYS[number]}`;
export type RetentionAssumptions = Partial<Record<RetentionKey, number>>;
export type CohortObservation = Readonly<{
  observedThroughDay: number;
  users: number;
  retention: readonly Readonly<{
    day: number;
    status: "observed" | "not-observed";
    users: number;
    activeUsers: number | null;
    rate: number | null;
    interval95: Readonly<{ min: number; max: number }> | null;
  }>[];
}>;

/** Exact-day retention for one complete install cohort, with an explicit export cutoff. */
export function observeCohort(rows: readonly CohortActivityRow[], observedThroughDay: number): CohortObservation {
  if (!Number.isSafeInteger(observedThroughDay) || observedThroughDay < 0) throw new Error("observed-through-day must be a nonnegative safe integer");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Observed cohort requires at least one install record");
  const users = new Map<string, { days: Set<number>; active: Set<number> }>();
  for (const row of rows) {
    if (!row || typeof row.userId !== "string" || !row.userId.trim() || !Number.isSafeInteger(row.day) || row.day < 0 || row.day > observedThroughDay) {
      throw new Error("Observed cohort requires a user ID and integer days within observed-through-day");
    }
    if (![row.iapRevenue, row.adRevenue, row.acquisitionCost].every(v => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0))) {
      throw new Error("Observed cohort revenue and acquisition costs must be finite and nonnegative");
    }
    if (row.active !== undefined && typeof row.active !== "boolean") throw new Error("Observed cohort active must be boolean");
    const user = users.get(row.userId) ?? { days: new Set<number>(), active: new Set<number>() };
    if (user.days.has(row.day)) throw new Error("Observed cohort requires one aggregated row per user and day");
    user.days.add(row.day);
    if (row.active ?? true) user.active.add(row.day);
    users.set(row.userId, user);
  }
  for (const user of users.values()) {
    if (!user.days.has(0)) throw new Error("Observed cohort requires a day 0 install record for every user, including inactive users");
  }
  const n = users.size;
  const observation: CohortObservation = {
    observedThroughDay,
    users: n,
    retention: RETENTION_DAYS.map(day => {
      if (day > observedThroughDay) return { day, status: "not-observed", users: n, activeUsers: null, rate: null, interval95: null };
      const activeUsers = [...users.values()].filter(user => user.active.has(day)).length;
      const rate = activeUsers / n;
      // Wilson score interval: finite bounds even for zero or complete retention.
      const z2 = 1.959963984540054 ** 2;
      const denominator = 1 + z2 / n;
      const center = (rate + z2 / (2 * n)) / denominator;
      const radius = Math.sqrt(z2 * (rate * (1 - rate) / n + z2 / (4 * n * n))) / denominator;
      return { day, status: "observed", users: n, activeUsers, rate, interval95: { min: activeUsers === 0 ? 0 : Math.max(0, center - radius), max: activeUsers === n ? 1 : Math.min(1, center + radius) } };
    }),
  };
  assertCohortObservation(observation);
  return observation;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate serialized observations, including invariants portable JSON Schema cannot express. */
export function assertCohortObservation(observation: unknown): asserts observation is CohortObservation {
  if (!object(observation) || typeof observation.users !== "number" || !Number.isSafeInteger(observation.users) || observation.users < 1 || typeof observation.observedThroughDay !== "number" || !Number.isSafeInteger(observation.observedThroughDay) || observation.observedThroughDay < 0) {
    throw new Error("Invalid cohort population or observation cutoff");
  }
  if (!Array.isArray(observation.retention) || observation.retention.length !== RETENTION_DAYS.length) throw new Error("Cohort retention must contain D1, D7, D30 and D90");
  for (const [index, value] of observation.retention.entries()) {
    const point: unknown = value;
    if (!object(point) || typeof point.day !== "number" || point.day !== RETENTION_DAYS[index] || point.users !== observation.users) throw new Error("Cohort retention days and population must match the observation");
    const observed = point.day <= observation.observedThroughDay;
    if (point.status !== (observed ? "observed" : "not-observed")) throw new Error("Cohort retention status must match the observation cutoff");
    if (!observed) {
      if (point.activeUsers !== null || point.rate !== null || point.interval95 !== null) throw new Error("Future retention must remain unobserved");
      continue;
    }
    if (typeof point.activeUsers !== "number" || !Number.isSafeInteger(point.activeUsers) || point.activeUsers < 0 || point.activeUsers > observation.users || point.rate !== point.activeUsers / observation.users) {
      throw new Error("Retained users and retention rate must match the installed population");
    }
    const interval = point.interval95;
    if (typeof point.rate !== "number" || !object(interval) || typeof interval.min !== "number" || typeof interval.max !== "number" || !Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.min < 0 || interval.max > 1 || interval.min > point.rate || interval.max < point.rate) {
      throw new Error("Retention confidence interval must be finite and contain the observed rate");
    }
  }
}

/** Return only the fully observed anchors; future days remain absent. */
export function observedRetentionRates(observation: CohortObservation): RetentionAssumptions {
  assertCohortObservation(observation);
  const rates: RetentionAssumptions = {};
  for (const row of observation.retention) {
    if (row.rate !== null) rates[`d${row.day}` as RetentionKey] = row.rate;
  }
  return rates;
}

function assertRetentionAssumptions(assumptions: RetentionAssumptions): void {
  if (!object(assumptions)) throw new RangeError("Retention assumptions must be an object");
  for (const day of RETENTION_DAYS) {
    const rate = assumptions[`d${day}`];
    if (rate !== undefined && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new RangeError(`Retention assumption d${day} must be finite and in 0..1`);
    }
  }
}

export type RetentionPatchPlan = Readonly<{
  status: "ready" | "unavailable" | "requires-review";
  retention: RetentionAssumptions;
  warnings: readonly string[];
}>;

/** Keep exact observations separate from the monotonic curve the LTV model accepts. */
export function planRetentionPatch(observation: CohortObservation, assumptions: RetentionAssumptions = {}): RetentionPatchPlan {
  assertRetentionAssumptions(assumptions);
  const rates = observedRetentionRates(observation);
  if (Object.keys(rates).length === 0) return { status: "unavailable", retention: {}, warnings: ["No retention day has been fully observed."] };
  const merged = { ...assumptions, ...rates };
  const warnings: string[] = [];
  for (const day of RETENTION_DAYS) {
    if (merged[`d${day}`] === undefined) warnings.push(`Unobserved D${day} has no explicit retained assumption. An LTV default could conflict with the observations; supply monetization.retention.d${day} in the scenario or observe this day before applying a patch.`);
  }
  let previous: { day: number; rate: number } | undefined;
  for (const day of RETENTION_DAYS) {
    const rate = merged[`d${day}`];
    if (rate === undefined) continue;
    if (previous && previous.rate < rate) warnings.push(`D${previous.day}=${previous.rate} is below D${day}=${rate}. LTV requires d1 >= d7 >= d30 >= d90; review observations and retained assumptions before applying a patch.`);
    previous = { day, rate };
  }
  return warnings.length ? { status: "requires-review", retention: {}, warnings } : { status: "ready", retention: rates, warnings };
}

export type RetentionComparison = Readonly<{
  day: number;
  assumption: number | null;
  observed: number | null;
  differencePercentagePoints: number | null;
  status: "not-observed" | "unconfigured" | "compared";
}>;

/** Compare observed anchors with explicit assumptions, preserving unobserved states. */
export function compareRetention(observation: CohortObservation, assumptions: RetentionAssumptions): RetentionComparison[] {
  assertCohortObservation(observation);
  assertRetentionAssumptions(assumptions);
  return observation.retention.map(row => {
    const assumption = assumptions[`d${row.day}` as RetentionKey] ?? null;
    return {
      day: row.day,
      assumption,
      observed: row.rate,
      differencePercentagePoints: row.rate === null || assumption === null ? null : (row.rate - assumption) * 100,
      status: row.rate === null ? "not-observed" : assumption === null ? "unconfigured" : "compared",
    };
  });
}

/**
 * Recompute a ready patch against this scenario, apply observed anchors to a copy,
 * and validate the result. All unobserved and non-retention assumptions stay intact.
 * A valid observation does not prove that the caller exported every install/activity.
 */
export function applyRetentionPatch(args: { scenario: ScenarioV1; observation: CohortObservation }): ScenarioV1 {
  const valid = validateScenarioV1(args.scenario);
  if (!valid.ok) throw new RangeError(`Invalid scenario: ${valid.issues.map(issue => issue.message).join("; ")}`);
  const plan = planRetentionPatch(args.observation, args.scenario.monetization?.retention);
  if (plan.status !== "ready") throw new RangeError(`Retention patch ${plan.status}: ${plan.warnings.join(" ")}`);
  const copy = deepClonePreservingPrototype(args.scenario);
  const result: ScenarioV1 = { ...copy, monetization: {
    ...copy.monetization, retention: { ...copy.monetization?.retention, ...plan.retention },
  } };
  const applied = validateScenarioV1(result);
  if (!applied.ok) throw new RangeError(`Invalid calibrated scenario: ${applied.issues.map(issue => issue.message).join("; ")}`);
  return result;
}
