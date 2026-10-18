import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../../../engine/breakInfinity";
import { finiteAmountLog10 } from "../finiteAmountLog10";
import { builtinObjectiveFactories } from "./builtins";

function getFactory(id: string) {
  const f = builtinObjectiveFactories.find((x) => x.id === id);
  if (!f) throw new Error(`missing objective factory: ${id}`);
  return f;
}

function makeScenarioAndRun() {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };

  const scenario: any = {
    ctx: { E, unit },
    model: {
      netWorth: (_ctx: any, s: any) => ({ unit, amount: s.wallet.money.amount + (s.vars?.bonus ?? 0) }),
    },
  };

  const run: any = {
    start: {
      t: 0,
      wallet: { money: { unit, amount: 10 } },
      vars: { bonus: 0 },
    },
    end: {
      t: 3600,
      wallet: { money: { unit, amount: 1000 } },
      vars: { bonus: 0 },
    },
    stats: {
      money: { droppedRate: 0.05 },
      actions: { applied: 120 },
    },
  };

  return { scenario, run };
}

describe("builtinObjectiveFactories", () => {
  for (const id of ["endMoneyLog10", "endNetWorthLog10", "netWorthPerHourLog10", "growthLog10PerHour", "pacingBalancedLog10", "etaToTargetWorthNegSec"]) {
    for (const amount of [Infinity, -Infinity, NaN]) {
      it(`${id} refuses non-finite money ${amount}`, () => {
        const args = makeScenarioAndRun();
        args.run.end.wallet.money.amount = amount;
        expect(() => getFactory(id).create({}).score(args)).toThrow(/finite/i);
      });
    }
  }

  it("keeps the documented zero-money floor", () => {
    const args = makeScenarioAndRun();
    args.run.end.wallet.money.amount = 0;
    expect(getFactory("endMoneyLog10").create({}).score(args)).toBe(-300);
  });

  it("never ranks zero money above a positive amount below the floor", () => {
    const score = (E: Parameters<typeof finiteAmountLog10>[0], text: string) => finiteAmountLog10(E, (E as any).from(text));
    for (const E of [createNumberEngine(), createBreakInfinityEngine()]) {
      const zero = score(E, "0");
      expect(zero).toBe(-300);
      // 1e-310 is a Number subnormal; breakInfinity keeps 1e-400 and 1e-9000 as positive amounts.
      const ladder = ["1e-310", "1e-301", "1e-300", "1e-299", "1", "1e300"].map((text) => score(E, text));
      for (const value of ladder) expect(value).toBeGreaterThanOrEqual(zero);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]!);
      expect(ladder[3]).toBeGreaterThan(zero);
    }
    const big = createBreakInfinityEngine();
    expect(score(big, "1e-400")).toBe(-300);
    expect(score(big, "1e-9000")).toBe(-300);
    // The score reads magnitude only, so a negative amount scores as its absolute value.
    expect(score(big, "-1e10")).toBe(10);
  });

  it("includes new level-design KPI objectives", () => {
    const ids = new Set(builtinObjectiveFactories.map((x) => x.id));
    expect(ids.has("growthLog10PerHour")).toBeTrue();
    expect(ids.has("etaToTargetWorthNegSec")).toBeTrue();
    expect(ids.has("pacingBalancedLog10")).toBeTrue();
  });

  it("scores etaToTargetWorthNegSec with penalty when target is not reached", () => {
    const { scenario, run } = makeScenarioAndRun();
    const objective = getFactory("etaToTargetWorthNegSec").create({
      targetWorth: "1e9",
      unreachedPenaltySec: 123456,
    });

    const score = objective.score({ scenario, run });
    expect(score).toBe(-123456);
  });

  it("scores pacingBalancedLog10 lower when droppedRate is high", () => {
    const { scenario, run } = makeScenarioAndRun();
    const objective = getFactory("pacingBalancedLog10").create({
      targetActionsPerHour: 120,
      actionRateWeight: 1,
      droppedRateWeight: 2,
    });

    const baseline = objective.score({ scenario, run });
    const highDrop = objective.score({
      scenario,
      run: {
        ...run,
        stats: {
          ...run.stats,
          money: { droppedRate: 0.8 },
        },
      },
    });

    expect(highDrop).toBeLessThan(baseline);
  });
});
