import { describe, expect, it } from "bun:test";
import { compareScenarios } from "./compare";
import type { ScenarioV1 } from "../scenario/types";

function scenario(amount: string): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount },
    },
    clock: { stepSec: 1, durationSec: 100 },
  };
}

describe("compareScenarios", () => {
  it("uses measured metrics when provided", () => {
    const out = compareScenarios({
      a: scenario("1"),
      b: scenario("999999"),
      metric: "droppedRate",
      measured: {
        a: { droppedRate: 0.01 },
        b: { droppedRate: 0.2 },
      },
    });

    expect(out.better).toBe("a");
    expect((out.detail as any).source).toBe("measured");
  });

  it("falls back to static scores when measured metrics are missing", () => {
    const out = compareScenarios({
      a: scenario("10"),
      b: scenario("20"),
      metric: "endMoney",
    });

    expect(out.better).toBe("b");
    expect((out.detail as any).source).toBe("static");
  });

  it("applies lower-is-better for eta metric", () => {
    const out = compareScenarios({
      a: scenario("10"),
      b: scenario("20"),
      metric: "etaToTargetWorth",
      measured: {
        a: { etaToTargetWorth: 120 },
        b: { etaToTargetWorth: 300 },
      },
    });

    expect(out.better).toBe("a");
  });
});
