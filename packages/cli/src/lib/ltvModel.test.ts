import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import { calibrateMonetization, deriveMonetizationConfig } from "./ltvModel";

describe("ltvModel config calibration", () => {
  it("derives correlation defaults when scenario omits monetization", () => {
    const sc = {
      schemaVersion: 1,
      unit: { code: "COIN" },
      policy: { mode: "drop" },
      model: { id: "linear", version: 1 },
      initial: { wallet: { unit: "COIN", amount: "0" } },
      clock: { stepSec: 1, durationSec: 10 },
    } satisfies ScenarioV1;

    const cfg = deriveMonetizationConfig(sc);
    expect(cfg.uncertainty.correlation.retentionConversion).toBe(0);
    expect(cfg.uncertainty.correlation.arppuAd).toBe(0);
  });

  it("calibration payload includes correlation defaults", () => {
    const calibrated = calibrateMonetization([
      { userId: "u1", day: 1, iapRevenue: 0.3, adRevenue: 0.02, active: true, acquisitionCost: 1.2 },
      { userId: "u1", day: 7, iapRevenue: 0, adRevenue: 0.01, active: true },
      { userId: "u2", day: 1, iapRevenue: 0, adRevenue: 0.02, active: true, acquisitionCost: 1.1 },
      { userId: "u3", day: 1, iapRevenue: 0, adRevenue: 0.01, active: true, acquisitionCost: 1.0 },
    ]);

    const corr = calibrated.monetization?.uncertainty?.correlation;
    expect(corr).toBeDefined();
    expect(typeof corr?.retentionConversion).toBe("number");
    expect(typeof corr?.arppuAd).toBe("number");
  });

  it("applies confidence-based correlation shrinkage toward zero", () => {
    const calibrated = calibrateMonetization([
      { userId: "u1", day: 1, iapRevenue: 2.0, adRevenue: 0.02, active: true, acquisitionCost: 1.2 },
      { userId: "u1", day: 7, iapRevenue: 1.2, adRevenue: 0.01, active: true },
      { userId: "u2", day: 1, iapRevenue: 0, adRevenue: 0.02, active: true, acquisitionCost: 1.1 },
      { userId: "u3", day: 1, iapRevenue: 0, adRevenue: 0.01, active: true, acquisitionCost: 1.0 },
    ]);

    const diagnostics = calibrated.diagnostics as Record<string, any>;
    const shrunk = diagnostics.estimatedCorrelation?.retentionConversion ?? 0;
    const raw = diagnostics.estimatedCorrelationRaw?.retentionConversion ?? 0;
    const confidence = diagnostics.correlationConfidence?.retentionConversion ?? 0;

    expect(Math.abs(shrunk)).toBeLessThanOrEqual(Math.abs(raw) + 1e-12);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("increases correlation confidence with larger sample size", () => {
    const small = calibrateMonetization([
      { userId: "s1", day: 1, iapRevenue: 1.0, adRevenue: 0.02, active: true },
      { userId: "s1", day: 7, iapRevenue: 0.5, adRevenue: 0.01, active: true },
      { userId: "s2", day: 1, iapRevenue: 0, adRevenue: 0.02, active: true },
      { userId: "s3", day: 1, iapRevenue: 0, adRevenue: 0.01, active: true },
    ]);

    const largeRows: Array<{
      userId: string;
      day: number;
      iapRevenue: number;
      adRevenue: number;
      active: boolean;
    }> = [];
    for (let i = 0; i < 80; i++) {
      const highValue = i % 2 === 0;
      const userId = `l${i}`;
      largeRows.push({ userId, day: 1, iapRevenue: highValue ? 1.5 : 0, adRevenue: highValue ? 0.04 : 0.01, active: true });
      largeRows.push({ userId, day: 7, iapRevenue: highValue ? 0.8 : 0, adRevenue: highValue ? 0.03 : 0, active: highValue });
      if (highValue) {
        largeRows.push({ userId, day: 30, iapRevenue: 0.3, adRevenue: 0.02, active: true });
      }
    }
    const large = calibrateMonetization(largeRows);

    const smallConfidence = (small.diagnostics as Record<string, any>).correlationConfidence?.retentionConversion ?? 0;
    const largeConfidence = (large.diagnostics as Record<string, any>).correlationConfidence?.retentionConversion ?? 0;
    expect(largeConfidence).toBeGreaterThan(smallConfidence);
  });
});
