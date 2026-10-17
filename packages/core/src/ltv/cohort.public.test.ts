import { expect, test } from "bun:test";
import {
  applyRetentionPatch, assertCohortObservation, compareRetention, observeCohort,
  observedRetentionRates, planRetentionPatch, type CohortActivityRow, type ScenarioV1,
} from "../index";

const scenario: ScenarioV1 = {
  schemaVersion: 1, unit: { code: "USD" }, policy: { mode: "drop" },
  model: { id: "consumer-model", version: 1 },
  initial: { wallet: { unit: "USD", amount: "0" } }, clock: { stepSec: 1, durationSec: 1 },
  monetization: {
    cohorts: { baseUsers: 300 }, retention: { d1: 0.5, d7: 0.2, d30: 0.09, d90: 0.04, longTailDailyDecay: 0.02 },
    revenue: { payerConversion: 0.04, arppuDaily: 2, platformFeeRate: 0.3 },
    acquisition: { cpi: 1 }, uncertainty: { seed: 7, sigma: { retention: 0.08 } },
  },
};
const rows: CohortActivityRow[] = [
  { userId: "a", day: 0 }, { userId: "b", day: 0, active: false }, { userId: "c", day: 0 },
  { userId: "a", day: 1 }, { userId: "a", day: 7 },
];

test("public cohort API accepts retention-only rows and preserves unobserved values and other assumptions", () => {
  const before = JSON.stringify({ scenario, rows });
  const observation = observeCohort(rows, 7);
  expect(observedRetentionRates(observation)).toEqual({ d1: 1 / 3, d7: 1 / 3 });
  expect(observation.retention[2]).toMatchObject({ status: "not-observed", rate: null, interval95: null });
  expect(compareRetention(observation, { d1: 0.5 })[0]?.differencePercentagePoints).toBeCloseTo(-100 / 6);
  const applied = applyRetentionPatch({ scenario, observation });
  expect(applied.monetization?.retention).toEqual({ ...scenario.monetization?.retention, d1: 1 / 3, d7: 1 / 3 });
  const { retention: _old, ...other } = scenario.monetization!;
  const { retention: _next, ...actual } = applied.monetization!;
  expect(actual).toEqual(other);
  expect(applied.monetization?.revenue).not.toBe(scenario.monetization?.revenue);
  expect(applied.initial).not.toBe(scenario.initial);
  expect(JSON.stringify({ scenario, rows })).toBe(before);
});

test("public application refuses immature, conflicting and unconfigured retention rather than inventing defaults", () => {
  expect(() => applyRetentionPatch({ scenario, observation: observeCohort(rows.filter(r => r.day === 0), 0) })).toThrow("unavailable");
  const zero = observeCohort(rows.filter(r => r.day === 0), 1);
  expect(() => applyRetentionPatch({ scenario, observation: zero })).toThrow("requires-review");
  const missing = { ...scenario, monetization: { revenue: scenario.monetization?.revenue } };
  expect(() => applyRetentionPatch({ scenario: missing, observation: observeCohort(rows, 7) })).toThrow("requires-review");
  const withZeros = { ...scenario, monetization: { ...scenario.monetization, retention: { d1: 0.5, d7: 0, d30: 0, d90: 0 } } };
  expect(applyRetentionPatch({ scenario: withZeros, observation: zero }).monetization?.retention?.d1).toBe(0);
});

test("public consumers reject malformed serialized observations and assumptions at each entrypoint", () => {
  const observation = observeCohort(rows, 7);
  const invalid = { ...observation, retention: observation.retention.map((r, i) => i === 0 ? { ...r, rate: 1 } : r) };
  for (const value of [null, {}, { ...observation, retention: new Array(4) }, invalid]) {
    expect(() => assertCohortObservation(value)).toThrow();
  }
  expect(() => observedRetentionRates(invalid)).toThrow();
  expect(() => planRetentionPatch(invalid, { d30: 0.09, d90: 0.04 })).toThrow();
  expect(() => compareRetention(invalid, {})).toThrow();
  expect(() => applyRetentionPatch({ scenario, observation: invalid })).toThrow();
  for (const value of [NaN, Infinity, -1, 2]) {
    expect(() => planRetentionPatch(observation, { d30: value, d90: 0.04 })).toThrow();
    expect(() => compareRetention(observation, { d1: value })).toThrow();
  }
});

test("public cohort rows retain the complete population, unique daily rows and finite optional money guards", () => {
  expect(() => observeCohort([{ userId: "a", day: 1 }], 7)).toThrow("day 0");
  expect(() => observeCohort([...rows, rows[0]!], 7)).toThrow("aggregated");
  expect(() => observeCohort([{ userId: "a", day: 0, iapRevenue: NaN }], 7)).toThrow("finite");
  expect(() => observeCohort(rows, 1)).toThrow("within");
  expect(() => observeCohort(new Array<CohortActivityRow>(1), 7)).toThrow();
});

test("application recomputes the plan against the current scenario and validates the complete result", () => {
  const observation = observeCohort(rows, 7);
  expect(planRetentionPatch(observation, scenario.monetization?.retention).status).toBe("ready");
  const changed = { ...scenario, monetization: { ...scenario.monetization, retention: { d1: 0.8, d7: 0.7, d30: 0.6, d90: 0.4 } } };
  expect(() => applyRetentionPatch({ scenario: changed, observation })).toThrow("requires-review");
  expect(() => applyRetentionPatch({ scenario: { ...scenario, clock: { stepSec: 0, durationSec: 1 } }, observation })).toThrow();
});
