import { expect, it } from "bun:test";
import { compareRetention, observeCohort, observedRetentionRates, planRetentionPatch } from "./cohortObservation";
import type { TelemetryRow } from "./ltvTypes";

const row = (userId: string, day: number, active = true): TelemetryRow => ({ userId, day, active, iapRevenue: 0, adRevenue: 0 });

it("keeps installed nonreturners in the denominator and never invents future retention", () => {
  const observation = observeCohort([row("a", 0), row("b", 0), row("c", 0), row("a", 1), row("b", 1, false)], 7);
  expect(observation.retention[0]).toMatchObject({ rate: 1 / 3, activeUsers: 1, users: 3 });
  expect(observation.retention[1]).toMatchObject({ rate: 0, activeUsers: 0, status: "observed" });
  expect(observation.retention[1]?.interval95?.min).toBe(0);
  expect(observation.retention[2]).toMatchObject({ rate: null, activeUsers: null, status: "not-observed" });
  expect(observedRetentionRates(observation)).toEqual({ d1: 1 / 3, d7: 0 });
  const comparison = compareRetention(observation, { d1: 0.5, d30: 0.1 });
  expect(comparison[0]?.differencePercentagePoints).toBeCloseTo(-100 / 6);
  expect(comparison[1]?.status).toBe("unconfigured");
  expect(comparison[2]?.differencePercentagePoints).toBeNull();
  expect(observation.retention[0]?.interval95?.min).toBeCloseTo(0.06149, 4);
  expect(observation.retention[0]?.interval95?.max).toBeCloseTo(0.79234, 4);
});

it("allows a real later return without clamping exact-day observations to a survival curve", () => {
  const observed = observeCohort([row("a", 0), row("a", 7)], 7);
  expect(observedRetentionRates(observed)).toEqual({ d1: 0, d7: 1 });
  expect(observed.retention[1]?.interval95?.max).toBe(1);
  expect(planRetentionPatch(observed)).toMatchObject({ status: "requires-review", retention: {} });
  // The rule is the scenario's curve rule; the LTV estimators themselves interpolate a rise.
  const rise = planRetentionPatch(observed, { d30: 0, d90: 0 }).warnings.join(" ");
  expect(rise).toContain("A complete scenario retention curve must satisfy d1 >= d7 >= d30 >= d90");
  expect(rise).not.toContain("LTV requires");
});

it("does not equate a day-zero export with measured zero retention", () => {
  const observed = observeCohort([row("a", 0)], 0);
  expect(observedRetentionRates(observed)).toEqual({});
  expect(planRetentionPatch(observed).status).toBe("unavailable");
  expect(observed.retention.every(point => point.rate === null && point.interval95 === null)).toBe(true);
});

it("checks retained future assumptions before offering a patch and leaves the input unchanged", () => {
  const observed = observeCohort([row("a", 0)], 1);
  const assumptions = { d1: 0.8, d7: 0.4, d30: 0.2, d90: 0.1 };
  expect(planRetentionPatch(observed, assumptions)).toMatchObject({ status: "requires-review", retention: {} });
  expect(observed.retention[0]?.rate).toBe(0);
  expect(assumptions.d1).toBe(0.8);
  const ready = observeCohort([row("a", 0), row("b", 0), row("a", 1)], 1);
  expect(planRetentionPatch(ready, assumptions)).toEqual({ status: "ready", retention: { d1: 0.5 }, warnings: [] });
});

it("withholds patches when unobserved points would use unspecified LTV defaults", () => {
  const rows = Array.from({ length: 10 }, (_, index) => row(String(index), 0));
  rows.push(row("0", 1));
  const observation = observeCohort(rows, 1);
  expect(observedRetentionRates(observation)).toEqual({ d1: 0.1 });
  expect(planRetentionPatch(observation)).toMatchObject({ status: "requires-review", retention: {} });
  expect(planRetentionPatch(observation, { d7: 0.05 }).warnings.join(" ")).toContain("D30");
  expect(planRetentionPatch(observation, { d7: 0.05, d30: 0.02, d90: 0.01 })).toEqual({ status: "ready", retention: { d1: 0.1 }, warnings: [] });
});

it("rejects absent installs, duplicate daily rows, invalid amounts, and invalid observation clocks", () => {
  expect(() => observeCohort([row("a", 1)], 7)).toThrow("day 0");
  expect(() => observeCohort([row("a", 0), row("a", 0)], 7)).toThrow("aggregated");
  for (const day of [-1, 0.5, 8, Infinity]) expect(() => observeCohort([row("a", 0), row("a", day)], 7)).toThrow();
  for (const value of [NaN, Infinity, -0.1]) expect(() => observeCohort([{ ...row("a", 0), iapRevenue: value }], 7)).toThrow("finite");
  for (const cutoff of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => observeCohort([row("a", 0)], cutoff)).toThrow("safe integer");
  expect(() => observeCohort([], 7)).toThrow("install");
});
