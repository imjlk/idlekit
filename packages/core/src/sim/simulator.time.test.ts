import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { validateScenarioV1 } from "../scenario/validate";
import type { ScenarioV1 } from "../scenario/types";
import type { Action, CompiledScenario, Model, SimContext, SimState } from "./types";
import type { Strategy } from "./strategy/types";
import { applyOfflineSeconds } from "./offline";
import { runScenario } from "./simulator";
import { timeBoundaryEpsilonScale, timeEpsilon } from "./timeBoundary";
import { checkResume, checkSnapshots, economyAfter } from "../testkit/conformanceRun";

type UnitCode = "COIN";
type Vars = { buys: number };

/** Repro label. This file does not draw a game seed. */
export const timeBoundaryCaseSeed = 0x7102;

function context(stepSec?: number): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    stepSec,
  };
}

function state(amount: number, t = 0): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { buys: 0 },
  };
}

function incomeModel(rate: number): Model<number, UnitCode, Vars> {
  return {
    id: "constant-income",
    version: 1,
    income: () => ({ unit: { code: "COIN" }, amount: rate }),
    actions: () => [],
    analytic: () => ({ incomeKind: "constant" }),
  };
}

function scenario(args: {
  rate?: number;
  stepSec: number;
  durationSec?: number;
  maxSteps?: number;
  until?: (s: SimState<number, UnitCode, Vars>) => boolean;
  ctx?: SimContext<number, UnitCode, Vars>;
  strategy?: Strategy<number, UnitCode, Vars>;
  model?: Model<number, UnitCode, Vars>;
  trace?: CompiledScenario<number, UnitCode, Vars>["run"]["trace"];
  initial?: SimState<number, UnitCode, Vars>;
}): CompiledScenario<number, UnitCode, Vars> {
  return {
    ctx: args.ctx ?? context(args.stepSec),
    model: args.model ?? incomeModel(args.rate ?? 0),
    initial: args.initial ?? state(0),
    strategy: args.strategy,
    run: {
      stepSec: args.stepSec,
      durationSec: args.durationSec,
      maxSteps: args.maxSteps,
      until: args.until,
      trace: args.trace,
    },
  };
}

function countStrategy(): { strategy: Strategy<number, UnitCode, Vars>; calls: () => number; seen: number[] } {
  const seen: number[] = [];
  let calls = 0;
  const strategy: Strategy<number, UnitCode, Vars> = {
    id: "count",
    decide: (ctx) => {
      calls += 1;
      seen.push(ctx.stepSec ?? -1);
      return [];
    },
  };
  return { strategy, calls: () => calls, seen };
}

function jsonClock(durationSec: number | undefined): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: { wallet: { unit: "COIN", amount: "0" } },
    clock: durationSec === undefined ? { stepSec: 1 } : { stepSec: 1, durationSec },
  };
}

/**
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries Runs the partial tick, the step budget, the rejected clocks, and one same-grid split.
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #89f7aa9 Re-read the section, then ran this function: wallet and t end at 10, maxSteps 2 on a longer horizon stops as budget, and duration 0 does not enter the loop.
 * @evidence ./timeBoundary.ts#timeBoundaryEpsilonScale Reads the scale shared by the online and offline stop check.
 * @evidenceReview ./timeBoundary.ts#timeBoundaryEpsilonScale #77fc7ed The declaration is 1e-12. This test reads that scale and expects timeEpsilon(1) to be 1e-12.
 */
export function stopsOnTheRequestedHorizon(): void {
  expect(timeBoundaryEpsilonScale).toBe(1e-12);
  expect(timeEpsilon(1)).toBe(1e-12);
  expect(timeBoundaryCaseSeed).toBe(0x7102);

  const partial = runScenario(scenario({ rate: 1, stepSec: 6, durationSec: 10 }));
  expect(partial.end.t).toBe(10);
  expect(partial.end.wallet.money.amount).toBe(10);
  expect(partial.stop?.reason).toBe("duration");
  expect(partial.stop?.steps).toBe(2);
  expect(partial.stop?.requestedDurationSec).toBe(10);

  const fitted = runScenario(scenario({ rate: 1, stepSec: 5, durationSec: 10, maxSteps: 2 }));
  expect(fitted.stop?.reason).toBe("duration");
  expect(fitted.end.t).toBe(10);
  expect(fitted.end.wallet.money.amount).toBe(10);
  expect(fitted.stop?.steps).toBe(2);

  const budget = runScenario(scenario({ rate: 1, stepSec: 5, durationSec: 20, maxSteps: 2 }));
  expect(budget.stop?.reason).toBe("budget");
  expect(budget.stop?.budgetSteps).toBe(2);
  expect(budget.end.t).toBe(10);
  expect(budget.end.wallet.money.amount).toBe(10);

  const already = countStrategy();
  const untilNow = runScenario(
    scenario({
      rate: 1,
      stepSec: 1,
      until: () => true,
      maxSteps: 0,
      strategy: already.strategy,
      initial: state(4),
    }),
  );
  expect(untilNow.stop?.reason).toBe("until");
  expect(untilNow.stop?.steps).toBe(0);
  expect(untilNow.end.wallet.money.amount).toBe(4);
  expect(already.calls()).toBe(0);

  const zero = countStrategy();
  const durationZero = runScenario(
    scenario({
      rate: 1,
      stepSec: 1,
      durationSec: 0,
      maxSteps: 0,
      strategy: zero.strategy,
      initial: state(4),
    }),
  );
  expect(durationZero.stop?.reason).toBe("duration");
  expect(durationZero.end.t).toBe(0);
  expect(durationZero.end.wallet.money.amount).toBe(4);
  expect(zero.calls()).toBe(0);
  expect(validateScenarioV1(jsonClock(1)).ok).toBe(true);
  expect(validateScenarioV1(jsonClock(0)).ok).toBe(false);

  const rejected = countStrategy();
  const badSteps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1];
  for (const stepSec of badSteps) {
    expect(() => runScenario(scenario({ stepSec, durationSec: 1, strategy: rejected.strategy }))).toThrow(
      /stepSec/,
    );
  }
  for (const maxSteps of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    expect(() =>
      runScenario(scenario({ stepSec: 1, durationSec: 1, maxSteps, strategy: rejected.strategy })),
    ).toThrow(/maxSteps/);
  }
  for (const durationSec of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    expect(() => runScenario(scenario({ stepSec: 1, durationSec, strategy: rejected.strategy }))).toThrow(
      /durationSec/,
    );
  }
  expect(rejected.calls()).toBe(0);
  expect(() => runScenario(scenario({ stepSec: 1, maxSteps: 3 }))).toThrow(
    "runScenario exceeded maxSteps (3)",
  );

  const untilBudget = runScenario(scenario({ rate: 1, stepSec: 1, maxSteps: 2, until: () => false }));
  expect(untilBudget.stop?.reason).toBe("budget");
  expect(untilBudget.end.t).toBe(2);
  expect(untilBudget.end.wallet.money.amount).toBe(2);

  const traced = runScenario(
    scenario({
      rate: 0,
      stepSec: 1,
      durationSec: 5,
      trace: { everySteps: 2 },
    }),
  );
  const times = traced.trace?.map((point) => point.t) ?? [];
  expect(times).toEqual([0, 2, 4, 5]);
  expect(traced.trace?.[0]).not.toBe(traced.trace?.[1]);
  expect(traced.trace?.at(-1)).toBe(traced.end);

  const onGrid = runScenario(
    scenario({ rate: 0, stepSec: 1, durationSec: 2, trace: { everySteps: 1 } }),
  );
  expect(onGrid.trace?.map((point) => point.t)).toEqual([0, 1, 2]);
  expect(onGrid.trace?.at(-1)).toBe(onGrid.end);

  const buy: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { buys: current.vars.buys + 1 } }),
  };
  const stamped = runScenario(
    scenario({
      rate: 3,
      stepSec: 1,
      durationSec: 1,
      model: {
        id: "stamped",
        version: 1,
        income: () => ({ unit: { code: "COIN" }, amount: 3 }),
        actions: () => [buy],
      },
      strategy: { id: "buy", decide: () => [{ action: buy }] },
      trace: { keepActionsLog: true },
    }),
  );
  const actionFrame = stamped.eventTimeline?.find((frame) => frame.event.type === "action.applied");
  const moneyFrame = stamped.eventTimeline?.find((frame) => frame.event.type === "money");
  expect(actionFrame?.phase).toBe("action-start");
  expect(actionFrame?.t).toBe(0);
  expect(stamped.actionsLog?.[0]?.t).toBe(0);
  expect(moneyFrame?.phase).toBe("income-end");
  expect(moneyFrame?.t).toBe(1);

  const ctx = Object.freeze(context(6));
  const preview = countStrategy();
  const previewRun = runScenario(
    scenario({
      rate: 1,
      stepSec: 6,
      durationSec: 10,
      ctx,
      strategy: preview.strategy,
    }),
  );
  expect(preview.seen).toEqual([6, 4]);
  expect(ctx.stepSec).toBe(6);
  expect(previewRun.end.t).toBe(10);

  const coarse = economyAfter(scenario({ rate: 4, stepSec: 1, durationSec: 4 }));
  const fine = economyAfter(scenario({ rate: 4, stepSec: 2, durationSec: 4 }));
  const sameIncome = checkSnapshots(coarse, fine, "same");
  expect(sameIncome.applicable).toBe(true);
  expect(sameIncome.ok).toBe(true);

  const afford: Action<number, UnitCode, Vars> = {
    id: "afford",
    kind: "buy",
    canApply: (_ctx, current) => current.wallet.money.amount >= 10,
    cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
    apply: (_ctx, current) => ({ ...current, vars: { buys: current.vars.buys + 1 } }),
  };
  const affordModel: Model<number, UnitCode, Vars> = {
    id: "threshold",
    version: 1,
    income: () => ({ unit: { code: "COIN" }, amount: 10 }),
    actions: () => [afford],
  };
  const affordStrategy: Strategy<number, UnitCode, Vars> = {
    id: "afford",
    decide: (_ctx, model, current) => {
      const action = model.actions(_ctx, current)[0];
      return action ? [{ action }] : [];
    },
  };
  const fineBuy = economyAfter(
    scenario({ stepSec: 1, durationSec: 2, model: affordModel, strategy: affordStrategy }),
  );
  const coarseBuy = economyAfter(
    scenario({ stepSec: 2, durationSec: 2, model: affordModel, strategy: affordStrategy }),
  );
  const different = checkSnapshots(fineBuy, coarseBuy, "different");
  expect(different.applicable).toBe(true);
  expect(different.ok).toBe(true);
  expect(fineBuy).not.toBe(coarseBuy);

  const split = checkResume(scenario({ rate: 1, stepSec: 1, durationSec: 4 }), 2);
  expect(split.applicable).toBe(true);
  expect(split.ok).toBe(true);

  const online = runScenario(scenario({ rate: 2, stepSec: 1, durationSec: 2.5 }));
  const offline = applyOfflineSeconds({
    scenario: scenario({ rate: 2, stepSec: 1, durationSec: 0 }),
    seconds: 2.5,
    options: { stepSec: 1, useStrategy: false },
  });
  expect(online.end.t).toBeCloseTo(2.5, 8);
  expect(offline.end.t).toBeCloseTo(2.5, 8);
  expect(online.end.wallet.money.amount).toBeCloseTo(5, 8);
  expect(offline.end.wallet.money.amount).toBeCloseTo(5, 8);
  expect(offline.stop?.reason).toBe("duration");
  expect(offline.offline.remainderSec).toBeCloseTo(0.5, 8);

  const offlineBudget = applyOfflineSeconds({
    scenario: scenario({ rate: 1, stepSec: 1, durationSec: 0 }),
    seconds: 10,
    options: { maxSteps: 5, useStrategy: false },
  });
  expect(offlineBudget.stop?.reason).toBe("budget");
  expect(offlineBudget.end.t).toBe(5);
  expect(offlineBudget.end.wallet.money.amount).toBe(5);
  expect(offlineBudget.offline.effectiveSec).toBe(10);
  expect(offlineBudget.offline.simulatedSec).toBe(5);

  const offlineRejected = countStrategy();
  expect(() =>
    applyOfflineSeconds({
      scenario: scenario({ stepSec: 1, durationSec: 0, strategy: offlineRejected.strategy }),
      seconds: 1,
      options: { stepSec: Number.NaN },
    }),
  ).toThrow(/stepSec/);
  expect(offlineRejected.calls()).toBe(0);

  const big = createBreakInfinityEngine();
  const unit = { code: "COIN" as const };
  const bigRun = runScenario({
    ctx: { E: big, unit, tickPolicy: { mode: "drop" } },
    model: {
      id: "constant-income",
      version: 1,
      income: () => ({ unit, amount: big.from(1) }),
      actions: () => [],
    },
    initial: {
      t: 0,
      wallet: { money: { unit, amount: big.zero() }, bucket: big.zero() },
      maxMoneyEver: { unit, amount: big.zero() },
      prestige: { count: 0, points: big.zero(), multiplier: big.from(1) },
      vars: { buys: 0 },
    },
    run: { stepSec: 6, durationSec: 10 },
  });
  expect(bigRun.end.t).toBe(10);
  expect(big.cmp(bigRun.end.wallet.money.amount, big.from(10))).toBe(0);
  expect(bigRun.stop?.reason).toBe("duration");
}

describe("PR-02 simulation time boundaries", () => {
  it("stops on the requested horizon", stopsOnTheRequestedHorizon);
});
