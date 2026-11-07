import { expect, test } from "bun:test";
import {
  assignExperimentGroup, compareCohorts, detectRetentionDrift, observeCohort, observeCohortBatch,
  planRetentionExperiment, planScenarioRetentionUpdate, standardNormalCdf, standardNormalQuantile,
  twoProportionSignificance, validateCohortBatch, type CohortActivityRow, type ScenarioV1,
} from "../index";

function cohortRows(users: number, retained: Readonly<Record<number, number>>, prefix = "u"): CohortActivityRow[] {
  const rows: CohortActivityRow[] = [];
  for (let index = 0; index < users; index++) {
    rows.push({ userId: `${prefix}${index}`, day: 0 });
    for (const [day, count] of Object.entries(retained)) if (index < count) rows.push({ userId: `${prefix}${index}`, day: Number(day) });
  }
  return rows;
}

const scenario: ScenarioV1 = {
  schemaVersion: 1, unit: { code: "USD" }, policy: { mode: "drop" },
  model: { id: "consumer-model", version: 1 },
  initial: { wallet: { unit: "USD", amount: "0" } }, clock: { stepSec: 1, durationSec: 1 },
  monetization: {
    retention: { d1: 0.5, d7: 0.2, d30: 0.09, d90: 0.04 },
    revenue: { payerConversion: 0.04, arppuDaily: 2, platformFeeRate: 0.3 },
  },
};

test("cohort batch validation observes every cohort and reports every issue path", () => {
  const batch = {
    schemaVersion: 1,
    cohorts: [
      { id: "2026-10-01", variant: "control", installDate: "2026-10-01", observedThroughDay: 7, rows: cohortRows(100, { 1: 40, 7: 15 }, "a") },
      { id: "2026-10-02", variant: "fast-start", observedThroughDay: 7, rows: cohortRows(100, { 1: 50, 7: 20 }, "b") },
    ],
  };
  const cohorts = observeCohortBatch(batch);
  expect(cohorts.map(cohort => [cohort.id, cohort.variant, cohort.installDate, cohort.observation.retention[0]!.rate])).toEqual([
    ["2026-10-01", "control", "2026-10-01", 0.4], ["2026-10-02", "fast-start", null, 0.5],
  ]);
  const invalid = validateCohortBatch({
    schemaVersion: 2, extra: true,
    cohorts: [
      { id: "dup", observedThroughDay: 1, rows: [{ userId: "a", day: 0, iapRevenue: 1 }, { userId: "a", day: 1 }] },
      { id: "dup", installDate: "2026-02-30", observedThroughDay: -1, rows: [{ userId: "", day: "0", revenue: 1 }] },
      { id: "missing-install", observedThroughDay: 1, rows: [{ userId: "a", day: 1 }] },
    ],
  });
  expect(invalid.ok).toBe(false);
  const paths = invalid.ok ? [] : invalid.issues.map(issue => issue.path);
  expect(paths).toEqual(expect.arrayContaining([
    "$.schemaVersion", "$.extra", "$.cohorts[0].rows", "$.cohorts[1].id", "$.cohorts[1].installDate",
    "$.cohorts[1].observedThroughDay", "$.cohorts[1].rows[0].revenue", "$.cohorts[1].rows[0].userId", "$.cohorts[1].rows[0].day", "$.cohorts[2]",
  ]));
  expect(() => observeCohortBatch({ schemaVersion: 1, cohorts: [] })).toThrow("$.cohorts");
});

test("normal helpers match reference quantiles", () => {
  expect(standardNormalQuantile(0.975)).toBeCloseTo(1.959963985, 8);
  expect(standardNormalQuantile(0.8)).toBeCloseTo(0.841621234, 8);
  expect(standardNormalQuantile(0.001)).toBeCloseTo(-3.090232306, 7);
  expect(standardNormalCdf(1.959963985)).toBeCloseTo(0.975, 6);
  expect(standardNormalCdf(-1)).toBeCloseTo(0.158655254, 6);
  expect(() => standardNormalQuantile(1)).toThrow();
});

test("multi-cohort comparison anchors differences and significance hints to the baseline", () => {
  const cohorts = observeCohortBatch({ schemaVersion: 1, cohorts: [
    { id: "control", observedThroughDay: 7, rows: cohortRows(1000, { 1: 400, 7: 150 }, "a") },
    { id: "treatment", observedThroughDay: 7, rows: cohortRows(1000, { 1: 470, 7: 160 }, "b") },
    { id: "tiny", observedThroughDay: 1, rows: cohortRows(4, { 1: 2 }, "c") },
  ] });
  const comparison = compareCohorts(cohorts, { baseline: "control", assumptions: { d1: 0.45 } });
  expect(comparison.baseline).toBe("control");
  expect(comparison.comparisons).toBe(2);
  const d1 = comparison.days[0]!;
  expect(d1.spreadPercentagePoints).toBeCloseTo(10);
  expect(d1.cohorts[0]!.significance).toBeNull();
  expect(d1.cohorts[1]!.differenceFromBaselinePercentagePoints).toBeCloseTo(7);
  expect(d1.cohorts[1]!.differenceFromAssumptionPercentagePoints).toBeCloseTo(2);
  expect(d1.cohorts[1]!.significance?.verdict).toBe("significant");
  expect(d1.cohorts[2]!.significance?.verdict).toBe("insufficient-sample");
  const d7 = comparison.days[1]!;
  expect(d7.cohorts[1]!.significance?.verdict).toBe("not-significant");
  expect(d7.cohorts[2]).toMatchObject({ status: "not-observed", rate: null, significance: null });
  expect(comparison.days[2]!.spreadPercentagePoints).toBeNull();
  expect(() => compareCohorts(cohorts, { baseline: "absent" })).toThrow("absent");
  const hint = twoProportionSignificance({ users: 1000, activeUsers: 400 }, { users: 1000, activeUsers: 470 });
  expect(hint.z).toBeCloseTo(3.1573, 3);
  expect(hint.pValue).toBeCloseTo(0.0016, 3);
});

test("drift alerts need the threshold and, by default, an assumption outside the interval", () => {
  const observation = observeCohort(cohortRows(1000, { 1: 400, 7: 190 }), 7);
  const drift = detectRetentionDrift(observation, { d1: 0.5, d7: 0.2, d30: 0.09 }, { thresholdPercentagePoints: 5 });
  expect(drift.status).toBe("drift");
  expect(drift.findings.map(finding => [finding.day, finding.drift])).toEqual([[1, true], [7, false]]);
  const small = observeCohort(cohortRows(10, { 1: 4 }), 1);
  expect(detectRetentionDrift(small, { d1: 0.5 }).status).toBe("within-threshold");
  expect(detectRetentionDrift(small, { d1: 0.5 }, { requireIntervalExclusion: false }).status).toBe("drift");
  expect(detectRetentionDrift(small, {}).status).toBe("no-comparable-days");
  expect(() => detectRetentionDrift(small, { d1: 0.5 }, { thresholdPercentagePoints: -1 })).toThrow();
});

test("experiment plans size groups, derive the effect from variant assumptions and keep assignment stable", () => {
  const plan = planRetentionExperiment({ groups: [{ id: "control" }, { id: "treatment" }], retentionDay: 1, baselineRate: 0.4, minimumDetectableEffectPercentagePoints: 5 });
  expect(plan.usersPerGroup).toBe(1534);
  expect(plan.totalUsers).toBe(3068);
  expect(plan.observationWindow).toEqual({ observedThroughDay: 1, enrollmentDays: null, earliestReadoutDay: null });
  const derived = planRetentionExperiment({
    groups: [{ id: "control", scenario: "a.json", retention: 0.2 }, { id: "b", retention: 0.23 }, { id: "c", retention: 0.25 }],
    retentionDay: 7, dailyInstalls: 500,
  });
  expect(derived.minimumDetectableEffectPercentagePoints).toBeCloseTo(3);
  expect(derived.adjustedAlpha).toBeCloseTo(0.025);
  expect(derived.groups.map(group => group.role)).toEqual(["control", "treatment", "treatment"]);
  expect(derived.observationWindow.enrollmentDays).toBe(Math.max(7, Math.ceil(derived.totalUsers / 500)));
  expect(derived.observationWindow.earliestReadoutDay).toBe(derived.observationWindow.enrollmentDays! + 8);
  expect(() => planRetentionExperiment({ groups: [{ id: "a", retention: 0.2 }, { id: "b", retention: 0.2 }], retentionDay: 7 })).toThrow("minimumDetectableEffect");
  expect(() => planRetentionExperiment({ groups: [{ id: "a" }], retentionDay: 7, baselineRate: 0.2, minimumDetectableEffectPercentagePoints: 1 })).toThrow();
  expect(() => planRetentionExperiment({ groups: [{ id: "a" }, { id: "b" }], retentionDay: 3, baselineRate: 0.2, minimumDetectableEffectPercentagePoints: 1 })).toThrow();
  const groups = ["control", "treatment"];
  expect(assignExperimentGroup("player-1", "exp", groups)).toBe(assignExperimentGroup("player-1", "exp", groups));
  const counts = { control: 0, treatment: 0 } as Record<string, number>;
  for (let index = 0; index < 10000; index++) counts[assignExperimentGroup(`p${index}`, "exp", groups)]! += 1;
  expect(Math.abs(counts.control! - 5000)).toBeLessThan(250);
});

test("scenario retention update returns a validated copy and an explicit diff", () => {
  const before = JSON.stringify(scenario);
  const update = planScenarioRetentionUpdate(scenario, observeCohort(cohortRows(10, { 1: 4, 7: 1 }), 7));
  expect(update.plan.status).toBe("ready");
  expect(update.changes).toEqual([{ key: "d1", before: 0.5, after: 0.4 }, { key: "d7", before: 0.2, after: 0.1 }]);
  expect(update.scenario?.monetization?.retention).toEqual({ d1: 0.4, d7: 0.1, d30: 0.09, d90: 0.04 });
  expect(JSON.stringify(scenario)).toBe(before);
  const review = planScenarioRetentionUpdate(scenario, observeCohort(cohortRows(10, { 1: 1, 7: 2 }), 7));
  expect(review.plan.status).toBe("requires-review");
  expect(review.scenario).toBeUndefined();
  expect(review.changes).toEqual([]);
});


test("experiment sizing preserves signed effects and budgets for the hardest treatment", () => {
  const plan = (rates: number[], mde?: number) => planRetentionExperiment({
    groups: rates.map((retention, index) => ({ id: `group-${index}`, retention })),
    retentionDay: 1, minimumDetectableEffectPercentagePoints: mde,
  });
  const decrease = plan([0.8, 0.7]);
  expect(decrease.targetRate).toBe(0.7);
  expect(decrease.usersPerGroup).toBe(294);
  expect(plan([0.8, 0.9]).usersPerGroup).toBe(199);
  const mixed = plan([0.8, 0.9, 0.7]);
  expect(mixed.targetRate).toBe(0.7);
  expect(mixed.usersPerGroup).toBe(356); // Bonferroni: decrease needs 356, increase 242
  expect(mixed.groups.every(group => group.requiredUsers === mixed.usersPerGroup)).toBe(true);
  expect(plan([0.8, 0.7, 0.9]).usersPerGroup).toBe(mixed.usersPerGroup);
  // An explicit MDE is directionless, even when variant assumptions are present.
  expect(plan([0.8, 0.9], 10).usersPerGroup).toBe(294);
  expect(plan([0.8, 0.9], 10).targetRate).toBeCloseTo(0.7);
  const unspecified = planRetentionExperiment({ groups: [{ id: "a" }, { id: "b" }], retentionDay: 1, baselineRate: 0.8, minimumDetectableEffectPercentagePoints: 10 });
  expect(unspecified.usersPerGroup).toBe(294);
  for (const rates of [[0.99, 0.98], [0.01, 0.02], [0.9, 1], [0.1, 0]]) {
    const result = plan(rates);
    expect(result.targetRate).toBe(rates[1]!);
    expect(Number.isFinite(result.usersPerGroup)).toBe(true);
    expect(result.usersPerGroup).toBeGreaterThan(0);
  }
  expect(plan([0.99, 0.98], 5).targetRate).toBeCloseTo(0.94);
  expect(plan([0.01, 0.02], 5).targetRate).toBeCloseTo(0.06);
  expect(() => plan([0.5, 0.6], 90)).toThrow("outside [0, 1]");
});
