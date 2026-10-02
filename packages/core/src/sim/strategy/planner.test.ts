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

function makeContext(stepSec?: number): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    stepSec,
  };
}

describe("createPlannerStrategy", () => {
  it("uses injected stepOnce for rollouts and selects best first decision", () => {
    const ctx = makeContext();

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

  it("uses ctx.stepSec as preview dt", () => {
    const ctx = makeContext(5);

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

    const dts: number[] = [];
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 2,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          dts.push(input.dt);
          return {
            prev: input.state,
            next: {
              ...input.state,
              t: input.state.t + input.dt,
            },
            events: [],
          };
        },
      },
    );

    strategy.decide(ctx, model, makeState(0));

    expect(dts.length).toBeGreaterThan(0);
    expect(dts.every((x) => x === 5)).toBeTrue();
  });

  it("uses score-ranked branching before maxBranchingActions cutoff", () => {
    const ctx = makeContext(1);

    const low: Action<number, UnitCode, Vars> = {
      id: "a.low",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 100 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 100 },
          equivalentCost: { unit: { code: "COIN" }, amount: 100 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
      ],
      apply: (_ctx, state) => state,
    };

    const high: Action<number, UnitCode, Vars> = {
      id: "z.high",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 1 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: 1 },
          equivalentCost: { unit: { code: "COIN" }, amount: 1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 100 },
        },
      ],
      apply: (_ctx, state) => state,
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [low, high],
      netWorth: (_ctx, state) => state.wallet.money,
    };

    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        maxBranchingActions: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          const actionId = input.decisions?.[0]?.action.id;
          const delta = actionId === "z.high" ? 100 : actionId === "a.low" ? 1 : 0;
          return {
            prev: input.state,
            next: {
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
            },
            events: [],
          };
        },
      },
    );

    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.action.id).toBe("z.high");
  });

  it("keeps a settleable quote when a higher-scoring quote cannot settle", () => {
    const ctx = makeContext(1);
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      bulk: () => [
        {
          size: 2,
          cost: null,
          equivalentCost: { unit: { code: "COIN" }, amount: 2 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
        },
        {
          size: 2.5,
          cost: null,
          equivalentCost: { unit: { code: "COIN" }, amount: 1 },
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          const decided = (input.decisions?.length ?? 0) > 0;
          const delta = decided ? 10 : 0;
          return {
            prev: input.state,
            next: {
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
            },
            events: [],
          };
        },
      },
    );
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("keeps a settleable bulk quote when size 1 would pay a non-finite action cost", () => {
    const ctx = makeContext(1);
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: Number.NaN }),
      bulk: () => [
        {
          size: 1,
          cost: null,
          equivalentCost: { unit: { code: "COIN" }, amount: 1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
        {
          size: 2,
          cost: null,
          equivalentCost: { unit: { code: "COIN" }, amount: 2 },
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("keeps a unique bulk size when a higher size is repeated by an invalid quote", () => {
    const ctx = makeContext(1);
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
          size: 10,
          cost: null,
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
        {
          size: 10,
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    const out = strategy.decide(ctx, model, makeState(0));
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("does not price a single buy for a bulk-only quote list", () => {
    const ctx = makeContext(1);
    let costCalls = 0;
    let equivalentCalls = 0;
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => {
        costCalls += 1;
        throw new Error("single cost");
      },
      equivalentCost: () => {
        equivalentCalls += 1;
        return { unit: { code: "COIN" }, amount: 1 };
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    const out = strategy.decide(ctx, model, makeState(0));
    expect(costCalls).toBe(0);
    expect(equivalentCalls).toBe(0);
    expect(out.length).toBe(1);
    expect(out[0]?.bulkSize).toBe(2);
  });

  it("prices a size-1 quote and an empty bulk list from Action.cost", () => {
    const ctx = makeContext(1);
    let costCalls = 0;
    let equivalentCalls = 0;
    const priced: Action<number, UnitCode, Vars> = {
      id: "priced",
      kind: "buy",
      canApply: () => true,
      cost: () => {
        costCalls += 1;
        return { unit: { code: "COIN" }, amount: 5 };
      },
      equivalentCost: () => {
        equivalentCalls += 1;
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    const pricedOut = strategy.decide(ctx, model, makeState(20));
    expect(costCalls).toBe(1);
    expect(equivalentCalls).toBe(0);
    expect(pricedOut[0]?.bulkSize).toBeUndefined();
    costCalls = 0;
    const empty: Action<number, UnitCode, Vars> = { ...priced, id: "empty", bulk: () => [] };
    const emptyOut = strategy.decide(ctx, { ...model, actions: () => [empty] }, makeState(20));
    expect(costCalls).toBe(1);
    expect(equivalentCalls).toBe(1);
    expect(emptyOut[0]?.bulkSize).toBeUndefined();
  });

  it("does not revive a size-1 quote that settlement already rejected", () => {
    const ctx = makeContext(1);
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: Number.NaN }),
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
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
        bulk: { mode: "size1" },
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    expect(strategy.decide(ctx, model, makeState(0))).toEqual([]);
    const valid: Action<number, UnitCode, Vars> = {
      ...action,
      id: "valid",
      cost: () => null,
    };
    const chosen = strategy.decide(ctx, { ...model, actions: () => [valid] }, makeState(0));
    expect(chosen.length).toBe(1);
    expect(chosen[0]?.bulkSize).toBeUndefined();
  });

  it("does not roll out an action whose quotes cannot settle", () => {
    const ctx = makeContext(1);
    const invalid: Action<number, UnitCode, Vars> = {
      id: "invalid",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: -1 }),
      bulk: () => [
        {
          size: 1,
          cost: { unit: { code: "COIN" }, amount: -1 },
          deltaIncomePerSec: { unit: { code: "COIN" }, amount: 9 },
        },
      ],
      apply: (_ctx, state) => state,
    };
    const valid: Action<number, UnitCode, Vars> = {
      id: "valid",
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
      actions: () => [invalid],
      netWorth: (_ctx, state) => state.wallet.money,
    };
    const strategy = createPlannerStrategy<number, UnitCode, Vars>(
      {
        schemaVersion: 1,
        horizonSteps: 1,
        beamWidth: 1,
        objective: "maximizeNetWorthAtEnd",
      },
      {
        stepOnce(input) {
          return { prev: input.state, next: input.state, events: [] };
        },
      },
    );
    expect(strategy.decide(ctx, model, makeState(0))).toEqual([]);
    const mixed = strategy.decide(ctx, { ...model, actions: () => [invalid, valid] }, makeState(0));
    expect(mixed.length).toBe(1);
    expect(mixed[0]?.action.id).toBe("valid");
    const nullable = {
      ...valid,
      id: "nullable",
      bulk: () => null as unknown as ReturnType<NonNullable<Action<number, UnitCode, Vars>["bulk"]>>,
    };
    expect(() =>
      strategy.decide(ctx, { ...model, actions: () => [nullable] }, makeState(0)),
    ).not.toThrow();
  });

  it("throws when minTimeToTargetWorth has invalid targetWorth", () => {
    const ctx = makeContext();

    const action: Action<number, UnitCode, Vars> = {
      id: "noop",
      kind: "custom",
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

    const strategy = createPlannerStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      horizonSteps: 2,
      objective: "minTimeToTargetWorth",
      targetWorth: "invalid-worth",
    });

    expect(() => strategy.decide(ctx, model, makeState(0))).toThrow();
  });
});
