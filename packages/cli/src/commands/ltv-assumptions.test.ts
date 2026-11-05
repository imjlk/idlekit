import { describe, expect, it } from "bun:test";
import type { ScenarioV1 } from "@idlekit/core";
import { reportLtvAssumptions } from "./ltv";

const base = {
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "linear", version: 1 },
  initial: { wallet: { unit: "COIN", amount: "0" } },
  clock: { stepSec: 1, durationSec: 60 },
} as unknown as ScenarioV1;

describe("ltv default assumption report", () => {
  it("flags every value-bearing input when monetization is omitted", () => {
    const report = reportLtvAssumptions(base);
    expect(report.defaulted).toContain("monetization.retention.d1");
    expect(report.defaulted).toContain("monetization.revenue.arppuDaily");
    expect(report.defaulted).toHaveLength(8);
    expect(report.warning).toContain("placeholder assumptions");
  });

  it("lists only the omitted keys for partial monetization", () => {
    const report = reportLtvAssumptions({
      ...base,
      monetization: {
        retention: { d1: 0.4, d7: 0.2, d30: 0.1, d90: 0.05, longTailDailyDecay: 0.01 },
        revenue: { payerConversion: 0.02, adArpDau: 0.01 },
      },
    } as unknown as ScenarioV1);
    expect(report.defaulted).toEqual(["monetization.revenue.arppuDaily"]);
    expect(report.warning).toContain("monetization.revenue.arppuDaily");
  });

  it("reports no warning when every value-bearing input is authored", () => {
    const report = reportLtvAssumptions({
      ...base,
      monetization: {
        retention: { d1: 0.4, d7: 0.2, d30: 0.1, d90: 0.05, longTailDailyDecay: 0.01 },
        revenue: { payerConversion: 0.02, arppuDaily: 0.5, adArpDau: 0.01 },
      },
    } as unknown as ScenarioV1);
    expect(report).toEqual({ defaulted: [], warning: null });
  });
});
