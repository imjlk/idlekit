import { describe, expect, it } from "bun:test";
import { deriveMonetizationConfig, estimateLtvPerUser } from "@idlekit/core";
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

  it("computes correlation and variance when only the intermediate squares overflow", () => {
    // Deviations near 1.5e154 square past Number.MAX_VALUE; the variance (7.5e307) does not.
    const result = calibrateMonetization([0, 0, 0, 2e154].map((iapRevenue, i) => ({ userId: String(i), day: 0, iapRevenue, adRevenue: 0 })));
    expect((result.diagnostics.estimatedCorrelationRaw as { conversionArppu: number }).conversionArppu).toBeCloseTo(1, 12);
    const variance = (result.diagnostics.userFeatureVariance as { arppu: number }).arppu;
    expect(variance / 7.5e307).toBeCloseTo(1, 12);
    expect(JSON.stringify(result)).not.toContain("null");
  });

  it("omits unmeasured revenue and acquisition instead of fitting zeros", () => {
    const rows: TelemetryRow[] = ["a", "b", "c", "d"].map(userId => ({ userId, day: 0 }));
    rows.push({ userId: "a", day: 1 }, { userId: "b", day: 1 });
    const result = calibrateMonetization(rows);
    expect(Object.keys(result.monetization ?? {})).toEqual(["cohorts", "retention"]);
    expect(result.diagnostics).toMatchObject({ unmeasured: ["iapRevenue", "adRevenue", "acquisitionCost"], activeUserDays: 6 });
    for (const key of ["totalIap", "totalAd", "payerUsers", "payerDays", "estimatedCorrelation", "correlationDiagnostics"]) {
      expect(result.diagnostics).not.toHaveProperty(key);
    }
    expect(result.diagnostics.userFeatureVariance).toEqual({ retention: expect.any(Number) });

    const adOnly = calibrateMonetization(rows.map(row => ({ ...row, adRevenue: 0.1 })));
    expect(Object.keys(adOnly.monetization?.revenue ?? {})).toEqual(["adArpDau", "platformFeeRate", "grossMarginRate"]);
    expect(adOnly.monetization?.revenue?.adArpDau).toBeCloseTo(0.1, 12);
    expect(Object.keys(adOnly.monetization?.uncertainty?.correlation ?? {})).toEqual(["retentionAd"]);
    expect(adOnly.diagnostics.unmeasured).toEqual(["iapRevenue", "acquisitionCost"]);
    expect(adOnly.diagnostics.totalAd as number).toBeCloseTo(0.6, 12);

    expect(() => calibrateMonetization([{ userId: "a", day: 0, iapRevenue: 1 }, { userId: "a", day: 1 }])).toThrow(/iapRevenue/);
  });

  it("calibrates install-day revenue that the LTV horizon then counts", () => {
    // Four users each pay 1.0 IAP and 0.1 ad revenue on day 0, then churn: 4.40 in total.
    const result = calibrateMonetization(["a", "b", "c", "d"].map(userId => ({ userId, day: 0, iapRevenue: 1, adRevenue: 0.1 })));
    // Bun's toMatchObject rewrites asymmetric matches into the received object, so check plainly.
    expect(result.monetization?.revenue).toMatchObject({ payerConversion: 1, arppuDaily: 1 });
    expect(result.monetization?.revenue?.adArpDau).toBeCloseTo(0.1, 12);
    expect(result.monetization?.retention?.d1).toBe(0);
    const config = deriveMonetizationConfig({
      schemaVersion: 1, unit: { code: "USD" }, policy: { mode: "drop" }, model: { id: "linear", version: 1 },
      initial: { wallet: { unit: "USD", amount: "0" } }, clock: { stepSec: 1, durationSec: 1 },
      monetization: result.monetization,
    });
    for (const horizonDays of [1, 30]) {
      const estimate = estimateLtvPerUser({ config, horizonDays, progression: 0 });
      expect(estimate.cumulativeGrossRevenuePerUser * 4).toBeCloseTo(4.4, 12);
    }
    expect(estimateLtvPerUser({ config, horizonDays: 0.5, progression: 0 }).cumulativeGrossRevenuePerUser).toBeCloseTo(0.55, 12);
  });
});
