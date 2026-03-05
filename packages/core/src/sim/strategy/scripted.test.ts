import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { createScriptedStrategy } from "./scripted";
import type { Action, Model, SimContext, SimState } from "../types";

type UnitCode = "COIN";
type Vars = Record<string, never>;

function makeState(): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount: 100 },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 100 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: {},
  };
}

function makeAction(id: string): Action<number, UnitCode, Vars> {
  return {
    id,
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, state) => state,
  };
}

describe("createScriptedStrategy", () => {
  const ctx: SimContext<number, UnitCode, Vars> = {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
  };

  const model: Model<number, UnitCode, Vars> = {
    id: "m",
    version: 1,
    income: () => ({ unit: { code: "COIN" }, amount: 0 }),
    actions: () => [makeAction("a"), makeAction("b")],
  };

  it("can snapshot and restore cursor for deterministic resume", () => {
    const strategy = createScriptedStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      program: [{ actionId: "a" }, { actionId: "b" }],
      loop: true,
    });

    const first = strategy.decide(ctx, model, makeState());
    expect(first[0]?.action.id).toBe("a");

    const snapshot = strategy.snapshotState?.();
    expect((snapshot as Record<string, unknown>)?.cursor).toBe(1);

    const second = strategy.decide(ctx, model, makeState());
    expect(second[0]?.action.id).toBe("b");

    const resumed = createScriptedStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      program: [{ actionId: "a" }, { actionId: "b" }],
      loop: true,
    });
    resumed.restoreState?.(snapshot);
    const resumedNext = resumed.decide(ctx, model, makeState());

    expect(resumedNext[0]?.action.id).toBe("b");
  });

  it("rejects invalid cursor state", () => {
    const strategy = createScriptedStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      program: [{ actionId: "a" }],
      loop: true,
    });

    expect(() => strategy.restoreState?.("bad")).toThrow("scripted strategy state must be an object");
    expect(() => strategy.restoreState?.({ cursor: -1 })).toThrow(
      "scripted strategy state cursor must be an integer >= 0",
    );
  });
});
