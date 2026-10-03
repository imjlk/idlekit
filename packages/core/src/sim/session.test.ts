import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { mergeObservations } from "./observation";
import { simulateMonteCarlo } from "./monteCarlo";
import { applyOfflineSeconds } from "./offline";
import { runScenario } from "./simulator";
import { sessionClockContract, simulateSessionPattern, type SessionPatternSpec, type SessionRunResult } from "./session";
import { createScriptedStrategy } from "./strategy/scripted";
import type { Action, CompiledScenario, Model, SimState } from "./types";
import type { Strategy } from "./strategy/types";

type UnitCode = "COIN";
type Vars = { owned: number };

function makeState(): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount: 0 },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned: 0 },
  };
}

describe("simulateSessionPattern", () => {
  it("is deterministic for a fixed pattern and seed", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 42 },
      model,
      initial: makeState(),
      run: { stepSec: 1, durationSec: 10 },
    };

    const a = simulateSessionPattern({ scenario, pattern: { id: "short-bursts", days: 1 }, seed: 42 });
    const b = simulateSessionPattern({ scenario, pattern: { id: "short-bursts", days: 1 }, seed: 42 });
    expect(a.end.t).toBe(86400);
    expect(a.end.wallet.money.amount).toBe(b.end.wallet.money.amount);
    expect(a.summary.activeBlocks).toBe(10);
  });

  it("aggregates dropped event counts across session segments", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 7 },
      model,
      initial: makeState(),
      run: {
        stepSec: 1,
        durationSec: 10,
        eventLog: {
          enabled: true,
          maxEvents: 0,
        },
      },
    };

    const out = simulateSessionPattern({ scenario, pattern: { id: "short-bursts", days: 1 }, seed: 7 });
    expect((out.run.eventLog?.dropped ?? 0) > 0).toBeTrue();
    expect(out.run.eventLog?.retained).toBe(0);
    const merged = mergeObservations(out.segments.map((segment) => segment.run.observation!));
    expect(out.run.stats?.money.applied).toBe(merged.money.applied);
    expect(out.run.stats?.actions.applied).toBe(merged.actions.applied);
    expect(out.run.observation?.legacyEventFallback).toBe(false);
    const kept = simulateSessionPattern({
      scenario: { ...scenario, run: { ...scenario.run, eventLog: { enabled: true } } },
      pattern: { id: "short-bursts", days: 1 },
      seed: 7,
    });
    expect(kept.run.stats?.money).toEqual(out.run.stats?.money);
    expect(kept.end.wallet.money.amount).toBe(out.end.wallet.money.amount);
  });
});

/** Repro label. The runs below do not draw from this value. */
export const sessionCaseSeed = 0x7106;

type ClockVars = { bought: number; auto: number; manual: number; a: number; b: number };

function clockState(amount = 0, t = 0): SimState<number, UnitCode, ClockVars> {
  return {
    t,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { bought: 0, auto: 0, manual: 0, a: 0, b: 0 },
  };
}

function coin(amount: number) {
  return { unit: { code: "COIN" as const }, amount };
}

function buyAction(id: string, field: keyof ClockVars, actor?: "player" | "automation"): Action<number, UnitCode, ClockVars> {
  return {
    id,
    kind: "buy",
    ...(actor ? { actor } : {}),
    canApply: () => true,
    cost: () => coin(1),
    apply: (_ctx, state) => ({ ...state, vars: { ...state.vars, [field]: state.vars[field] + 1 } }),
  };
}

function prestigeAction(): Action<number, UnitCode, ClockVars> {
  return {
    id: "prestige",
    kind: "prestige",
    actor: "player",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, state) => ({
      ...state,
      prestige: { ...state.prestige, count: state.prestige.count + 1 },
    }),
  };
}

function clockScenario(args: {
  income?: number;
  money?: number;
  actions?: readonly Action<number, UnitCode, ClockVars>[];
  strategy?: Strategy<number, UnitCode, ClockVars>;
  offline?: CompiledScenario<number, UnitCode, ClockVars>["run"]["offline"];
  until?: (state: SimState<number, UnitCode, ClockVars>) => boolean;
  goals?: CompiledScenario<number, UnitCode, ClockVars>["run"]["goals"];
  maxSteps?: number;
  eventLog?: CompiledScenario<number, UnitCode, ClockVars>["run"]["eventLog"];
  clocks?: Model<number, UnitCode, ClockVars>["clocks"];
  seen?: Array<CompiledScenario<number, UnitCode, ClockVars>["ctx"]["clocks"]>;
}): CompiledScenario<number, UnitCode, ClockVars> {
  const E = createNumberEngine();
  const model: Model<number, UnitCode, ClockVars> = {
    id: "clock",
    version: 1,
    income: (ctx) => {
      args.seen?.push(ctx.clocks);
      return coin(args.income ?? 0);
    },
    actions: () => args.actions ?? [],
    ...(args.clocks ? { clocks: args.clocks } : {}),
  };
  return {
    ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 1 },
    model,
    initial: clockState(args.money ?? 0),
    ...(args.strategy ? { strategy: args.strategy } : {}),
    run: {
      stepSec: 1,
      durationSec: 1,
      ...(args.offline ? { offline: args.offline } : {}),
      ...(args.until ? { until: args.until } : {}),
      ...(args.goals ? { goals: args.goals } : {}),
      ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
      ...(args.eventLog ? { eventLog: args.eventLog } : {}),
    },
  };
}

function runPattern(
  scenario: CompiledScenario<number, UnitCode, ClockVars>,
  pattern: SessionPatternSpec,
): SessionRunResult<number, UnitCode, ClockVars> {
  return simulateSessionPattern({ scenario, pattern, seed: 1 });
}

/**
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Runs the 12-hour cap, the 24-hour horizon, offline policies, schedule rejection, and an early stop.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #3c24d94 Re-read the section, then ran this function: 12 hours away credits 1 hour, the one-day horizon stays 86400, policy none does not move the scripted cursor, maxSteps 2 ends each active block as budget while the session reaches the horizon, the next offline gap starts at the planned block end, and an always-on session cut by maxSteps has no offline time for a reject policy to refuse.
 * @evidence ./session.ts#sessionClockContract Reads the session clock contract and checks wall elapsed against reward time.
 * @evidenceReview ./session.ts#sessionClockContract #bd7e206 The declaration is idlekit.session-clock. This test reads that property and expects a capped gap to keep those clocks apart.
 * @evidence ./session.ts#assertSessionSchedule An empty schedule, a negative offset, a negative duration, and overlapping blocks throw, and a 12-hour offset block starts on wall time 43200.
 * @evidenceReview ./session.ts#assertSessionSchedule #86f2edc Re-read assertSessionSchedule: days must be a positive integer, the list must be non-empty, each day an integer >= 0, each offset finite and >= 0, each duration finite and > 0, no block may end past the horizon, and sorted blocks may not overlap. Ran this function: the empty, negative offset, negative duration, and overlap cases threw those messages, and the 12-hour block ran after a 43200s offline segment.
 * @evidence ./session.ts#simulateSessionPattern A 12-hour gap with a 1-hour cap stays elapsed 43200 and credited 3600, presets keep the 86400 horizon, until and goals stop before the next block, and maxSteps cuts each active block without ending the session.
 * @evidenceReview ./session.ts#simulateSessionPattern #f12e1c1 Re-read simulateSessionPattern: it rejects a non-integer trace budget for the whole session, runs offline gaps through applyOfflineSeconds up to each scheduled wall start, ends a gap cut by until or a goal at the smallest absence whose cap- and decay-adjusted reward reaches the stepped reward, runs each block through runScenario with that block's duration, keeps state.t as reward time, evaluates open goals on a cloned state, stops on until or once every goal is reached, counts budget stops per block and ends a cut block's wall time and elapsed seconds at its planned end while crediting only the simulated seconds, and merges segment observations. Ran this function: offline-heavy elapsed 86400 with 3600 credited and 82500 lost, early until and goal stopped at t 10 after one block, and maxSteps 2 gave two budget stops, the first ending at wall 110 with 10 elapsed and 2 credited, with the session ending on the 86400 horizon.
 * @evidence ./offline.ts#resolveOfflineActionPolicy Policy none keeps the scripted cursor at 1, legacy-all moves it to 3, and allow applies only the automation buy.
 * @evidenceReview ./offline.ts#resolveOfflineActionPolicy #b424f6a Re-read resolveOfflineActionPolicy: useStrategy false and policy none never call the strategy, allow calls it and keeps the policy, and legacy-all calls it when useStrategy or a strategy is present. Ran this function: none left the scripted cursor at 1 and bought once, legacy-all reached cursor 3 with one prestige, and allow applied the automation buy only.
 */
export function keepsSessionClocksDistinct(): void {
  expect(sessionClockContract).toBe("idlekit.session-clock");
  expect(sessionCaseSeed).toBe(0x7106);

  const capped = clockScenario({
    income: 1,
    offline: { maxSec: 3600, overflowPolicy: "clamp" },
  });
  const heavy = runPattern(capped, { id: "offline-heavy", days: 1 });
  expect(heavy.summary.elapsedSec).toBe(86400);
  expect(heavy.summary.horizonSec).toBe(86400);
  expect(heavy.summary.activeSec).toBe(300);
  expect(heavy.summary.totalActiveSec).toBe(300);
  expect(heavy.summary.offlineElapsedSec).toBe(86100);
  expect(heavy.summary.offlineCreditedSec).toBe(3600);
  expect(heavy.summary.totalOfflineSec).toBe(3600);
  expect(heavy.summary.lostRewardSec).toBe(82500);
  expect(heavy.summary.rewardSec).toBe(3900);
  expect(heavy.end.t).toBe(3900);
  expect(heavy.end.wallet.money.amount).toBe(3900);
  expect(heavy.summary.stop.reason).toBe("horizon");
  expect(heavy.summary.offlineActions).toBe("legacy-all");
  expect(heavy.segments.map((segment) => segment.kind)).toEqual(["active", "offline"]);
  expect(heavy.segments[1]?.wallStartT).toBe(300);
  expect(heavy.segments[1]?.wallEndT).toBe(86400);
  expect(heavy.segments[1]?.clock.elapsedSec).toBe(86100);
  expect(heavy.segments[1]?.clock.creditedSec).toBe(3600);

  const away = runPattern(capped, {
    id: "offline-heavy",
    days: 1,
    schedule: [{ day: 0, startOffsetSec: 12 * 3600, durationSec: 60 }],
  });
  expect(away.segments[0]?.kind).toBe("offline");
  expect(away.segments[0]?.clock.elapsedSec).toBe(12 * 3600);
  expect(away.segments[0]?.clock.creditedSec).toBe(3600);
  expect(away.segments[0]?.endT).toBe(3600);
  expect(away.segments[0]?.wallEndT).toBe(12 * 3600);
  expect(away.segments[1]?.kind).toBe("active");
  expect(away.segments[1]?.wallStartT).toBe(12 * 3600);
  expect(away.summary.elapsedSec).toBe(86400);
  expect(away.summary.horizonSec).toBe(86400);
  expect(away.end.t).not.toBe(86400);
  let wall = away.start.t;
  for (const segment of away.segments) {
    expect(segment.wallStartT).toBe(wall);
    expect(segment.wallEndT - segment.wallStartT).toBe(segment.clock.elapsedSec);
    wall = segment.wallEndT;
  }
  expect(wall).toBe(86400);

  const decayed = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp", decay: { kind: "linear", floorRatio: 0.25 } },
    }),
    { id: "offline-heavy", days: 1 },
  );
  expect(decayed.summary.elapsedSec).toBe(86400);
  expect(decayed.summary.offlineCreditedSec).toBe(900);
  expect(decayed.summary.lostRewardSec).toBe(85200);
  expect(decayed.end.t).toBe(1200);

  const bursts = runPattern(clockScenario({ income: 1 }), { id: "short-bursts", days: 1 });
  expect(bursts.end.t).toBe(86400);
  expect(bursts.summary.activeSec).toBe(600);
  expect(bursts.summary.totalOfflineSec).toBe(85800);
  expect(bursts.summary.offlineElapsedSec).toBe(85800);
  expect(bursts.summary.lostRewardSec).toBe(0);
  expect(bursts.summary.elapsedSec).toBe(86400);
  expect(bursts.summary.activeBlocks).toBe(10);

  const explicit = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp", actions: { mode: "legacy-all" } },
    }),
    { id: "offline-heavy", days: 1 },
  );
  expect(explicit.end.t).toBe(heavy.end.t);
  expect(explicit.end.wallet.money.amount).toBe(heavy.end.wallet.money.amount);
  expect(explicit.summary.lostRewardSec).toBe(heavy.summary.lostRewardSec);

  const buy = buyAction("buy", "bought", "player");
  const prestige = prestigeAction();
  const scripted = (loop: boolean) =>
    createScriptedStrategy<number, UnitCode, ClockVars>({
      schemaVersion: 1,
      loop,
      program: [{ actionId: "buy" }, { actionId: "prestige" }, { actionId: "buy" }, { actionId: "buy" }],
    });
  const quiet = {
    id: "offline-heavy" as const,
    days: 1,
    schedule: [{ day: 0, startOffsetSec: 2, durationSec: 1 }],
  };
  const noneStrategy = scripted(false);
  const noneRun = runPattern(
    clockScenario({
      money: 10,
      actions: [buy, prestige],
      strategy: noneStrategy,
      offline: { actions: { mode: "none" } },
      until: (state) => state.t >= 3,
    }),
    quiet,
  );
  expect(noneRun.end.vars.bought).toBe(1);
  expect(noneRun.end.prestige.count).toBe(0);
  expect(noneStrategy.snapshotState?.()).toEqual({ cursor: 1 });
  expect(noneRun.segments[0]?.kind).toBe("offline");
  expect(noneRun.segments[0]?.run.end.vars.bought).toBe(0);

  const legacyStrategy = scripted(false);
  const legacyRun = runPattern(
    clockScenario({
      money: 10,
      actions: [buy, prestige],
      strategy: legacyStrategy,
      offline: { actions: { mode: "legacy-all" } },
      until: (state) => state.t >= 3,
    }),
    quiet,
  );
  expect(legacyRun.end.vars.bought).toBe(2);
  expect(legacyRun.end.prestige.count).toBe(1);
  expect(legacyStrategy.snapshotState?.()).toEqual({ cursor: 3 });

  const auto = buyAction("auto", "auto", "automation");
  const manual = buyAction("manual", "manual", "player");
  const allowRun = runPattern(
    clockScenario({
      money: 10,
      actions: [auto, manual, prestige],
      strategy: {
        id: "all",
        decide(_ctx, model, current) {
          return model.actions(_ctx, current).map((action) => ({ action }));
        },
      },
      offline: { actions: { mode: "allow", categories: ["buy"], actors: ["automation"] } },
      until: (state) => state.t >= 2,
    }),
    { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 1, durationSec: 1 }] },
  );
  expect(allowRun.segments[0]?.run.end.vars.auto).toBe(1);
  expect(allowRun.segments[0]?.run.end.vars.manual).toBe(0);
  expect(allowRun.segments[0]?.run.end.prestige.count).toBe(0);

  const actionA = buyAction("a", "a", "player");
  const actionB = buyAction("b", "b", "player");
  const filtered = createScriptedStrategy<number, UnitCode, ClockVars>({
    schemaVersion: 1,
    loop: false,
    program: [{ actionId: "a" }, { actionId: "b" }],
  });
  const filteredRun = runPattern(
    clockScenario({
      money: 10,
      actions: [actionA, actionB],
      strategy: filtered,
      offline: { actions: { mode: "allow", categories: ["buy"], actors: ["automation"] } },
      until: (state) => state.t >= 2,
    }),
    { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 1, durationSec: 1 }] },
  );
  expect(filteredRun.segments[0]?.run.end.vars.a).toBe(0);
  expect(filteredRun.end.vars.a).toBe(1);
  expect(filteredRun.end.vars.b).toBe(0);
  expect(filtered.snapshotState?.()).toEqual({ cursor: 1 });

  const freshA = scripted(false);
  const freshB = scripted(false);
  const once = { id: "offline-heavy" as const, days: 1, schedule: [{ day: 0, startOffsetSec: 0, durationSec: 1 }] };
  const first = runPattern(
    clockScenario({
      money: 5,
      actions: [buy, prestige],
      strategy: freshA,
      offline: { actions: { mode: "none" } },
      until: (state) => state.t >= 1,
    }),
    once,
  );
  const second = runPattern(
    clockScenario({
      money: 5,
      actions: [buy, prestige],
      strategy: freshB,
      offline: { actions: { mode: "none" } },
      until: (state) => state.t >= 1,
    }),
    once,
  );
  expect(first.end.vars.bought).toBe(1);
  expect(second.end.vars.bought).toBe(1);

  const continued = createScriptedStrategy<number, UnitCode, ClockVars>({
    schemaVersion: 1,
    loop: false,
    program: [{ actionId: "buy" }, { actionId: "buy" }],
  });
  const continuedRun = runPattern(
    clockScenario({
      money: 5,
      actions: [buy],
      strategy: continued,
      offline: { actions: { mode: "none" } },
      until: (state) => state.t >= 3,
    }),
    {
      id: "offline-heavy",
      days: 1,
      schedule: [
        { day: 0, startOffsetSec: 0, durationSec: 1 },
        { day: 0, startOffsetSec: 2, durationSec: 1 },
      ],
    },
  );
  expect(continuedRun.summary.activeBlocks).toBe(2);
  expect(continuedRun.end.vars.bought).toBe(2);
  expect(continued.snapshotState?.()).toEqual({ cursor: 2 });
  expect(continuedRun.segments.filter((segment) => segment.kind === "offline")[0]?.run.end.vars.bought).toBe(1);

  const direct = applyOfflineSeconds({
    scenario: clockScenario({ income: 1, offline: { maxSec: 5, overflowPolicy: "clamp" } }),
    seconds: 10,
  });
  expect(direct.offline.requestedSec).toBe(10);
  expect(direct.offline.effectiveSec).toBe(5);
  expect(direct.end.t).toBe(5);
  expect(direct.offline.actionPolicy).toBe("legacy-all");

  expect(() =>
    runPattern(clockScenario({}), { id: "offline-heavy", days: 1, schedule: [] }),
  ).toThrow("session schedule is empty");
  expect(() =>
    runPattern(clockScenario({}), {
      id: "offline-heavy",
      days: 1,
      schedule: [{ day: 0, startOffsetSec: -1, durationSec: 1 }],
    }),
  ).toThrow("session schedule offset must be finite and >= 0");
  expect(() =>
    runPattern(clockScenario({}), {
      id: "offline-heavy",
      days: 1,
      schedule: [{ day: 0, startOffsetSec: 0, durationSec: -5 }],
    }),
  ).toThrow("session schedule duration must be finite and > 0");
  expect(() =>
    runPattern(clockScenario({}), {
      id: "offline-heavy",
      days: 1,
      schedule: [
        { day: 0, startOffsetSec: 0, durationSec: 10 },
        { day: 0, startOffsetSec: 5, durationSec: 10 },
      ],
    }),
  ).toThrow("session schedule blocks overlap");

  const early = runPattern(
    clockScenario({ income: 1, until: (state) => state.t >= 10 }),
    {
      id: "offline-heavy",
      days: 1,
      schedule: [
        { day: 0, startOffsetSec: 0, durationSec: 100 },
        { day: 0, startOffsetSec: 500, durationSec: 100 },
      ],
    },
  );
  expect(early.summary.stop.reason).toBe("until");
  expect(early.summary.activeBlocks).toBe(1);
  expect(early.end.t).toBe(10);
  expect(early.summary.elapsedSec).toBe(10);
  expect(early.segments.some((segment) => segment.wallStartT === 500)).toBe(false);

  const goal = runPattern(
    clockScenario({
      income: 1,
      goals: [{ id: "ten", met: (state) => state.t >= 10 }],
    }),
    {
      id: "offline-heavy",
      days: 1,
      schedule: [
        { day: 0, startOffsetSec: 0, durationSec: 100 },
        { day: 0, startOffsetSec: 500, durationSec: 100 },
      ],
    },
  );
  expect(goal.summary.stop.reason).toBe("goal");
  expect(goal.summary.activeBlocks).toBe(1);
  expect(goal.end.t).toBe(10);
  expect(goal.segments.some((segment) => segment.wallStartT === 500)).toBe(false);

  const budget = runPattern(
    clockScenario({ income: 1, maxSteps: 2 }),
    {
      id: "offline-heavy",
      days: 1,
      schedule: [
        { day: 0, startOffsetSec: 100, durationSec: 10 },
        { day: 0, startOffsetSec: 500, durationSec: 10 },
      ],
    },
  );
  expect(budget.summary.stop.reason).toBe("horizon");
  expect(budget.summary.activeBlocks).toBe(2);
  expect(budget.summary.budgetStops).toBe(2);
  expect(budget.summary.activeSec).toBe(4);
  expect(budget.segments[0]?.clock.creditedSec).toBe(100);
  expect(budget.segments.filter((segment) => segment.kind === "active").map((segment) => segment.run.stop?.reason)).toEqual([
    "budget",
    "budget",
  ]);
  expect(budget.segments.filter((segment) => segment.kind === "active").map((segment) => segment.wallStartT)).toEqual([100, 500]);
  // The unsimulated rest of a cut block is not offline time: the gap starts at the planned end.
  expect(budget.segments.filter((segment) => segment.kind === "offline").map((segment) => segment.wallStartT)).toEqual([
    0, 110, 510,
  ]);
  // A cut block keeps its planned wall length; only reward and active time are short.
  const cut = budget.segments.find((segment) => segment.kind === "active")!;
  expect(cut.wallEndT).toBe(110);
  expect(cut.durationSec).toBe(2);
  expect(cut.clock).toEqual({ elapsedSec: 10, creditedSec: 2, activeSec: 2, lostRewardSec: 0 });
  let budgetWall = budget.start.t;
  for (const segment of budget.segments) {
    expect(segment.wallStartT).toBe(budgetWall);
    expect(segment.wallEndT - segment.wallStartT).toBe(segment.clock.elapsedSec);
    budgetWall = segment.wallEndT;
  }
  expect(budgetWall).toBe(budget.summary.elapsedSec);
  // always-on has no absence. A cut day must not turn its unsimulated rest into an
  // offline gap that a reject policy would refuse.
  const alwaysOn = runPattern(
    clockScenario({ income: 1, maxSteps: 10, offline: { maxSec: 60, overflowPolicy: "reject" } }),
    { id: "always-on", days: 2 },
  );
  expect(alwaysOn.summary.budgetStops).toBe(2);
  expect(alwaysOn.summary.activeSec).toBe(20);
  expect(alwaysOn.segments.filter((segment) => segment.kind === "offline").every((segment) => segment.clock.elapsedSec === 0)).toBe(true);
  // Each cut block leaves 8 unsimulated seconds that are not credited as offline reward.
  expect(budget.end.t).toBe(86400 - 16);
  expect(budget.summary.elapsedSec).toBe(86400);
  expect(budget.summary.lostRewardSec).toBe(0);

  const undeclaredSeen: Array<CompiledScenario<number, UnitCode, ClockVars>["ctx"]["clocks"]> = [];
  const undeclared = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp" },
      seen: undeclaredSeen,
    }),
    { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 12 * 3600, durationSec: 60 }] },
  );
  expect(undeclaredSeen[0]).toBeUndefined();
  expect(undeclared.segments[0]?.endT).toBe(3600);
  expect(undeclared.segments[0]?.wallEndT).toBe(12 * 3600);

  const declaredSeen: Array<CompiledScenario<number, UnitCode, ClockVars>["ctx"]["clocks"]> = [];
  const declared = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp" },
      clocks: { respondsTo: ["wall", "reward", "active"] },
      seen: declaredSeen,
    }),
    { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 12 * 3600, durationSec: 60 }] },
  );
  expect(declaredSeen[0]?.wallT).toBe(0);
  expect(declaredSeen[0]?.wallEndT).toBe(12 * 3600);
  expect(declaredSeen[0]?.rewardT).toBe(0);
  expect(declared.segments[0]?.endT).toBe(3600);

  const truncated = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp" },
      eventLog: { enabled: true, maxEvents: 0 },
    }),
    { id: "offline-heavy", days: 1 },
  );
  const retained = runPattern(
    clockScenario({
      income: 1,
      offline: { maxSec: 3600, overflowPolicy: "clamp" },
      eventLog: { enabled: true },
    }),
    { id: "offline-heavy", days: 1 },
  );
  expect(truncated.summary.elapsedSec).toBe(retained.summary.elapsedSec);
  expect(truncated.summary.offlineCreditedSec).toBe(retained.summary.offlineCreditedSec);
  expect(truncated.summary.activeSec).toBe(retained.summary.activeSec);
  expect(truncated.summary.lostRewardSec).toBe(retained.summary.lostRewardSec);
  expect(truncated.run.stats?.money).toEqual(retained.run.stats?.money);
  expect(truncated.end.wallet.money.amount).toBe(retained.end.wallet.money.amount);
  expect(truncated.run.observation?.legacyEventFallback).toBe(false);
}

describe("PR-06 session clocks", () => {
  it("keeps session clocks distinct", keepsSessionClocksDistinct);
});

describe("session segments", () => {
  const twoBlocks = {
    id: "offline-heavy" as const,
    days: 1,
    schedule: [
      { day: 0, startOffsetSec: 100, durationSec: 1 },
      { day: 0, startOffsetSec: 300, durationSec: 1 },
    ],
  };
  const alwaysPrestige: Strategy<number, UnitCode, ClockVars> = {
    id: "always-prestige",
    decide(ctx, model, state) {
      return model.actions(ctx, state).map((action) => ({ action }));
    },
  };
  const cooling = (): CompiledScenario<number, UnitCode, ClockVars> => ({
    ...clockScenario({
      actions: [prestigeAction()],
      strategy: alwaysPrestige,
      offline: { actions: { mode: "none" } },
    }),
    constraints: { minPrestigeIntervalSec: 3600 },
  });
  const warnings = (run: { events: readonly { type: string; code?: string }[] }) =>
    run.events.flatMap((event) => (event.type === "warning" && event.code ? [event.code] : []));

  it("carries the prestige cooldown anchor into later segments", () => {
    const resets: number[] = [];
    const base = cooling();
    const out = runPattern({ ...base, run: { ...base.run, onPrestigeReset: (t) => resets.push(t) } }, twoBlocks);
    const active = out.segments.filter((segment) => segment.kind === "active");
    expect(active[0]?.run.end.prestige.count).toBe(1);
    expect(warnings(active[0]!.run)).toContain("PRESTIGE_COOLDOWN_UNANCHORED");
    expect(active[1]?.run.end.prestige.count).toBe(1);
    expect(warnings(active[1]!.run)).toContain("PRESTIGE_COOLDOWN");
    expect(warnings(active[1]!.run)).not.toContain("PRESTIGE_COOLDOWN_UNANCHORED");
    expect(resets).toEqual([100]);

    const legacy = cooling();
    const away = runPattern(
      { ...legacy, run: { ...legacy.run, offline: { actions: { mode: "legacy-all" } } } },
      { ...twoBlocks, schedule: twoBlocks.schedule.slice(0, 1) },
    );
    const applied = away.segments.flatMap(
      (segment) => segment.run.eventTimeline?.filter((frame) => frame.event.type === "action.applied").map((frame) => frame.t) ?? [],
    );
    expect(applied.slice(0, 3)).toEqual([0, 3600, 7200]);
    expect(away.segments.filter((segment) => warnings(segment.run).includes("PRESTIGE_COOLDOWN_UNANCHORED"))).toHaveLength(1);

    const mc = simulateMonteCarlo({
      scenario: cooling(),
      draws: 1,
      seed: 1,
      sessionPattern: twoBlocks,
      metrics: ({ session }) => session!.segments.filter((segment) => segment.kind === "active").map((segment) => segment.run.end.prestige.count),
    });
    expect(mc.results[0]?.metrics).toEqual([1, 1]);
  });

  it("keeps the caller's trace and action budgets on a session", () => {
    const buyEveryStep: Strategy<number, UnitCode, ClockVars> = {
      id: "buy-every-step",
      decide(ctx, model, state) {
        return model.actions(ctx, state).map((action) => ({ action }));
      },
    };
    const base = clockScenario({ income: 1, actions: [buyAction("buy", "bought", "player")], strategy: buyEveryStep });
    const bounded = runPattern(
      { ...base, run: { ...base.run, trace: { maxPoints: 5, maxActions: 2 } } },
      { id: "short-bursts", days: 1 },
    );
    expect(bounded.summary.activeBlocks).toBe(10);
    expect(bounded.run.trace).toHaveLength(5);
    expect(bounded.run.trace?.at(-1)?.t).toBe(bounded.segments.at(-2)?.endT);
    expect(bounded.run.traceLog).toEqual({ maxPoints: 5, totalSeen: 610, dropped: 605, retained: 5 });
    expect(bounded.run.actionsLog).toHaveLength(2);
    const activeBuys = bounded.segments
      .filter((segment) => segment.kind === "active")
      .reduce((sum, segment) => sum + (segment.run.stats?.actions.applied ?? 0), 0);
    expect(bounded.run.actionsLogMeta).toEqual({ maxActions: 2, totalSeen: activeBuys, dropped: activeBuys - 2, retained: 2 });
    for (const segment of bounded.segments) {
      if (segment.kind === "active") expect(segment.run.trace?.length ?? 0).toBeLessThanOrEqual(5);
    }

    const unbounded = runPattern(base, { id: "short-bursts", days: 1 });
    expect(unbounded.run.trace).toHaveLength(610);
    expect(unbounded.run.actionsLog).toHaveLength(activeBuys);
    expect(unbounded.run.traceLog).toBeUndefined();
    expect(unbounded.run.actionsLogMeta).toBeUndefined();
    expect(unbounded.end.vars.bought).toBe(bounded.end.vars.bought);
  });

  it("stops on goals only after every goal is reached", () => {
    const out = runPattern(
      clockScenario({
        income: 1,
        goals: [
          { id: "ten", met: (state) => state.t >= 10 },
          { id: "five-hundred", met: (state) => state.t >= 500 },
        ],
      }),
      { id: "offline-heavy", days: 1 },
    );
    expect(out.summary.stop.reason).toBe("goal");
    expect(out.summary.activeSec).toBe(300);
    expect(out.end.t).toBe(500);
    expect(out.run.observation?.goals).toEqual([
      { id: "ten", status: "reached", t: 10 },
      { id: "five-hundred", status: "reached", t: 500 },
    ]);

    const unreached = runPattern(
      clockScenario({
        income: 1,
        goals: [
          { id: "ten", met: (state) => state.t >= 10 },
          { id: "never", met: () => false },
        ],
      }),
      { id: "offline-heavy", days: 1 },
    );
    expect(unreached.summary.stop.reason).toBe("horizon");
    expect(unreached.end.t).toBe(86400);
    expect(unreached.run.observation?.goals.map((goal) => goal.status)).toEqual(["reached", "unreached"]);
  });

  it("evaluates session goals on a copy of the committed state", () => {
    // Vars are author-typed and writable. A predicate that counts its calls there must not
    // change the economy.
    const counting = (state: SimState<number, UnitCode, ClockVars>) => {
      state.vars.bought += 1;
      return false;
    };
    const out = runPattern(
      clockScenario({ income: 1, goals: [{ id: "counting", met: counting }] }),
      { id: "offline-heavy", days: 1 },
    );
    expect(out.summary.stop.reason).toBe("horizon");
    expect(out.end.vars.bought).toBe(0);
    expect(out.end.wallet.money.amount).toBe(86400);
  });

  it("counts invalid quotes in run, offline, and session observations", () => {
    const broken: Action<number, UnitCode, ClockVars> = {
      ...buyAction("broken", "bought", "player"),
      cost: () => coin(Number.POSITIVE_INFINITY),
    };
    const scenario = clockScenario({
      money: 10,
      actions: [broken],
      strategy: {
        id: "broken",
        decide(ctx, model, state) {
          return model.actions(ctx, state).map((action) => ({ action }));
        },
      },
    });
    const run = runScenario({ ...scenario, run: { ...scenario.run, durationSec: 3 } });
    expect(run.observation?.actions.skippedInvalidQuote).toBe(3);
    expect(run.end.vars.bought).toBe(0);

    const offline = applyOfflineSeconds({ scenario, seconds: 4 });
    expect(offline.observation?.actions.skippedInvalidQuote).toBe(4);

    const session = runPattern(scenario, {
      id: "offline-heavy",
      days: 1,
      schedule: [{ day: 0, startOffsetSec: 5, durationSec: 2 }],
    });
    const perSegment = session.segments.map((segment) => segment.run.observation?.actions.skippedInvalidQuote);
    expect(perSegment).toEqual([5, 2, 86393]);
    expect(session.run.observation?.actions.skippedInvalidQuote).toBe(86400);
    expect(session.run.observation?.actions.applied).toBe(0);
  });
});

describe("offline gaps cut by a session stop", () => {
  const twelveHourGap: SessionPatternSpec = {
    id: "offline-heavy",
    days: 1,
    schedule: [{ day: 0, startOffsetSec: 12 * 3600, durationSec: 60 }],
  };

  it("ends an uncapped gap at the stop time, not at the scheduled gap end", () => {
    const out = runPattern(
      clockScenario({ income: 1, goals: [{ id: "thousand", met: (state) => state.t >= 1000 }] }),
      { id: "offline-heavy", days: 1 },
    );
    expect(out.summary.stop.reason).toBe("goal");
    expect(out.end.t).toBe(1000);
    expect(out.summary.activeSec).toBe(300);
    expect(out.summary.elapsedSec).toBe(1000);
    expect(out.summary.offlineElapsedSec).toBe(700);
    expect(out.summary.offlineCreditedSec).toBe(700);
    expect(out.summary.lostRewardSec).toBe(0);
    const gap = out.segments.at(-1)!;
    expect(gap.kind).toBe("offline");
    expect(gap.wallStartT).toBe(300);
    expect(gap.wallEndT).toBe(1000);
    expect(gap.clock).toEqual({ elapsedSec: 700, creditedSec: 700, activeSec: 0, lostRewardSec: 0 });

    const until = runPattern(clockScenario({ income: 1, until: (state) => state.t >= 1000 }), {
      id: "offline-heavy",
      days: 1,
    });
    expect(until.summary.stop.reason).toBe("until");
    expect(until.summary.elapsedSec).toBe(1000);
  });

  it("ends a clamped gap at the wall time that earned the stepped reward", () => {
    const out = runPattern(
      clockScenario({
        income: 1,
        offline: { maxSec: 3600, overflowPolicy: "clamp" },
        goals: [{ id: "thousand", met: (state) => state.t >= 1000 }],
      }),
      twelveHourGap,
    );
    expect(out.summary.stop.reason).toBe("goal");
    expect(out.summary.activeBlocks).toBe(0);
    expect(out.end.t).toBe(1000);
    const gap = out.segments[0]!;
    expect(gap.wallStartT).toBe(0);
    expect(gap.wallEndT).toBe(1000);
    expect(gap.clock).toEqual({ elapsedSec: 1000, creditedSec: 1000, activeSec: 0, lostRewardSec: 0 });
    expect(out.summary.elapsedSec).toBe(1000);
    expect(out.summary.offlineElapsedSec).toBe(1000);
    expect(out.summary.lostRewardSec).toBe(0);
  });

  it("ends a decayed gap at the inverse of the decay curve at the stepped reward", () => {
    const offline = { maxSec: 3600, overflowPolicy: "clamp" as const, decay: { kind: "linear" as const, floorRatio: 0.25 } };
    const out = runPattern(
      clockScenario({ income: 1, offline, goals: [{ id: "six-hundred", met: (state) => state.t >= 600 }] }),
      twelveHourGap,
    );
    expect(out.summary.stop.reason).toBe("goal");
    expect(out.end.t).toBe(600);
    const gap = out.segments[0]!;
    // effective(r) = r - 0.75 r^2 / 3600 for r <= 3600, so the smallest r with 600 credited is
    // 2 * 600 / (1 + sqrt(1 - 4 * 600 * 0.75 / 3600)).
    const expected = 1200 / (1 + Math.sqrt(0.5));
    expect(gap.wallEndT).toBeCloseTo(expected, 9);
    expect(gap.clock.elapsedSec).toBeCloseTo(expected, 9);
    expect(gap.clock.creditedSec).toBe(600);
    expect(gap.clock.creditedSec).toBeLessThanOrEqual(gap.clock.elapsedSec);
    expect(gap.clock.lostRewardSec).toBeCloseTo(expected - 600, 9);
    expect(out.summary.elapsedSec).toBeCloseTo(expected, 9);
    expect(out.summary.lostRewardSec).toBeCloseTo(expected - 600, 9);

    const scenario = clockScenario({ income: 1, offline });
    const at = (seconds: number) => applyOfflineSeconds({ scenario, seconds }).offline.effectiveSec;
    expect(at(gap.clock.elapsedSec)).toBeCloseTo(600, 9);
    expect(at(gap.clock.elapsedSec - 1)).toBeLessThan(600);
  });
});
