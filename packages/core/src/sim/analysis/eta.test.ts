import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario } from "../types";
import { etaAnalytic, etaSimulate } from "./eta";

function makeScenario(): CompiledScenario<number, "COIN", Record<string, unknown>> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };

  return {
    ctx: {
      E,
      unit,
      tickPolicy: { mode: "drop" },
      stepSec: 1,
    },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: 1 }),
      actions: () => [],
    },
    initial: {
      t: 0,
      wallet: {
        money: { unit, amount: 0 },
        bucket: 0,
      },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: {},
    },
    run: {
      stepSec: 1,
      durationSec: 100,
    },
  };
}

describe("etaSimulate", () => {
  it("returns first reached time instead of maxDuration", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "3" },
      maxDurationSec: 10,
    });

    expect(out.reached).toBeTrue();
    expect(out.seconds).toBe(3);
  });

  it("returns maxDuration when target is not reached", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "999" },
      maxDurationSec: 10,
    });

    expect(out.reached).toBeFalse();
    expect(out.seconds).toBe(10);
  });

  it("omits run payload by default", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
      maxDurationSec: 10,
    });

    expect(out.mode).toBe("simulate");
    expect(out.run).toBeUndefined();
  });

  it("includes run payload when includeRun=true", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
      maxDurationSec: 10,
      includeRun: true,
    });

    expect(out.mode).toBe("simulate");
    expect(out.run).toBeDefined();
  });

  it("still reports a target reached inside maxSteps", () => {
    const scenario = makeScenario();
    const out = etaSimulate({
      scenario: { ...scenario, run: { ...scenario.run, maxSteps: 5 } },
      target: { kind: "money", value: "3" },
      maxDurationSec: 10,
    });

    expect(out.reached).toBeTrue();
    expect(out.seconds).toBe(3);
  });

  it("rejects a run that maxSteps cut before the target or maxDuration", () => {
    const scenario = makeScenario();
    expect(() =>
      etaSimulate({
        scenario: { ...scenario, run: { ...scenario.run, maxSteps: 5 } },
        target: { kind: "money", value: "999" },
        maxDurationSec: 10,
      }),
    ).toThrow("etaSimulate exceeded maxSteps (5)");
  });

  // At a large t a tick moves t by a rounded amount: 0.1 moves 1e15 by 0.125, and 100 moves 1e18 by 128.
  it.each([
    [0, 0.1],
    [1e9, 0.5],
    [1e15, 0.1],
    [1e18, 100],
  ])("reports simulated seconds, not the t difference, from t=%p with stepSec %p", (t0, stepSec) => {
    const base = makeScenario();
    const out = etaSimulate({
      scenario: {
        ...base,
        ctx: { ...base.ctx, stepSec },
        initial: { ...base.initial, t: t0 },
        run: { ...base.run, stepSec },
      },
      target: { kind: "money", value: String(stepSec * 9.5) },
      maxDurationSec: stepSec * 1000,
    });

    expect(out.reached).toBeTrue();
    expect(out.seconds).toBeCloseTo(stepSec * 10, 9);
  });
});

describe("etaAnalytic", () => {
  it("never includes run payload", () => {
    const out = etaAnalytic({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
    });

    expect(out.mode).toBe("analytic");
    expect(out.run).toBeUndefined();
  });
});

describe("etaAnalytic edges", () => {
  function withIncome(income: number, money = 0) {
    const base = makeScenario();
    const unit = base.ctx.unit;
    return {
      ...base,
      model: { ...base.model, income: () => ({ unit, amount: income }) },
      initial: { ...base.initial, wallet: { ...base.initial.wallet, money: { unit, amount: money } } },
    };
  }

  it("reads suffix notation the way etaSimulate does", () => {
    const out = etaAnalytic({ scenario: withIncome(1), target: { kind: "money", value: "1aa" } });
    const simulated = etaSimulate({ scenario: withIncome(1), target: { kind: "money", value: "1aa" }, maxDurationSec: 5000 });
    expect(out.reached).toBeTrue();
    expect(out.seconds).toBe(simulated.seconds);
  });

  // Each row is a non-finite input that must not read as a reached target.
  it.each([
    ["NaN money", withIncome(1, Number.NaN), "10"],
    ["infinite money", withIncome(1, Number.POSITIVE_INFINITY), "10"],
    ["infinite income", withIncome(Number.POSITIVE_INFINITY), "10"],
    ["NaN income", withIncome(Number.NaN), "10"],
    ["infinite target", withIncome(1), "1e400"],
    ["remaining past the number range", withIncome(1e-300, -1.7e308), "1.7e308"],
  ])("fails closed on %s", (_label, scenario, value) => {
    const out = etaAnalytic({ scenario, target: { kind: "money", value } });
    expect(out.reached).toBeFalse();
    expect(out.seconds).toBe(Number.POSITIVE_INFINITY);
    expect(out.confidence).toBe("low");
  });
});
