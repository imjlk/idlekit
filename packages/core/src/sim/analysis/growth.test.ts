import { describe, expect, it } from "bun:test";
import { analyzeGrowth } from "./growth";
import { createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario, Model, RunResult, SimState } from "../types";

type UnitCode = "COIN";
type Vars = { owned: number };

function makeState(t: number, money: number, owned: number): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: {
      money: { unit: { code: "COIN" }, amount: money },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount: money },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned },
  };
}

describe("analyzeGrowth", () => {
  it("uses model.netWorth when series=netWorth", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [],
      netWorth: (_ctx, state) => ({ unit: { code: "COIN" }, amount: state.wallet.money.amount + state.vars.owned * 100 }),
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" } },
      model,
      initial: makeState(0, 10, 0),
      run: { stepSec: 1, durationSec: 2 },
    };
    const run: RunResult<number, UnitCode, Vars> = {
      start: makeState(0, 10, 0),
      end: makeState(2, 20, 2),
      events: [],
      trace: [makeState(0, 10, 0), makeState(1, 15, 1), makeState(2, 20, 2)],
    };

    const report = analyzeGrowth({ run, scenario, series: "netWorth", windowSec: 60 });
    expect(report.seriesRequested).toBe("netWorth");
    expect(report.valueSource).toBe("netWorth");
    expect(report.segments.length).toBe(2);
    expect(report.segments[0]?.slope).toBeGreaterThan(0);
  });

  it("requires compiled scenario for netWorth series", () => {
    const run: RunResult<number, UnitCode, Vars> = {
      start: makeState(0, 1, 0),
      end: makeState(1, 2, 0),
      events: [],
      trace: [makeState(0, 1, 0), makeState(1, 2, 0)],
    };

    expect(() => analyzeGrowth({ run, series: "netWorth", windowSec: 60 })).toThrow(
      "analyzeGrowth requires compiled scenario when series='netWorth'",
    );
  });
});
