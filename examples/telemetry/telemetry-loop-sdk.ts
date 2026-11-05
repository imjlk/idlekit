import {
  assignExperimentGroup, compareCohorts, detectRetentionDrift, observeCohortBatch,
  planRetentionExperiment, planScenarioRetentionUpdate, type CohortBatch, type ScenarioV1,
} from "@idlekit/core";

// Two synthetic complete install cohorts with pseudonymous ids. Nothing leaves the process.
const users = (prefix: string, total: number, d1: number, d7: number) => Array.from({ length: total }, (_, index) => [
  { userId: `${prefix}${index}`, day: 0 },
  ...(index < d1 ? [{ userId: `${prefix}${index}`, day: 1 }] : []),
  ...(index < d7 ? [{ userId: `${prefix}${index}`, day: 7 }] : []),
]).flat();
const batch: CohortBatch = {
  schemaVersion: 1,
  cohorts: [
    { id: "week-1-control", variant: "control", observedThroughDay: 7, rows: users("c", 200, 80, 36) },
    { id: "week-1-fast-start", variant: "fast-start", observedThroughDay: 7, rows: users("f", 200, 94, 38) },
  ],
};
const scenario: ScenarioV1 = {
  schemaVersion: 1, unit: { code: "USD" }, policy: { mode: "drop" },
  model: { id: "hypothetical-economy", version: 1 },
  initial: { wallet: { unit: "USD", amount: "0" } }, clock: { stepSec: 1, durationSec: 1 },
  monetization: {
    retention: { d1: 0.4, d7: 0.18, d30: 0.08, d90: 0.035 },
    revenue: { payerConversion: 0.04, arppuDaily: 2, platformFeeRate: 0.3 },
  },
};

const cohorts = observeCohortBatch(batch);
const retention = scenario.monetization?.retention ?? {};
const comparison = compareCohorts(cohorts, { baseline: "week-1-control", assumptions: retention });
const drift = cohorts.map(cohort => ({ id: cohort.id, ...detectRetentionDrift(cohort.observation, retention, { thresholdPercentagePoints: 5 }) }));
// Plans the patch and returns the patched copy only when every unobserved day keeps an explicit assumption.
const update = planScenarioRetentionUpdate(scenario, cohorts[1]!.observation);
const experiment = planRetentionExperiment({
  groups: [{ id: "control", retention: 0.4 }, { id: "fast-start", retention: 0.45 }],
  retentionDay: 1, dailyInstalls: 400,
});
const group = assignExperimentGroup("player-7f3a", "fast-start-2026-11", ["control", "fast-start"]);
console.log(JSON.stringify({ comparison, drift, changes: update.changes, status: update.plan.status, experiment, group }, null, 2));
