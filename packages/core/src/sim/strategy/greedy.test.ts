import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine, type Decimal } from "../../engine/breakInfinity";
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

  it("does not let an invalid-only action outrank a settleable action", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const invalid: Action<number, UnitCode, Vars> = {
      id: "invalid",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 2.5,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const settleable: Action<number, UnitCode, Vars> = {
      id: "settleable",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
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
      actions: () => [invalid, settleable],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("settleable");
    const onlyInvalid = strategy.decide(ctx, { ...model, actions: () => [invalid] }, makeState(0));
    expect(onlyInvalid.length).toBe(1);
    expect(onlyInvalid[0]?.bulkSize).toBe(2.5);
  });

  it("does not let an unsettled size-one cost outrank a settleable action", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const unsettled: Action<number, UnitCode, Vars> = {
      id: "unsettled",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: -5 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const settleable: Action<number, UnitCode, Vars> = {
      id: "settleable",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
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
      actions: () => [unsettled, settleable],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "size1" },
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("settleable");
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

  it("does not fall back to a bulk quote in size1 mode when the size-1 cost is rejected", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      // A modelling mistake: the action cost is in another unit.
      cost: () => ({ unit: { code: "GEM" as UnitCode }, amount: 10 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 10 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 10,
          cost: { unit: { code: "COIN" }, amount: 100 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 10 },
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
      bulk: { mode: "size1" },
    });
    const out = strategy.decide(ctx, model, makeState(1000));
    expect(out.every((decision) => decision.bulkSize !== 10)).toBe(true);
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

  it("keeps a unique size when a higher size is repeated by an invalid quote", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const quotes: BulkQuote<number, UnitCode>[] = [
      {
        size: 2,
        cost: null,
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
      {
        size: 10,
        cost: null,
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
      },
      {
        size: 10,
        cost: { unit: { code: "COIN" }, amount: -1 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
      },
    ];
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => quotes,
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const ranked = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const rankedOut = ranked.decide(ctx, model, makeState(0));
    expect(rankedOut.length).toBe(1);
    expect(rankedOut[0]?.bulkSize).toBe(2);
    const capped = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const cappedOut = capped.decide(ctx, model, makeState(0));
    expect(cappedOut.length).toBe(1);
    expect(cappedOut[0]?.bulkSize).toBe(2);
  });

  it("ignores a maxAffordable quote that omits its amount", () => {
    const engine = createBreakInfinityEngine();
    const ctx: SimContext<Decimal, UnitCode, Vars> = {
      E: engine,
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const wallet = engine.from(20);
    const state: SimState<Decimal, UnitCode, Vars> = {
      t: 0,
      wallet: { money: { unit: { code: "COIN" }, amount: wallet }, bucket: engine.zero() },
      maxMoneyEver: { unit: { code: "COIN" }, amount: wallet },
      prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
      vars: {},
    };
    const quotes = [
      {
        size: 2,
        cost: { unit: { code: "COIN" as const }, amount: engine.from(1) },
        deltaIncomePerSec: { unit: { code: "COIN" as const }, amount: engine.from(1) },
      },
      {
        size: 10,
        cost: { unit: { code: "COIN" as const } },
        deltaIncomePerSec: { unit: { code: "COIN" as const }, amount: engine.from(9) },
      },
    ] as unknown as BulkQuote<Decimal, UnitCode>[];
    const action: Action<Decimal, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => quotes,
      apply: (_ctx, current) => current,
    };
    const model: Model<Decimal, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: engine.zero() }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<Decimal, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, state);
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("uses Action.cost when maxAffordable checks a size of one", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const expensiveQuotes: BulkQuote<number, UnitCode>[] = [
      {
        size: 1,
        cost: null,
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 100 },
      },
    ];
    const expensive: Action<number, UnitCode, Vars> = {
      id: "expensive",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
      bulk: () => expensiveQuotes,
      apply: (_ctx, current) => current,
    };
    const cheap: Action<number, UnitCode, Vars> = {
      id: "cheap",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 1,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, current) => current,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [expensive, cheap],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("cheap");
    const mixedQuotes: BulkQuote<number, UnitCode>[] = [
      {
        size: 1,
        cost: null,
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 100 },
      },
      {
        size: 2,
        cost: null,
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
    ];
    const mixed: Action<number, UnitCode, Vars> = {
      ...expensive,
      id: "mixed",
      bulk: () => mixedQuotes,
    };
    const sized = strategy.decide(ctx, { ...model, actions: () => [mixed] }, makeState(0));
    expect(sized.length).toBe(1);
    expect(sized[0]?.bulkSize).toBe(2);
  });

  it("scores maxAffordable size one with Action.cost", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const advertised: Action<number, UnitCode, Vars> = {
      id: "advertised",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 100 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const priced: Action<number, UnitCode, Vars> = {
      id: "priced",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
      bulk: () => [
        {
          size: 2,
          cost: { unit: { code: "COIN" }, amount: 10 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [advertised, priced],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "minPayback",
      payback: { useEquivalentCost: false },
      bulk: { mode: "maxAffordable" },
    });
    const out = strategy.decide(ctx, model, makeState(1000));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("priced");
  });

  it("ranks a size of one with Action.cost", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    const quotes: BulkQuote<number, UnitCode>[] = [
      {
        size: 1,
        cost: { unit: { code: "COIN" }, amount: 1 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
      {
        size: 2,
        cost: { unit: { code: "COIN" }, amount: 10 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
    ];
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 100 }),
      bulk: () => quotes,
      apply: (_ctx, current) => current,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [action],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "minPayback",
      payback: { useEquivalentCost: false },
    });
    const out = strategy.decide(ctx, model, makeState(1000));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("does not price a single buy for a bulk-only quote list", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    let costCalls = 0;
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => {
        costCalls += 1;
        throw new Error("single cost");
      },
      bulk: () => [
        {
          size: 2,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 3 },
        },
        {
          size: 4,
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
    expect(costCalls).toBe(0);
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("prices a size-1 quote from Action.cost and an empty list once", () => {
    const ctx: SimContext<number, UnitCode, Vars> = {
      E: createNumberEngine(),
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" },
    };
    let costCalls = 0;
    const priced: Action<number, UnitCode, Vars> = {
      id: "priced",
      kind: "buy",
      canApply: () => true,
      cost: () => {
        costCalls += 1;
        return { unit: { code: "COIN" }, amount: 5 };
      },
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [priced],
    };
    const strategy = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
    });
    const pricedOut = strategy.decide(ctx, model, makeState(20));
    expect(costCalls).toBe(1);
    expect(pricedOut.length).toBe(1);
    expect(pricedOut[0]?.bulkSize).toBeUndefined();
    costCalls = 0;
    const empty: Action<number, UnitCode, Vars> = {
      ...priced,
      id: "empty",
      bulk: () => [],
    };
    const emptyOut = strategy.decide(ctx, { ...model, actions: () => [empty] }, makeState(20));
    expect(costCalls).toBe(1);
    expect(emptyOut).toEqual([]);
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
