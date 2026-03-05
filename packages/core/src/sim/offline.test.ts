import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import type { Action, CompiledScenario, Model, SimContext, SimState } from "./types";
import type { Strategy } from "./strategy/types";
import { applyOfflineSeconds } from "./offline";

type U = "COIN";
type Vars = { bought: number };

function makeState(amount: number): SimState<number, U, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { bought: 0 },
  };
}

function makeScenario(args?: {
  initialMoney?: number;
  incomePerSec?: number;
  strategy?: Strategy<number, U, Vars>;
}): CompiledScenario<number, U, Vars> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };

  const ctx: SimContext<number, U, Vars> = {
    E,
    unit,
    tickPolicy: { mode: "drop" },
  };

  const buy: Action<number, U, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => ({ unit, amount: 1 }),
    apply: (_ctx, state) => ({
      ...state,
      vars: { bought: state.vars.bought + 1 },
    }),
  };

  const model: Model<number, U, Vars> = {
    id: "linear",
    version: 1,
    income: () => ({ unit, amount: args?.incomePerSec ?? 0 }),
    actions: () => [buy],
  };

  return {
    ctx,
    model,
    initial: makeState(args?.initialMoney ?? 0),
    strategy: args?.strategy,
    run: {
      stepSec: 1,
      durationSec: 0,
    },
  };
}

describe("applyOfflineSeconds", () => {
  it("simulates full steps + remainder without overshoot", () => {
    const scenario = makeScenario({ incomePerSec: 2, initialMoney: 0 });

    const out = applyOfflineSeconds({
      scenario,
      seconds: 2.5,
    });

    expect(out.offline.fullSteps).toBe(2);
    expect(out.offline.remainderSec).toBeCloseTo(0.5, 8);
    expect(out.offline.simulatedSec).toBeCloseTo(2.5, 8);
    expect(out.end.t).toBeCloseTo(2.5, 8);
    expect(out.end.wallet.money.amount).toBeCloseTo(5, 8);
  });

  it("applies strategy decisions when enabled and can disable them", () => {
    const buyFirst: Strategy<number, U, Vars> = {
      id: "buy-first",
      decide(_ctx, model, state) {
        const buy = model.actions(_ctx, state).find((a) => a.id === "buy");
        return buy ? [{ action: buy }] : [];
      },
    };

    const scenario = makeScenario({ incomePerSec: 0, initialMoney: 2, strategy: buyFirst });

    const withStrategy = applyOfflineSeconds({ scenario, seconds: 2 });
    expect(withStrategy.end.wallet.money.amount).toBe(0);
    expect(withStrategy.end.vars.bought).toBe(2);

    const noStrategy = applyOfflineSeconds({
      scenario,
      seconds: 2,
      options: { useStrategy: false },
    });
    expect(noStrategy.end.wallet.money.amount).toBe(2);
    expect(noStrategy.end.vars.bought).toBe(0);
  });

  it("throws when maxSteps is insufficient", () => {
    const scenario = makeScenario({ incomePerSec: 1 });

    expect(() =>
      applyOfflineSeconds({
        scenario,
        seconds: 10,
        options: { maxSteps: 5 },
      }),
    ).toThrow("offline run exceeded maxSteps");
  });
});
