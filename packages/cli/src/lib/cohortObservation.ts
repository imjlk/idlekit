import type { TelemetryRow } from "./ltvTypes";

export const RETENTION_DAYS = [1, 7, 30, 90] as const;
type RetentionKey = `d${typeof RETENTION_DAYS[number]}`;
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
export function observeCohort(rows: readonly TelemetryRow[], observedThroughDay: number): CohortObservation {
  if (!Number.isSafeInteger(observedThroughDay) || observedThroughDay < 0) throw new Error("observed-through-day must be a nonnegative safe integer");
  if (rows.length === 0) throw new Error("Observed cohort requires at least one install record");
  const users = new Map<string, { days: Set<number>; active: Set<number> }>();
  for (const row of rows) {
    if (!row.userId.trim() || !Number.isSafeInteger(row.day) || row.day < 0 || row.day > observedThroughDay) {
      throw new Error("Observed cohort requires a user ID and integer days within observed-through-day");
    }
    if (![row.iapRevenue, row.adRevenue, ...(row.acquisitionCost === undefined ? [] : [row.acquisitionCost])].every(v => Number.isFinite(v) && v >= 0)) {
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

/** Cross-field invariants that portable JSON Schema cannot express. */
export function assertCohortObservation(observation: CohortObservation): void {
  if (!Number.isSafeInteger(observation.users) || observation.users < 1 || !Number.isSafeInteger(observation.observedThroughDay) || observation.observedThroughDay < 0) {
    throw new Error("Invalid cohort population or observation cutoff");
  }
  if (observation.retention.length !== RETENTION_DAYS.length) throw new Error("Cohort retention must contain D1, D7, D30 and D90");
  for (const [index, point] of observation.retention.entries()) {
    if (point.day !== RETENTION_DAYS[index] || point.users !== observation.users) throw new Error("Cohort retention days and population must match the observation");
    const observed = point.day <= observation.observedThroughDay;
    if (point.status !== (observed ? "observed" : "not-observed")) throw new Error("Cohort retention status must match the observation cutoff");
    if (!observed) {
      if (point.activeUsers !== null || point.rate !== null || point.interval95 !== null) throw new Error("Future retention must remain unobserved");
      continue;
    }
    if (point.activeUsers === null || !Number.isSafeInteger(point.activeUsers) || point.activeUsers < 0 || point.activeUsers > point.users || point.rate !== point.activeUsers / point.users) {
      throw new Error("Retained users and retention rate must match the installed population");
    }
    const interval = point.interval95;
    if (point.rate === null || !interval || !Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.min < 0 || interval.max > 1 || interval.min > point.rate || interval.max < point.rate) {
      throw new Error("Retention confidence interval must be finite and contain the observed rate");
    }
  }
}

export function observedRetentionRates(observation: CohortObservation): RetentionAssumptions {
  return Object.fromEntries(observation.retention.filter(row => row.rate !== null).map(row => [`d${row.day}`, row.rate]));
}

export type RetentionPatchPlan = Readonly<{
  status: "ready" | "unavailable" | "requires-review";
  retention: RetentionAssumptions;
  warnings: readonly string[];
}>;

/** Keep exact observations separate from the monotonic curve the LTV model accepts. */
export function planRetentionPatch(observation: CohortObservation, assumptions: RetentionAssumptions = {}): RetentionPatchPlan {
  const rates = observedRetentionRates(observation);
  if (Object.keys(rates).length === 0) return { status: "unavailable", retention: {}, warnings: ["No retention day has been fully observed."] };
  const merged = { ...assumptions, ...rates };
  const warnings: string[] = [];
  for (const day of RETENTION_DAYS) {
    if (merged[`d${day}`] === undefined) warnings.push(`Unobserved D${day} has no explicit retained assumption. An LTV default could conflict with the observations; supply this assumption in --scenario or observe this day before applying a patch.`);
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

export function compareRetention(observation: CohortObservation, assumptions: RetentionAssumptions) {
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

export function renderCohortMarkdown(observation: CohortObservation, comparison: ReturnType<typeof compareRetention> | undefined, patch: RetentionPatchPlan): string {
  const percent = (value: number | null) => value === null ? "unavailable" : `${(value * 100).toFixed(2)}%`;
  const lines = [
    "# Observed player retention",
    "",
    `${observation.users} installed users; complete activity export through day ${observation.observedThroughDay}. Exact-day retention counts every installed user, including those who never return.`,
    "",
    "| Day | Retained / installed | Observed rate | Wilson 95% interval | Assumption | Difference (percentage points) | Status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [index, row] of observation.retention.entries()) {
    const match = comparison?.[index];
    lines.push(`| D${row.day} | ${row.activeUsers === null ? "unavailable" : `${row.activeUsers} / ${row.users}`} | ${percent(row.rate)} | ${row.interval95 ? `${percent(row.interval95.min)} to ${percent(row.interval95.max)}` : "unavailable"} | ${percent(match?.assumption ?? null)} | ${match?.differencePercentagePoints == null ? "unavailable" : match.differencePercentagePoints.toFixed(2)} | ${match?.status ?? row.status} |`);
  }
  lines.push("", `Retention patch: **${patch.status}**.`, "", ...patch.warnings.map(warning => `- ${warning}`), "", "Positive differences mean observed retention exceeds the configured assumption. Only apply a ready patch. Unobserved days are omitted from scenarioPatch; merge its retention fields into the scenario and preserve the remaining assumptions.", "", "Use a separate held-out cohort to validate a fitted model. These observations and intervals describe this cohort; they do not establish fun, causal improvement, or future revenue. Mixed install ages, missing activity exports, and omitted nonreturning users invalidate this comparison.");
  return lines.join("\n");
}
