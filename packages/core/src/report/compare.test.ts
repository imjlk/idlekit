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
  for (const [a, b, better] of [
    ["1e400", "1e300", "a"],
    ["-1e400", "-1e300", "b"],
    ["1e-400", "0", "a"],
    ["9007199254740993", "9007199254740992", "a"],
    ["1.0000000000000000001e400", "1e400", "a"],
    [".01e402", "100e398", "tie"],
    ["-0", "0e9999", "tie"],
    ["1e9007199254740993", "1e9007199254740992", "a"],
  ] as const) {
    for (const metric of ["endMoney", "endNetWorth"] as const) {
      it(`orders static ${metric}: ${a} against ${b}`, () => {
        const left = scenario(metric === "endMoney" ? a : "0");
        const right = scenario(metric === "endMoney" ? b : "0");
        const out = compareScenarios({
          a: { ...left, initial: { ...left.initial, maxMoneyEver: a } },
          b: { ...right, initial: { ...right.initial, maxMoneyEver: b } }, metric,
        });
        expect(out.better).toBe(better);
        expect(compareScenarios({ a: scenario(b), b: scenario(a), metric }).better)
          .toBe(better === "tie" ? "tie" : better === "a" ? "b" : "a");
      });
    }
  }

  for (const amount of ["NaN", "Infinity", "1e", "", "0x10"]) {
    it(`rejects invalid static monetary input ${JSON.stringify(amount)}`, () => {
      expect(() => compareScenarios({ a: scenario(amount), b: scenario("1"), metric: "endMoney" }))
        .toThrow(/decimal/i);
    });
  }

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

  it("uses measuredDecision comparator when provided", () => {
    const out = compareScenarios({
      a: scenario("1e3000"),
      b: scenario("1e2000"),
      metric: "endMoney",
      measuredDecision: () => "a",
      measured: {
        a: { endMoney: 3000 },
        b: { endMoney: 2000 },
      },
    });

    expect(out.better).toBe("a");
    expect((out.detail as any).source).toBe("measured");
  });

  it("compares huge scientific notation safely in static fallback", () => {
    const out = compareScenarios({
      a: scenario("1e10000"),
      b: scenario("1e9999"),
      metric: "endMoney",
    });

    expect(out.better).toBe("a");
    expect((out.detail as any).source).toBe("static");
  });
});
