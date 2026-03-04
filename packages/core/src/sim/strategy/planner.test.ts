import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { createPlannerStrategy } from "./planner";
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

describe("createPlannerStrategy", () => {
  it("uses injected stepOnce for rollouts and selects best first decision", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };

    const action: Action<number, UnitCode, Vars> = {
      id: "boost",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, state) => state,
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
      netWorth: (_ctx, state) => state.wallet.money,
    };

    let calls = 0;
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 2,
        beamWidth: 2,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          calls += 1;
          const hasDecision = (input.decisions?.length ?? 0) > 0;
          const delta = hasDecision ? 10 : 0;
          const next = {
            ...input.state,
            t: input.state.t + input.dt,
            wallet: {
              ...input.state.wallet,
              money: {
                ...input.state.wallet.money,
                amount: input.state.wallet.money.amount + delta,
              },
            },
            maxMoneyEver: {
              ...input.state.maxMoneyEver,
              amount: Math.max(input.state.maxMoneyEver.amount, input.state.wallet.money.amount + delta),
            },
          };
          return {
            prev: input.state,
            next,
            events: [],
            actionsApplied: hasDecision
              ? [{ t: input.state.t, actionId: input.decisions![0]!.action.id, bulkSize: input.decisions![0]!.bulkSize }]
              : undefined,
            walletDelta: {
              unit: input.state.wallet.money.unit,
              amount: delta,
            },
          };
        },
      },
    );

    const decisions = strategy.decide(ctx, model, makeState(0));

    expect(calls).toBeGreaterThan(0);
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.action.id).toBe("boost");
  });
});
