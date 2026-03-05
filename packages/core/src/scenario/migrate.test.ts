import { describe, expect, it } from "bun:test";
import { migrateScenarioDocument } from "./migrate";

describe("migrateScenarioDocument", () => {
  it("defaults missing schemaVersion to 1 for scenario-like object", () => {
    const input = {
      unit: { code: "COIN" },
      policy: { mode: "drop" },
      model: { id: "linear", version: 1 },
      initial: { wallet: { unit: "COIN", amount: "0" } },
      clock: { stepSec: 1, durationSec: 10 },
    };
    const out = migrateScenarioDocument(input);
    expect((out.document as any).schemaVersion).toBe(1);
    expect(out.notices.length).toBeGreaterThan(0);
  });

  it("maps legacy ltv block into monetization", () => {
    const input = {
      schemaVersion: 1,
      unit: { code: "COIN" },
      policy: { mode: "drop" },
      model: { id: "linear", version: 1 },
      initial: { wallet: { unit: "COIN", amount: "0" } },
      clock: { stepSec: 1, durationSec: 10 },
      ltv: {
        retention: { d1: 0.4, d7: 0.2, d30: 0.1, d90: 0.05 },
        revenue: { payerConversion: 0.03, arppuDaily: 0.7, adArpDau: 0.02 },
        acquisition: { cpi: 1.8 },
      },
    };

    const out = migrateScenarioDocument(input);
    expect((out.document as any).monetization?.retention?.d1).toBe(0.4);
    expect((out.document as any).monetization?.revenue?.payerConversion).toBe(0.03);
    expect((out.document as any).monetization?.acquisition?.cpi).toBe(1.8);
    expect(out.notices.some((x) => x.path === "ltv")).toBeTrue();
  });
});
