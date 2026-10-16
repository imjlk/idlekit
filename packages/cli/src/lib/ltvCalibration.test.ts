import { describe, expect, it } from "bun:test";
import { calibrateMonetization } from "./ltvCalibration";
import type { TelemetryRow } from "./ltvTypes";

describe("calibration result validity", () => {
  it("projects exploratory retention to a nonincreasing curve while preserving observations", () => {
    const rows: TelemetryRow[] = ["a", "b", "c", "d"].map(userId => ({ userId, day: 0, iapRevenue: 0, adRevenue: 0 }));
    for (const [day, users] of [[1, "a"], [7, "abcd"], [30, "abc"], [90, "ab"]] as const) {
      for (const userId of users) rows.push({ userId, day, iapRevenue: 0, adRevenue: 0 });
    }
    const result = calibrateMonetization(rows);
    expect(result.diagnostics.retention).toEqual({ d1: 0.25, d7: 1, d30: 0.75, d90: 0.5 });
    expect(result.monetization?.retention).toMatchObject({ d1: 0.25, d7: 0.25, d30: 0.25, d90: 0.25 });
  });

  it.each(["iapRevenue", "adRevenue", "acquisitionCost"] as const)("rejects aggregate overflow in %s", field => {
    const rows = ["a", "b"].map(userId => ({ userId, day: 0, iapRevenue: 0, adRevenue: 0, [field]: 1e308 }));
    expect(() => calibrateMonetization(rows)).toThrow(RangeError);
  });

  it("rejects diagnostics overflow even when revenue totals remain finite", () => {
    const rows = [0, 1e200, 2e200].map((iapRevenue, i) => ({ userId: String(i), day: 0, iapRevenue, adRevenue: 0 }));
    expect(() => calibrateMonetization(rows)).toThrow(RangeError);
  });

  it("accepts large finite results and preserves ordinary estimates", () => {
    const result = calibrateMonetization([
      { userId: "a", day: 0, iapRevenue: 1e50, adRevenue: 0.4, acquisitionCost: 2 },
      { userId: "b", day: 0, iapRevenue: 2e50, adRevenue: 0.2, acquisitionCost: 4 },
    ]);
    expect((result.monetization?.revenue?.arppuDaily ?? 0) / 1e50).toBeCloseTo(1.5);
    expect(result.monetization?.revenue?.adArpDau).toBeCloseTo(0.3);
    expect(result.monetization?.acquisition?.cpi).toBe(3);
    expect(JSON.stringify(result)).not.toContain("null");
  });

  it("preserves correlation when finite variances would overflow if multiplied", () => {
    const result = calibrateMonetization(Array.from({ length: 8 }, (_, i) => ({
      userId: String(i), day: 0, iapRevenue: (i + 1) * 1e100, adRevenue: (i + 1) * 1e100,
    })));
    expect(result.diagnostics.estimatedCorrelationRaw).toMatchObject({ arppuAd: expect.closeTo(1, 12) });
    expect(result.monetization?.uncertainty?.correlation?.arppuAd).toBeGreaterThan(0);
  });
});
