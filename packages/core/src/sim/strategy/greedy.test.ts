import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { createGreedyStrategy } from "./greedy";
import type { Action, Model, SimContext, SimState } from "../types";

type UnitCode = "COIN";
type Vars = Record<string, never>;

function makeState(amount: number): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: {},
  };
}

function makeAction(id: string): Action<number, UnitCode, Vars> {
  return {
    id,
    kind: "buy",
    canApply: () => true,
    cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
    bulk: () => [
      {
        size: 1,
        cost: { unit: { code: "COIN" }, amount: 10 },
        equivalentCost: { unit: { code: "COIN" }, amount: 10 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
    ],
    apply: (_ctx, state) => state,
  };
}

describe("createGreedyStrategy", () => {
  it("uses deterministic tie-break by actionId", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };

    const a = makeAction("a.action");
    const b = makeAction("b.action");

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [b, a], // intentionally shuffled
    };

    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "minPayback",
      maxPicksPerStep: 1,
    });

    const out = strategy.decide(ctx, model, makeState(100));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("a.action");
  });

  it("returns up to maxPicksPerStep decisions", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };

    const a = makeAction("a.action");
    const b = makeAction("b.action");

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [a, b],
    };

    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      maxPicksPerStep: 2,
    });

    const out = strategy.decide(ctx, model, makeState(100));
    expect(out.length).toBe(2);
    expect(out[0]?.action.id).toBe("a.action");
    expect(out[1]?.action.id).toBe("b.action");
  });
});
