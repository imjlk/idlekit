import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../../../engine/breakInfinity";
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
