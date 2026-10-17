import {
  applyRetentionPatch, compareRetention, deriveMonetizationConfig, estimateLtvPerUser,
  observeCohort, planRetentionPatch, type CohortActivityRow, type ScenarioV1,
} from "@idlekit/core";

// Synthetic complete install cohort. Omitted money fields mean revenue was not collected.
const rows: CohortActivityRow[] = [
  { userId: "a", day: 0 }, { userId: "b", day: 0, active: false }, { userId: "c", day: 0 },
  { userId: "a", day: 1 }, { userId: "a", day: 7 },
];
const scenario: ScenarioV1 = {
  schemaVersion: 1, unit: { code: "USD" }, policy: { mode: "drop" },
  model: { id: "hypothetical-economy", version: 1 },
  initial: { wallet: { unit: "USD", amount: "0" } }, clock: { stepSec: 1, durationSec: 1 },
  monetization: {
    retention: { d1: 0.5, d7: 0.2, d30: 0.09, d90: 0.04 },
    revenue: { payerConversion: 0.04, arppuDaily: 2, platformFeeRate: 0.3 },
  },
};
const observation = observeCohort(rows, 7);
const comparison = compareRetention(observation, scenario.monetization?.retention ?? {});
const plan = planRetentionPatch(observation, scenario.monetization?.retention);
if (plan.status !== "ready") throw new Error(plan.warnings.join(" "));
// Recomputes readiness against this scenario, copies it, and changes only observed retention anchors.
const calibrated = applyRetentionPatch({ scenario, observation });
const projection = estimateLtvPerUser({
  config: deriveMonetizationConfig(calibrated), horizonDays: 30, progression: 0.5,
});
console.log(JSON.stringify({ observation, comparison, plan,
  retention: calibrated.monetization?.retention, projection }, null, 2));
