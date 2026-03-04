import { describe, expect, it } from "bun:test";
import { validateScenarioV1 } from "./validate";
import type { ScenarioV1 } from "./types";

function baseScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "0" },
    },
    clock: {
      stepSec: 1,
      durationSec: 60,
    },
  };
}

describe("validateScenarioV1 clock stop conditions", () => {
  it("accepts scenario with positive durationSec", () => {
    const out = validateScenarioV1(baseScenario());
    expect(out.ok).toBeTrue();
  });

  it("accepts scenario with untilExpr and no durationSec", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
        untilExpr: "t >= 10",
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeTrue();
  });

  it("rejects scenario without durationSec and untilExpr", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "clock")).toBeTrue();
  });

  it("rejects non-positive durationSec", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
        durationSec: 0,
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "clock.durationSec")).toBeTrue();
  });
});
