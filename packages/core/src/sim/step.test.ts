import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import type { Action, Model, SimContext, SimState } from "./types";
import { stepOnce } from "./step";

type UnitCode = "COIN";
type Vars = { level: number; count: number };

function makeContext(overrides?: Partial<SimContext<number, UnitCode, Vars>>): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    ...overrides,
  };
}

function makeState(amount: number, vars?: Partial<Vars>): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: {
      level: vars?.level ?? 0,
      count: vars?.count ?? 0,
    },
  };
}

describe("stepOnce", () => {
  it("applies cost + action effect + income*dt", () => {
    const ctx = makeContext();

    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 3 }),
      apply: (_ctx, state) => ({
        ...state,
        vars: {
          ...state.vars,
          level: state.vars.level + 1,
        },
      }),
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 2 }),
      actions: () => [action],
    };

    const out = stepOnce({
      ctx,
      model,
      state: makeState(10),
      dt: 5,
      decisions: [{ action }],
    });

    expect(out.next.wallet.money.amount).toBe(17); // 10 - 3 + (2 * 5)
    expect(out.next.vars.level).toBe(1);
    expect(out.next.t).toBe(5);
    expect(out.next.maxMoneyEver.amount).toBe(17);
    expect(out.walletDelta?.amount).toBe(7);

    const appliedAction = out.events.find((e) => e.type === "action.applied");
    expect(appliedAction).toBeDefined();
    const moneyEvent = out.events.find((e) => e.type === "money");
    expect(moneyEvent).toBeDefined();
  });

  it("warns and skips when funds are insufficient", () => {
    const ctx = makeContext({ payment: { onInsufficientFunds: "warn" } });
    let applyCalled = false;

    const action: Action<number, UnitCode, Vars> = {
      id: "expensive",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 2 }),
      apply: (_ctx, state) => {
        applyCalled = true;
        return state;
      },
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };

    const out = stepOnce({
      ctx,
      model,
      state: makeState(1),
      dt: 1,
      decisions: [{ action }],
    });

    expect(applyCalled).toBeFalse();
    expect(out.next.wallet.money.amount).toBe(1);
    expect(out.events.some((e) => e.type === "warning" && e.code === "INSUFFICIENT_FUNDS")).toBeTrue();
    expect(
      out.events.some(
        (e) => e.type === "action.skipped" && e.actionId === "expensive" && e.reason === "insufficientFunds",
      ),
    ).toBeTrue();
  });

  it("respects maxActionsPerStep", () => {
    const ctx = makeContext();

    const mkAction = (id: string): Action<number, UnitCode, Vars> => ({
      id,
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, state) => ({
        ...state,
        vars: {
          ...state.vars,
          count: state.vars.count + 1,
        },
      }),
    });

    const a1 = mkAction("a1");
    const a2 = mkAction("a2");

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [a1, a2],
    };

    const out = stepOnce({
      ctx,
      model,
      state: makeState(0),
      dt: 1,
      decisions: [{ action: a1 }, { action: a2 }],
      constraints: { maxActionsPerStep: 1 },
    });

    expect(out.next.vars.count).toBe(1);
    expect(out.actionsApplied?.length).toBe(1);
    expect(out.actionsApplied?.[0]?.actionId).toBe("a1");
  });

  it("suppresses money events in fast mode when disableMoneyEvents=true", () => {
    const ctx = makeContext();

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const out = stepOnce({
      ctx,
      model,
      state: makeState(0),
      dt: 1,
      fast: { enabled: true, disableMoneyEvents: true },
    });

    expect(out.next.wallet.money.amount).toBe(1);
    expect(out.events.some((e) => e.type === "money")).toBeFalse();
  });
});
