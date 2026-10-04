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

describe("analyzePrestigeCycle scan edges", () => {
  const analyze = (
    scan: { fromSec: number; toSec: number; stepSec: number },
    scenario = makeScenario(),
  ) =>
    analyzePrestigeCycle({ scenario, scan, horizonSec: 3600, cycles: 1, objective: "netWorthPerHour" });

  // Each of these looped forever or ranked a zero-length interval.
  it.each([
    [{ fromSec: 60, toSec: 120, stepSec: 0 }],
    [{ fromSec: 60, toSec: 120, stepSec: -1 }],
    [{ fromSec: 60, toSec: 120, stepSec: Number.NaN }],
    [{ fromSec: 60, toSec: Number.POSITIVE_INFINITY, stepSec: 60 }],
    [{ fromSec: 0, toSec: 120, stepSec: 60 }],
    [{ fromSec: 120, toSec: 60, stepSec: 60 }],
  ])("rejects scan %p", (scan) => {
    expect(() => analyze(scan)).toThrow("analyzePrestigeCycle scan needs finite");
  });

  it("rejects a step below an ulp of the interval", () => {
    expect(() => analyze({ fromSec: 1e18, toSec: 1e18 + 4096, stepSec: 1 })).toThrow(
      "analyzePrestigeCycle scan step 1 cannot advance interval",
    );
  });

  it("refuses a grid too large to run before allocating it", () => {
    expect(() => analyze({ fromSec: 1, toSec: 3600, stepSec: 1e-9 })).toThrow("intervals; the limit is 100000");
  });

  it("keeps toSec when the step does not add up exactly", () => {
    const out = analyze({ fromSec: 0.1, toSec: 0.3, stepSec: 0.1 });
    expect(out.rows.map((row) => row.intervalSec)).toEqual([0.1, 0.2, 0.3]);
  });

  it("does not rank a NaN rate", () => {
    const base = makeScenario();
    const unit = base.ctx.unit;
    let calls = 0;
    // The first interval's worth is NaN; the later ones are finite.
    const scenario = {
      ...base,
      model: { ...base.model, netWorth: (_ctx: unknown, s: { wallet: { money: { amount: number } } }) => ({ unit, amount: calls++ === 0 ? Number.NaN : s.wallet.money.amount }) },
    };
    const out = analyze({ fromSec: 60, toSec: 120, stepSec: 60 }, scenario as typeof base);
    expect(out.rows[0]?.netWorthPerHour).toBe("NaN");
    expect(out.best.intervalSec).toBe(60 * 2);
  });
});
