import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario } from "../types";
import { analyzePrestigeCycle } from "./prestigeCycle";

function makeScenario(maxSteps?: number): CompiledScenario<number, "COIN", Record<string, unknown>> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: 1 }),
      actions: () => [],
    },
    initial: {
      t: 0,
      wallet: { money: { unit, amount: 0 }, bucket: 0 },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: {},
    },
    run: { stepSec: 1, durationSec: 100, ...(maxSteps !== undefined ? { maxSteps } : {}) },
  };
}

describe("analyzePrestigeCycle", () => {
  it("rates each interval over its whole duration", () => {
    const out = analyzePrestigeCycle({
      scenario: makeScenario(),
      scan: { fromSec: 3600, toSec: 3600, stepSec: 1 },
      horizonSec: 3600,
      cycles: 1,
      objective: "netWorthPerHour",
    });

    expect(out.best.netWorthPerHour).toBe("3600");
  });

  it("rejects an interval that maxSteps cut short", () => {
    expect(() =>
      analyzePrestigeCycle({
        scenario: makeScenario(60),
        scan: { fromSec: 3600, toSec: 3600, stepSec: 1 },
        horizonSec: 3600,
        cycles: 1,
        objective: "netWorthPerHour",
      }),
    ).toThrow("analyzePrestigeCycle exceeded maxSteps (60)");
  });
});
