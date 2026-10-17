import { compareRetention, type CohortObservation, type RetentionPatchPlan } from "@idlekit/core";
export {
  RETENTION_DAYS, assertCohortObservation, compareRetention, observeCohort,
  observedRetentionRates, planRetentionPatch,
  type CohortObservation, type RetentionAssumptions, type RetentionPatchPlan,
} from "@idlekit/core";
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
