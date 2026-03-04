import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { runScenario } from "./simulator";
import type { Action, CompiledScenario, Model, SimContext, SimState } from "./types";
import type { Strategy } from "./strategy/types";

type UnitCode = "COIN";
type Vars = { buys: number };

function makeContext(overrides?: Partial<SimContext<number, UnitCode, Vars>>): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    ...overrides,
  };
}

function makeState(amount: number, t = 0): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: {
      money: { unit: { code: "COIN" }, amount },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { buys: 0 },
  };
}

describe("runScenario", () => {
  it("uses stepOnce order (decisions before income)", () => {
    const ctx = makeContext();

    const buyAction: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 5 }),
      apply: (_ctx, state) => ({
        ...state,
        vars: {
          ...state.vars,
          buys: state.vars.buys + 1,
        },
      }),
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 10 }),
      actions: () => [buyAction],
    };

    const strategy: Strategy<number, UnitCode, Vars> = {
      id: "always-buy",
      decide: () => [{ action: buyAction }],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
        durationSec: 1,
      },
      strategy,
    };

    const run = runScenario(scenario);

    expect(run.end.wallet.money.amount).toBe(10);
    expect(run.end.vars.buys).toBe(0);
    expect(
      run.events.some(
        (e) => e.type === "action.skipped" && e.actionId === "buy" && e.reason === "insufficientFunds",
      ),
    ).toBeTrue();
  });

  it("records trace and actionsLog when enabled", () => {
    const ctx = makeContext();

    const buyAction: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => ({ unit: { code: "COIN" }, amount: 1 }),
      apply: (_ctx, state) => ({
        ...state,
        vars: {
          ...state.vars,
          buys: state.vars.buys + 1,
        },
      }),
    };

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 0 }),
      actions: () => [buyAction],
    };

    const strategy: Strategy<number, UnitCode, Vars> = {
      id: "always-buy",
      decide: () => [{ action: buyAction }],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(5),
      run: {
        stepSec: 1,
        durationSec: 2,
        trace: {
          everySteps: 1,
          keepActionsLog: true,
        },
      },
      strategy,
    };

    const run = runScenario(scenario);

    expect(run.trace?.length).toBe(3); // initial + 2 steps
    expect(run.actionsLog?.length).toBe(2);
    expect(run.actionsLog?.[0]?.actionId).toBe("buy");
    expect(run.end.wallet.money.amount).toBe(3);
    expect(run.end.vars.buys).toBe(2);
  });

  it("scales income by stepSec", () => {
    const ctx = makeContext();

    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 2 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 5,
        durationSec: 10,
      },
    };

    const run = runScenario(scenario);

    // 2/sec * 10 sec total
    expect(run.end.wallet.money.amount).toBe(20);
  });

  it("throws when no stop condition is provided", () => {
    const ctx = makeContext();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
      },
    };

    expect(() => runScenario(scenario)).toThrow("runScenario requires at least one stop condition");
  });

  it("throws when maxSteps is exceeded without meeting stop condition", () => {
    const ctx = makeContext();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
        maxSteps: 3,
      },
    };

    expect(() => runScenario(scenario)).toThrow("runScenario exceeded maxSteps (3)");
  });

  it("can disable event retention while keeping stats", () => {
    const ctx = makeContext();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
        durationSec: 5,
        eventLog: {
          enabled: false,
        },
      },
    };

    const run = runScenario(scenario);
    expect(run.events.length).toBe(0);
    expect(run.stats?.money.applied).toBe(5);
    expect(run.eventLog?.totalSeen).toBeGreaterThan(0);
    expect(run.eventLog?.retained).toBe(0);
  });

  it("retains only latest N events when maxEvents is set", () => {
    const ctx = makeContext();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
        durationSec: 8,
        eventLog: {
          maxEvents: 3,
        },
      },
    };

    const run = runScenario(scenario);
    expect(run.events.length).toBe(3);
    expect(run.eventLog?.retained).toBe(3);
    expect((run.eventLog?.dropped ?? 0) > 0).toBeTrue();
    expect(run.stats?.money.applied).toBe(8);
  });

  it("rejects invalid eventLog.maxEvents", () => {
    const ctx = makeContext();
    const model: Model<number, UnitCode, Vars> = {
      id: "m",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };

    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx,
      model,
      initial: makeState(0),
      run: {
        stepSec: 1,
        durationSec: 1,
        eventLog: {
          maxEvents: -1,
        },
      },
    };

    expect(() => runScenario(scenario)).toThrow("eventLog.maxEvents must be an integer >= 0");
  });
});
