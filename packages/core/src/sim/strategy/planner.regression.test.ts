import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { prestigeAnchorFromCheckpoint, prestigeCooldownContract } from "../constraints";
import { applyOfflineSeconds } from "../offline";
import { createRunFactory, type ExecutionPlan } from "../runFactory";
import { stepOnce } from "../step";
import { runScenario } from "../simulator";
import type { Action, CompiledScenario, Model, ScenarioConstraints, SimContext, SimEvent, SimState } from "../types";
import { createPlannerStrategy, plannerSearchContract } from "./planner";

type UnitCode = "COIN";
type Vars = { owned: number };

/** Repro label. The runs below do not draw from this value. */
export const plannerCaseSeed = 0x7104;

function state(amount = 0, t = 0, owned = 0): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount: Math.max(amount, 0) },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned },
  };
}

function context(args?: {
  stepSec?: number;
  constraints?: ScenarioConstraints;
  emit?: (events: readonly SimEvent<number>[]) => void;
}): SimContext<number, UnitCode, Vars> {
  return {
    E: createNumberEngine(),
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    seed: plannerCaseSeed,
    stepSec: args?.stepSec ?? 1,
    constraints: args?.constraints,
    emit: args?.emit,
  };
}

function model(actions: readonly Action<number, UnitCode, Vars>[], income?: Model<number, UnitCode, Vars>["income"]): Model<number, UnitCode, Vars> {
  return {
    id: "planner-regression",
    version: 1,
    income: income ?? (() => ({ unit: { code: "COIN" }, amount: 0 })),
    actions: () => actions,
    netWorth: (_ctx, current) => current.wallet.money,
  };
}

function buy(id: string, gain: number): Action<number, UnitCode, Vars> {
  return {
    id,
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      wallet: {
        ...current.wallet,
        money: { ...current.wallet.money, amount: current.wallet.money.amount + gain },
      },
    }),
  };
}

const plannerParams = {
  schemaVersion: 1 as const,
  horizonSteps: 2,
  beamWidth: 4,
  objective: "maximizeNetWorthAtEnd" as const,
  series: "money" as const,
};

/**
 * @evidence docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout Runs the wait-then-buy case, emit isolation, search order, the 60-second cooldown, a size-10 quote, and a capped search.
 * @evidenceReview docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout #a52946e Re-read the section, then ran this function: the first wait stays empty, 59 seconds is blocked when the anchor is known, and the search report is not a global optimum.
 * @evidence ../constraints.ts#prestigeCooldownContract Reads the cooldown contract and applies it at 59 and 60 seconds.
 * @evidenceReview ../constraints.ts#prestigeCooldownContract #f89be18 The declaration is idlekit.prestige-cooldown. This test blocks a known anchor at 59 seconds and allows it at 60.
 * @evidence ./planner.ts#plannerSearchContract Reads the search contract and expects globallyOptimal to stay false.
 * @evidenceReview ./planner.ts#plannerSearchContract #217a216 The declaration is idlekit.planner-search. This test reads that property and expects a budget stop to stay non-optimal.
 */
export function keepsPlannerRolloutFaithful(): void {
  expect(plannerCaseSeed).toBe(0x7104);
  expect(prestigeCooldownContract).toBe("idlekit.prestige-cooldown");
  expect(plannerSearchContract).toBe("idlekit.planner-search");

  const save = {
    id: "buy",
    kind: "buy" as const,
    canApply: (_ctx: SimContext<number, UnitCode, Vars>, current: SimState<number, UnitCode, Vars>) =>
      current.wallet.money.amount >= 5,
    cost: () => ({ unit: { code: "COIN" as const }, amount: 5 }),
    apply: (_ctx: SimContext<number, UnitCode, Vars>, current: SimState<number, UnitCode, Vars>) => ({
      ...current,
      vars: { owned: current.vars.owned + 1 },
    }),
  } satisfies Action<number, UnitCode, Vars>;
  const saving = model(
    [save],
    (_ctx, current) => ({ unit: { code: "COIN" }, amount: 5 + current.vars.owned * 100 }),
  );
  let emits = 0;
  const savingCtx = context({ emit: () => { emits += 1; } });
  const savingState = state(0);
  const saver = createPlannerStrategy<number, UnitCode, Vars>(plannerParams);
  expect(saver.decide(savingCtx, saving, savingState)).toEqual([]);
  expect(emits).toBe(0);
  expect(savingState.wallet.money.amount).toBe(0);
  expect(savingState.t).toBe(0);
  expect(saver.plannerReport().globallyOptimal).toBe(false);
  expect(saver.plannerReport().stopped).toBe("horizon");
  const waited = stepOnce({ ctx: savingCtx, model: saving, state: state(0), dt: 1, decisions: [] });
  expect(waited.next.wallet.money.amount).toBe(5);
  expect(saver.decide(savingCtx, saving, waited.next)[0]?.action.id).toBe("buy");

  const live = state(3);
  const seen: Array<{ dt: number; emit: boolean; interval?: number; sameState: boolean }> = [];
  const probe = createPlannerStrategy<number, UnitCode, Vars>(plannerParams, {
    stepOnce(input) {
      seen.push({
        dt: input.dt,
        emit: input.ctx.emit !== undefined,
        interval: input.constraints?.minPrestigeIntervalSec,
        sameState: input.state === live,
      });
      return { prev: input.state, next: { ...input.state, t: input.state.t + input.dt }, events: [] };
    },
  });
  probe.decide(context({ stepSec: 4, constraints: { minPrestigeIntervalSec: 60 } }), model([]), live);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((row) => row.dt === 4 && !row.emit && row.interval === 60 && !row.sameState)).toBe(true);
  expect(live.wallet.money.amount).toBe(3);

  const touch = state(1, 4);
  const leaky = model(
    [buy("touch", 1)],
    (_ctx, current) => {
      (current as { t: number }).t = 999;
      return { unit: { code: "COIN" }, amount: 0 };
    },
  );
  createPlannerStrategy<number, UnitCode, Vars>(plannerParams).decide(context(), leaky, touch);
  expect(touch.t).toBe(4);
  expect(touch.wallet.money.amount).toBe(1);

  const low = buy("a", 10);
  const high = buy("m", 10);
  const tie = { ...plannerParams, horizonSteps: 1, beamWidth: 2 };
  const left = createPlannerStrategy<number, UnitCode, Vars>(tie).decide(context(), model([high, low]), state(0));
  const right = createPlannerStrategy<number, UnitCode, Vars>(tie).decide(context(), model([low, high]), state(0));
  expect(left[0]?.action.id).toBe("a");
  expect(right[0]?.action.id).toBe(left[0]?.action.id);
  expect(right[0]?.bulkSize).toBe(left[0]?.bulkSize);

  const reset: Action<number, UnitCode, Vars> = {
    id: "reset",
    kind: "prestige",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      prestige: { count: current.prestige.count + 1, points: current.prestige.points + 10, multiplier: 2 },
      wallet: { ...current.wallet, money: { ...current.wallet.money, amount: 0 } },
      vars: { owned: 0 },
    }),
  };
  const prestigeModel = model([reset]);
  const anchored: ScenarioConstraints = { minPrestigeIntervalSec: 60, lastPrestigeResetT: 0 };
  const prestigePlanner = createPlannerStrategy<number, UnitCode, Vars>({
    schemaVersion: 1,
    horizonSteps: 2,
    beamWidth: 2,
    objective: "maximizePrestigePerHour",
  });
  const coolCtx = context({ constraints: anchored });
  expect(prestigePlanner.decide(coolCtx, prestigeModel, state(0, 59))).toEqual([]);
  expect(prestigePlanner.decide(coolCtx, prestigeModel, state(0, 60))[0]?.action.id).toBe("reset");
  const blocked = stepOnce({
    ctx: coolCtx,
    model: prestigeModel,
    state: state(0, 59),
    dt: 1,
    decisions: [{ action: reset }],
    constraints: anchored,
  });
  expect(blocked.next.prestige.count).toBe(0);
  expect(blocked.prestigeResetT).toBeUndefined();
  expect(blocked.events.some((event) => event.type === "action.skipped" && event.reason === "cooldown")).toBe(true);
  const ready = stepOnce({
    ctx: coolCtx,
    model: prestigeModel,
    state: state(0, 60),
    dt: 1,
    decisions: [{ action: reset }],
    constraints: anchored,
  });
  expect(ready.next.prestige.count).toBe(1);
  expect(ready.prestigeResetT).toBe(60);
  const unanchored = stepOnce({
    ctx: context({ constraints: { minPrestigeIntervalSec: 60 } }),
    model: prestigeModel,
    state: state(0, 59),
    dt: 1,
    decisions: [{ action: reset }],
    constraints: { minPrestigeIntervalSec: 60 },
  });
  expect(unanchored.next.prestige.count).toBe(1);
  expect(unanchored.prestigeResetT).toBe(59);
  expect(unanchored.events.some((event) => event.type === "warning" && event.code === "PRESTIGE_COOLDOWN_UNANCHORED")).toBe(true);

  const plan: ExecutionPlan = {
    contract: "idlekit.execution-plan",
    version: 1,
    stepSec: 1,
    durationSec: 2,
    seed: plannerCaseSeed,
    constraints: { minPrestigeIntervalSec: 60 },
  };
  const scenario: CompiledScenario<number, UnitCode, Vars> = {
    ctx: context(),
    model: prestigeModel,
    initial: state(0),
    constraints: { minPrestigeIntervalSec: 60 },
    run: { stepSec: 5, durationSec: 5 },
    strategy: { id: "always-reset", decide: () => [{ action: reset }] },
  };
  const binding = createRunFactory().bind(scenario);
  const opened = binding.fresh({ trialId: "pr04", seed: plannerCaseSeed, plan });
  expect(opened.seed).toBe(plannerCaseSeed);
  expect(opened.scenario.ctx.seed).toBe(plannerCaseSeed);
  expect(opened.scenario.run.stepSec).toBe(1);
  expect(opened.scenario.constraints?.minPrestigeIntervalSec).toBe(60);
  expect(opened.scenario.constraints?.lastPrestigeResetT).toBeUndefined();
  expect(opened.checkpoint().runner).toBeUndefined();
  const legacy = opened.checkpoint();
  const legacyRead = prestigeAnchorFromCheckpoint(legacy);
  expect(legacyRead.status).toBe("unanchored");
  expect(legacyRead.lastResetT).toBeUndefined();
  expect(legacyRead.warning).toContain("No past timestamp");
  const legacyResume = binding.resume({ checkpoint: legacy, state: state(0, 59) });
  expect(legacyResume.scenario.constraints?.lastPrestigeResetT).toBeUndefined();
  expect(legacyResume.checkpoint().runner).toBeUndefined();
  const readyOnly = { ...legacy, runner: { prestigeReadyAtSec: 60 } };
  expect(prestigeAnchorFromCheckpoint(readyOnly).status).toBe("unanchored");
  const readyResume = binding.resume({ checkpoint: readyOnly, state: state(0) });
  expect(readyResume.scenario.constraints?.lastPrestigeResetT).toBeUndefined();
  expect(readyResume.checkpoint().runner).toBeUndefined();
  const previewBefore = legacyResume.preview.snapshot();
  const executionBefore = legacyResume.rng.snapshot();
  prestigePlanner.decide(legacyResume.scenario.ctx, prestigeModel, state(0, 60));
  expect(legacyResume.preview.snapshot()).toEqual(previewBefore);
  expect(legacyResume.rng.snapshot()).toEqual(executionBefore);
  expect(legacyResume.checkpoint().runner).toBeUndefined();

  const lived = runScenario(opened.scenario);
  expect(lived.end.prestige.count).toBe(1);
  expect(opened.checkpoint().runner).toEqual({ lastPrestigeResetT: 0, prestigeReadyAtSec: 60 });
  const cooled = binding.resume({ checkpoint: opened.checkpoint(), state: state(0, 59) });
  expect(cooled.scenario.constraints?.lastPrestigeResetT).toBe(0);
  expect(prestigePlanner.decide(cooled.scenario.ctx, prestigeModel, state(0, 59))).toEqual([]);
  const cooledStep = stepOnce({
    ctx: cooled.scenario.ctx,
    model: prestigeModel,
    state: state(0, 59),
    dt: cooled.scenario.run.stepSec,
    decisions: [{ action: reset }],
    constraints: cooled.scenario.constraints,
  });
  expect(cooledStep.next.prestige.count).toBe(0);
  const cooledReady = stepOnce({
    ctx: cooled.scenario.ctx,
    model: prestigeModel,
    state: state(0, 60),
    dt: cooled.scenario.run.stepSec,
    decisions: [{ action: reset }],
    constraints: cooled.scenario.constraints,
  });
  expect(cooledReady.prestigeResetT).toBe(60);

  const offlineRun = binding.fresh({ trialId: "pr04-offline", seed: plannerCaseSeed, plan });
  const offline = applyOfflineSeconds({ scenario: offlineRun.scenario, seconds: 2 });
  expect(offline.end.prestige.count).toBe(1);
  expect(offlineRun.checkpoint().runner?.lastPrestigeResetT).toBe(0);

  const pack: Action<number, UnitCode, Vars> = {
    id: "pack",
    kind: "buy",
    canApply: (_ctx, current) => current.wallet.money.amount >= 30,
    cost: () => ({ unit: { code: "COIN" }, amount: 10 }),
    bulk: () => [
      {
        size: 1,
        cost: { unit: { code: "COIN" }, amount: 10 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 },
      },
      {
        size: 10,
        cost: { unit: { code: "COIN" }, amount: 30 },
        deltaIncomePerSec: { unit: { code: "COIN" }, amount: 50 },
      },
    ],
    apply: (_ctx, current, bulkSize) => ({ ...current, vars: { owned: current.vars.owned + (bulkSize ?? 1) } }),
  };
  const quoted = model([pack], (_ctx, current) => ({ unit: { code: "COIN" }, amount: current.vars.owned * 100 }));
  const quotePlanner = createPlannerStrategy<number, UnitCode, Vars>({
    schemaVersion: 1,
    horizonSteps: 1,
    beamWidth: 2,
    objective: "maximizeNetWorthAtEnd",
    series: "money",
  });
  const chosen = quotePlanner.decide(context(), quoted, state(100))[0];
  expect(chosen?.bulkSize).toBe(10);
  const viaPlanner = stepOnce({
    ctx: context(),
    model: quoted,
    state: state(100),
    dt: 1,
    decisions: chosen ? [chosen] : [],
  });
  const viaQuote = stepOnce({
    ctx: context(),
    model: quoted,
    state: state(100),
    dt: 1,
    decisions: [{ action: pack, bulkSize: 10 }],
  });
  const viaUnit = stepOnce({
    ctx: context(),
    model: quoted,
    state: state(100),
    dt: 1,
    decisions: [{ action: pack, bulkSize: 1 }],
  });
  expect(viaPlanner.next.wallet.money.amount).toBe(viaQuote.next.wallet.money.amount);
  expect(viaPlanner.next.wallet.money.amount).toBe(1070);
  expect(viaUnit.next.wallet.money.amount).not.toBe(viaPlanner.next.wallet.money.amount);

  const capped = createPlannerStrategy<number, UnitCode, Vars>({
    schemaVersion: 1,
    horizonSteps: 10_000,
    beamWidth: 10_000,
    maxBranchingActions: 10_000,
    objective: "maximizeNetWorthAtEnd",
    series: "money",
  });
  const capModel = model([low, high]);
  const firstDecision = capped.decide(context(), capModel, state(0));
  const firstReport = capped.plannerReport();
  const secondDecision = capped.decide(context(), capModel, state(0));
  const secondReport = capped.plannerReport();
  expect(firstDecision[0]?.action.id).toBe("a");
  expect(secondDecision).toEqual(firstDecision);
  expect(secondReport).toEqual(firstReport);
  expect(firstReport.globallyOptimal).toBe(false);
  expect(firstReport.stopped).toBe("budget");
  expect(firstReport.clamped).toBe(true);
  expect(firstReport.rollouts).toBe(256);
  expect(firstReport.rolloutBudget).toBe(256);
  expect(firstReport.horizonSteps).toBe(32);
  expect(firstReport.beamWidth).toBe(8);
  expect(firstReport.maxBranchingActions).toBe(8);
  expect(firstReport.version).toBe(1);
}

describe("PR-04 planner rollout", () => {
  it("keeps planner rollout faithful", keepsPlannerRolloutFaithful);
});

function resetAction(): Action<number, UnitCode, Vars> {
  return {
    id: "reset",
    kind: "prestige",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({
      ...current,
      prestige: { count: current.prestige.count + 1, points: current.prestige.points + 10, multiplier: 2 },
      wallet: { ...current.wallet, money: { ...current.wallet.money, amount: 0 } },
      vars: { owned: 0 },
    }),
  };
}

describe("prestige cooldown", () => {
  it("opens on the tick that reaches the interval with fractional steps", () => {
    // 100 ticks of 0.1 from 0.5 land on 10.499999999999979, just short of 10.5.
    const reset = resetAction();
    const run = runScenario<number, UnitCode, Vars>({
      ctx: context({ stepSec: 0.1 }),
      model: model([reset]),
      initial: state(0, 0.5),
      constraints: { minPrestigeIntervalSec: 10 },
      run: { stepSec: 0.1, durationSec: 10.05, trace: { keepActionsLog: true } },
      strategy: { id: "always-reset", decide: () => [{ action: reset }] },
    });
    const resets = (run.actionsLog ?? []).filter((row) => row.actionId === "reset");
    expect(resets.length).toBe(2);
    expect(resets[0]?.t).toBe(0.5);
    expect(resets[1]?.t).toBeCloseTo(10.5, 9);
    expect(run.end.prestige.count).toBe(2);
  });

  it("blocks a second prestige committed earlier in the same step", () => {
    const reset = resetAction();
    const constraints: ScenarioConstraints = { minPrestigeIntervalSec: 60, lastPrestigeResetT: 0 };
    const out = stepOnce({
      ctx: context({ constraints }),
      model: model([reset]),
      state: state(0, 100),
      dt: 1,
      decisions: [{ action: reset }, { action: reset }],
      constraints,
    });
    expect(out.next.prestige.count).toBe(1);
    expect(out.prestigeResetT).toBe(100);
    expect(out.events.filter((event) => event.type === "action.skipped" && event.reason === "cooldown").length).toBe(1);

    const unanchored = stepOnce({
      ctx: context({ constraints: { minPrestigeIntervalSec: 60 } }),
      model: model([reset]),
      state: state(0, 100),
      dt: 1,
      decisions: [{ action: reset }, { action: reset }],
      constraints: { minPrestigeIntervalSec: 60 },
    });
    expect(unanchored.next.prestige.count).toBe(1);
  });
});
