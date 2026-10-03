import { describe, expect, it } from "bun:test";
import { createNumberEngine, simulateSessionPattern, type CompiledScenario, type SimState } from "@idlekit/core";
import { analyzePerceivedProgression } from "./experience";

type Vars = { bought: number };

function scenario(trace?: CompiledScenario<number, "COIN", Vars>["run"]["trace"]): CompiledScenario<number, "COIN", Vars> {
  const initial: SimState<number, "COIN", Vars> = {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount: 0 }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { bought: 0 },
  };
  return {
    ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 1 },
    model: {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [
        {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => null,
          apply: (_ctx, state) => ({ ...state, vars: { bought: state.vars.bought + 1 } }),
        },
      ],
    },
    strategy: { id: "buy", decide: (ctx, model, state) => model.actions(ctx, state).map((action) => ({ action })) },
    initial,
    run: { stepSec: 1, durationSec: 1, ...(trace ? { trace } : {}) },
  };
}

describe("analyzePerceivedProgression", () => {
  it("does not report a budget-cut session trace as quiet play", () => {
    const pattern = { id: "offline-heavy" as const, days: 1 };
    const full = scenario();
    const report = analyzePerceivedProgression({
      scenario: full,
      session: simulateSessionPattern({ scenario: full, pattern, seed: 1 }),
      series: "money",
    });
    expect(report.activeSeconds).toBe(300);
    expect(report.visibleChangeCount).toBeGreaterThan(0);

    // A budget keeps the session's memory bounded. The per-step metrics cannot be read from it.
    for (const trace of [{ maxPoints: 0 }, { maxPoints: 5 }, { maxActions: 1 }]) {
      const capped = scenario(trace);
      const session = simulateSessionPattern({ scenario: capped, pattern, seed: 1 });
      expect(() => analyzePerceivedProgression({ scenario: capped, session, series: "money" })).toThrow(
        "perceived progression needs every active step",
      );
    }
  });
});
