import { expect, it } from "bun:test";
import { compareRetention, observeCohort, observedRetentionPatch } from "./cohortObservation";
import type { TelemetryRow } from "./ltvTypes";

const row = (userId: string, day: number, active = true): TelemetryRow => ({ userId, day, active, iapRevenue: 0, adRevenue: 0 });

it("keeps installed nonreturners in the denominator and never invents future retention", () => {
  const observation = observeCohort([row("a", 0), row("b", 0), row("c", 0), row("a", 1), row("b", 1, false)], 7);
  expect(observation.retention[0]).toMatchObject({ rate: 1 / 3, activeUsers: 1, users: 3 });
  expect(observation.retention[1]).toMatchObject({ rate: 0, activeUsers: 0, status: "observed" });
  expect(observation.retention[1]?.interval95?.min).toBe(0);
  expect(observation.retention[2]).toMatchObject({ rate: null, activeUsers: null, status: "not-observed" });
  expect(observedRetentionPatch(observation)).toEqual({ d1: 1 / 3, d7: 0 });
  const comparison = compareRetention(observation, { d1: 0.5, d30: 0.1 });
  expect(comparison[0]?.differencePercentagePoints).toBeCloseTo(-100 / 6);
  expect(comparison[1]?.status).toBe("unconfigured");
  expect(comparison[2]?.differencePercentagePoints).toBeNull();
  expect(observation.retention[0]?.interval95?.min).toBeCloseTo(0.06149, 4);
  expect(observation.retention[0]?.interval95?.max).toBeCloseTo(0.79234, 4);
});

it("allows a real later return without clamping exact-day observations to a survival curve", () => {
  const observed = observeCohort([row("a", 0), row("a", 7)], 7);
  expect(observedRetentionPatch(observed)).toEqual({ d1: 0, d7: 1 });
  expect(observed.retention[1]?.interval95?.max).toBe(1);
});

it("does not equate a day-zero export with measured zero retention", () => {
  const observed = observeCohort([row("a", 0)], 0);
  expect(observedRetentionPatch(observed)).toEqual({});
  expect(observed.retention.every(point => point.rate === null && point.interval95 === null)).toBe(true);
});

it("rejects absent installs, duplicate daily rows, invalid amounts, and invalid observation clocks", () => {
  expect(() => observeCohort([row("a", 1)], 7)).toThrow("day 0");
  expect(() => observeCohort([row("a", 0), row("a", 0)], 7)).toThrow("aggregated");
  for (const day of [-1, 0.5, 8, Infinity]) expect(() => observeCohort([row("a", 0), row("a", day)], 7)).toThrow();
  for (const value of [NaN, Infinity, -0.1]) expect(() => observeCohort([{ ...row("a", 0), iapRevenue: value }], 7)).toThrow("finite");
  for (const cutoff of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => observeCohort([row("a", 0)], cutoff)).toThrow("safe integer");
  expect(() => observeCohort([], 7)).toThrow("install");
});
