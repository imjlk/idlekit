import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { createGreedyStrategy } from "./greedy";
import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { Strategy } from "./types";

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

  it("keeps the smaller positive quote when a larger quote has a negative cost", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
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
        {
          size: 5,
          cost: { unit: { code: "COIN" }, amount: -1 },
          equivalentCost: { unit: { code: "COIN" }, amount: -1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 5 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(20));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("buy");
    expect(out[0]?.bulkSize).toBeUndefined();
  });

  it("keeps an integer quote when a later free quote has a fractional size", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 2.5,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 2 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("ranks a settleable quote ahead of a higher-scoring invalid quote", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 2.5,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 5 },
        },
        {
          size: 3,
          cost: { unit: { code: "COIN" }, amount: -1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("ranks a settleable quote ahead of a cost that has no unit", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 3,
          cost: { amount: 1 } as BulkQuote<number, UnitCode>["cost"],
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("ranks a valid bulk quote ahead of a size-1 quote with a negative action cost", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: -1 }),
      bulk: () => [
        {
          size: 1,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(100));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("keeps a size-1 quote when its quote cost is negative and the action cost can settle", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: -1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(100));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBeUndefined();
  });

  it("keeps an unaffordable size-1 quote ahead of a lower-scoring bulk quote", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
      bulk: () => [
        {
          size: 1,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBeUndefined();
  });

  it("still emits a lone size-1 quote when the action cost cannot settle", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: Number.NaN }),
      bulk: () => [
        {
          size: 1,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(100));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBeUndefined();
  });

  it("keeps the smaller affordable quote when a larger size is duplicated", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        { size: 2, cost: null, deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 } },
        { size: 10, cost: null, deltaIncomePerSec: { unit: { code: "COIN" }, amount: 4 } },
        { size: 10, cost: null, deltaIncomePerSec: { unit: { code: "COIN" }, amount: 4 } },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("keeps a smaller affordable quote when a larger cost is omitted", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
      bulk: () => [
        {
          size: 2,
          cost: { unit: { code: "COIN" }, amount: 10 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 10,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 4 },
        } as unknown as BulkQuote<number, UnitCode>,
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(20));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("accepts occurrence on a contextually typed decision", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action = makeAction("buy");
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy: Strategy<number, UnitCode, Vars> = {
      id: "custom",
      decide: () => [{ action, occurrence: 0 }],
    };
    expect(strategy.decide(ctx, model, makeState(20))[0]?.occurrence).toBe(0);
  });
});
