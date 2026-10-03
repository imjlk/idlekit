import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import type { Action, CompiledScenario, Model, SimContext, SimState } from "./types";
import type { Strategy } from "./strategy/types";
import { applyOfflineSeconds } from "./offline";
import { createScriptedStrategy } from "./strategy/scripted";

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
    expect(out.offline.preDecaySec).toBeCloseTo(2.5, 8);
    expect(out.offline.effectiveSec).toBeCloseTo(2.5, 8);
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

  it("stops at the step budget instead of throwing the partial run away", () => {
    const scenario = makeScenario({ incomePerSec: 1 });

    const out = applyOfflineSeconds({
      scenario,
      seconds: 10,
      options: { maxSteps: 5 },
    });

    expect(out.stop?.reason).toBe("budget");
    expect(out.stop?.steps).toBe(5);
    expect(out.end.t).toBe(5);
    expect(out.offline.effectiveSec).toBe(10);
    expect(out.offline.simulatedSec).toBe(5);
    expect(out.offline.fullSteps).toBe(10);
  });

  it("applies clamp policy from scenario.run.offline", () => {
    const scenario = {
      ...makeScenario({ incomePerSec: 2 }),
      run: {
        ...makeScenario({ incomePerSec: 2 }).run,
        offline: {
          maxSec: 5,
          overflowPolicy: "clamp" as const,
        },
      },
    };

    const out = applyOfflineSeconds({
      scenario,
      seconds: 10,
    });

    expect(out.offline.overflow).toBe("clamped");
    expect(out.offline.preDecaySec).toBe(5);
    expect(out.offline.effectiveSec).toBe(5);
    expect(out.end.t).toBe(5);
  });

  it("rejects overflow when policy is reject", () => {
    const scenario = {
      ...makeScenario({ incomePerSec: 1 }),
      run: {
        ...makeScenario({ incomePerSec: 1 }).run,
        offline: {
          maxSec: 5,
          overflowPolicy: "reject" as const,
        },
      },
    };

    expect(() =>
      applyOfflineSeconds({
        scenario,
        seconds: 6,
      }),
    ).toThrow("offline seconds exceed policy maxSec");
  });

  it("applies linear decay ratio", () => {
    const scenario = {
      ...makeScenario({ incomePerSec: 1 }),
      run: {
        ...makeScenario({ incomePerSec: 1 }).run,
        offline: {
          maxSec: 10,
          overflowPolicy: "clamp" as const,
          decay: {
            kind: "linear" as const,
            floorRatio: 0.2,
          },
        },
      },
    };

    const out = applyOfflineSeconds({
      scenario,
      seconds: 10,
    });

    expect(out.offline.decay.kind).toBe("linear");
    expect(out.offline.decay.ratio).toBeCloseTo(0.2, 8);
    expect(out.offline.effectiveSec).toBeCloseTo(2, 8);
    expect(out.end.t).toBeCloseTo(2, 8);
  });

  it("keeps a direct cap on reward time and can refuse offline actions", () => {
    const scenario = {
      ...makeScenario({ incomePerSec: 1, initialMoney: 4 }),
      run: {
        ...makeScenario({ incomePerSec: 1, initialMoney: 4 }).run,
        offline: { maxSec: 5, overflowPolicy: "clamp" as const, actions: { mode: "none" as const } },
      },
      strategy: {
        id: "buy-first",
        decide(_ctx: SimContext<number, U, Vars>, model: Model<number, U, Vars>, state: SimState<number, U, Vars>) {
          const buy = model.actions(_ctx, state).find((action) => action.id === "buy");
          return buy ? [{ action: buy }] : [];
        },
      } satisfies Strategy<number, U, Vars>,
    };
    const out = applyOfflineSeconds({ scenario, seconds: 12 * 3600 });
    expect(out.offline.requestedSec).toBe(12 * 3600);
    expect(out.offline.effectiveSec).toBe(5);
    expect(out.end.t).toBe(5);
    expect(out.end.vars.bought).toBe(0);
    expect(out.offline.actionPolicy).toBe("none");
  });

  it("reports no strategy use when the scenario has no strategy", () => {
    const scenario = makeScenario({ initialMoney: 5 });
    const allow = applyOfflineSeconds({
      scenario,
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(allow.offline.usedStrategy).toBe(false);
    expect(allow.offline.actionPolicy).toBe("allow");
    const legacy = applyOfflineSeconds({ scenario, seconds: 3, options: { useStrategy: true } });
    expect(legacy.offline.usedStrategy).toBe(false);
  });

  it("does not roll back a strategy that returned nothing under allow", () => {
    const strategy = createScriptedStrategy<number, U, Vars>({
      schemaVersion: 1,
      loop: false,
      program: [{ actionId: "unlock-later" }, { actionId: "buy" }],
    });
    const scenario = makeScenario({ initialMoney: 5, strategy });
    const out = applyOfflineSeconds({
      scenario,
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(out.end.vars.bought).toBe(1);
    expect(strategy.snapshotState?.()).toEqual({ cursor: 2 });
  });

  it("restores a rejected batch when snapshotState returns the live state object", () => {
    let internal = { cursor: 0 };
    const strategy: Strategy<number, U, Vars> = {
      id: "aliased",
      decide(ctx, model, state) {
        internal.cursor += 1;
        const buy = model.actions(ctx, state).find((action) => action.id === "buy")!;
        return [{ action: { ...buy, id: "reset", kind: "prestige" } }];
      },
      snapshotState: () => internal,
      restoreState: (saved) => {
        internal = saved as { cursor: number };
      },
    };
    const out = applyOfflineSeconds({
      scenario: makeScenario({ initialMoney: 5, strategy }),
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(out.end.prestige.count).toBe(0);
    expect(internal.cursor).toBe(0);
  });

  it("restores a rejected batch when the snapshot pair saves undefined", () => {
    let cursor: number | undefined;
    const strategy: Strategy<number, U, Vars> = {
      id: "lazy",
      decide(ctx, model, state) {
        cursor = (cursor ?? 0) + 1;
        const buy = model.actions(ctx, state).find((action) => action.id === "buy")!;
        return [{ action: { ...buy, id: "reset", kind: "prestige" } }];
      },
      snapshotState: () => cursor,
      restoreState: (saved) => {
        cursor = saved as number | undefined;
      },
    };
    const out = applyOfflineSeconds({
      scenario: makeScenario({ initialMoney: 5, strategy }),
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(out.end.prestige.count).toBe(0);
    expect(cursor).toBeUndefined();
  });

  it("applies the listed part of a mixed allow batch without restoring", () => {
    let calls = 0;
    const strategy: Strategy<number, U, Vars> = {
      id: "mixed",
      decide(ctx, model, state) {
        calls += 1;
        if (calls > 1) return [];
        const buy = model.actions(ctx, state).find((action) => action.id === "buy")!;
        return [{ action: { ...buy, id: "reset", kind: "prestige" } }, { action: buy }];
      },
      snapshotState: () => ({ calls }),
      restoreState: (saved) => {
        calls = (saved as { calls: number }).calls;
      },
    };
    const out = applyOfflineSeconds({
      scenario: makeScenario({ initialMoney: 5, strategy }),
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(out.end.vars.bought).toBe(1);
    expect(out.end.prestige.count).toBe(0);
    expect(calls).toBe(3);
  });

  it("checks the actor filter against the action a later buy re-resolves to", () => {
    // The first hire hands later hires to the player.
    const base = makeScenario({ initialMoney: 5 });
    const model: Model<number, U, Vars> = {
      ...base.model,
      actions: (ctx, state) =>
        base.model.actions(ctx, state).map((action) => ({
          ...action,
          id: "hire",
          actor: state.vars.bought === 0 ? ("automation" as const) : ("player" as const),
        })),
    };
    const strategy: Strategy<number, U, Vars> = {
      id: "hire-twice",
      decide(ctx, model, state) {
        const hire = model.actions(ctx, state).find((action) => action.id === "hire")!;
        return [{ action: hire }, { action: hire }];
      },
    };
    const out = applyOfflineSeconds({
      scenario: { ...base, model, strategy },
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"], actors: ["automation"] } },
    });
    expect(out.end.vars.bought).toBe(1);
    expect(out.actionsLog?.map((row) => row.actionId)).toEqual(["hire"]);
  });

  it("restores a batch the actor filter rejects only at re-resolution", () => {
    // Each enumeration flips the actor, so the strategy sees automation and the step sees player.
    const base = makeScenario({ initialMoney: 5 });
    let enumerations = 0;
    const model: Model<number, U, Vars> = {
      ...base.model,
      actions: (ctx, state) => {
        enumerations += 1;
        const actor = enumerations % 2 === 1 ? ("automation" as const) : ("player" as const);
        return base.model.actions(ctx, state).map((action) => ({ ...action, actor }));
      },
    };
    let cursor = 0;
    const strategy: Strategy<number, U, Vars> = {
      id: "cursor",
      decide(ctx, model, state) {
        cursor += 1;
        return [{ action: model.actions(ctx, state).find((action) => action.id === "buy")! }];
      },
      snapshotState: () => ({ cursor }),
      restoreState: (saved) => {
        cursor = (saved as { cursor: number }).cursor;
      },
    };
    const out = applyOfflineSeconds({
      scenario: { ...base, model, strategy },
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"], actors: ["automation"] } },
    });
    expect(out.end.vars.bought).toBe(0);
    expect(cursor).toBe(0);
  });

  it("restores a capped batch whose handed decisions are all rejected at re-resolution", () => {
    const base = makeScenario({ initialMoney: 5 });
    let enumerations = 0;
    const model: Model<number, U, Vars> = {
      ...base.model,
      actions: (ctx, state) => {
        enumerations += 1;
        const actor = enumerations % 2 === 1 ? ("automation" as const) : ("player" as const);
        return base.model.actions(ctx, state).map((action) => ({ ...action, actor }));
      },
    };
    let cursor = 0;
    const strategy: Strategy<number, U, Vars> = {
      id: "cursor",
      decide(ctx, model, state) {
        cursor += 1;
        const buy = model.actions(ctx, state).find((action) => action.id === "buy")!;
        return [{ action: buy }, { action: buy }];
      },
      snapshotState: () => ({ cursor }),
      restoreState: (saved) => {
        cursor = (saved as { cursor: number }).cursor;
      },
    };
    // maxActionsPerStep hands one of the two admitted decisions to the step, and that one is rejected.
    const out = applyOfflineSeconds({
      scenario: { ...base, model, strategy, constraints: { maxActionsPerStep: 1 } },
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"], actors: ["automation"] } },
    });
    expect(out.end.vars.bought).toBe(0);
    expect(cursor).toBe(0);
  });

  it("consumes the decision when only maxActionsPerStep 0 empties the batch", () => {
    let cursor = 0;
    const strategy: Strategy<number, U, Vars> = {
      id: "cursor",
      decide(ctx, model, state) {
        cursor += 1;
        return [{ action: model.actions(ctx, state).find((action) => action.id === "buy")! }];
      },
      snapshotState: () => ({ cursor }),
      restoreState: (saved) => {
        cursor = (saved as { cursor: number }).cursor;
      },
    };
    const base = makeScenario({ initialMoney: 5, strategy });
    const out = applyOfflineSeconds({
      scenario: { ...base, constraints: { maxActionsPerStep: 0 } },
      seconds: 3,
      options: { actions: { mode: "allow", categories: ["buy"] } },
    });
    expect(out.end.vars.bought).toBe(0);
    expect(cursor).toBe(3);
  });
});
