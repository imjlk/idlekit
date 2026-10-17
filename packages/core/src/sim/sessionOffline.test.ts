import { expect, test } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine, type Engine } from "@idlekit/money";
import {
  simulateSessionPattern, type CompiledScenario, type SessionOfflinePreparation,
} from "../index";

type Vars<N> = { rate: N; returns: number };
function fixture<N>(E: Engine<N>): CompiledScenario<N, "COIN", Vars<N>> {
  const unit = { code: "COIN" as const };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" } },
    model: { id: "active", version: 1, income: ctx => ({ unit, amount: ctx.E.from(1) }), actions: () => [] },
    initial: { t: 0, vars: { rate: E.from(10), returns: 0 },
      wallet: { money: { unit, amount: E.zero() }, bucket: E.zero() },
      maxMoneyEver: { unit, amount: E.zero() },
      prestige: { count: 0, points: E.zero(), multiplier: E.from(1) } },
    run: { stepSec: 1, offline: { actions: { mode: "none" } }, eventLog: { maxEvents: 0 } },
  };
}
const pattern = { id: "twice-daily" as const, days: 1, schedule: [
  { day: 0, startOffsetSec: 0, durationSec: 1 },
  { day: 0, startOffsetSec: 10, durationSec: 1 },
] };

function checkAtomicPreparation<N>(E: Engine<N>) {
  const scenario = fixture(E);
  const before = JSON.stringify(scenario.initial);
  const calls: number[][] = [];
  let decisions = 0;
  const result = simulateSessionPattern({ scenario: { ...scenario,
    strategy: { id: "count", decide: () => { decisions++; return []; } } }, pattern,
    prepareOffline: ({ state, ctx, model, seconds, wallStartT, wallEndT }) => {
      calls.push([seconds, wallStartT, wallEndT, state.t]);
      const maxSec = state.vars.returns === 0 ? 4 : 2;
      expect(ctx.E.toString(state.vars.rate)).toBe("10");
      state.vars.returns++;
      return { stepSec: maxSec, policy: { maxSec }, model: { ...model,
        income: () => ({ unit: ctx.unit, amount: state.vars.rate }),
        evolve: (_ctx, current) => ({ ...current, vars: state.vars }),
      } };
    },
  });
  expect(calls).toEqual([[9, 1, 10, 1], [86389, 11, 86400, 6]]);
  expect(E.toString(result.end.wallet.money.amount)).toBe("62");
  expect(result.end.vars.returns).toBe(2);
  expect(decisions).toBe(2);
  expect(result.summary).toMatchObject({ elapsedSec: 86400, activeSec: 2,
    offlineElapsedSec: 86398, offlineCreditedSec: 6, lostRewardSec: 86392, rewardSec: 8 });
  expect(result.run.eventLog?.retained).toBe(0);
  expect(result.run.stats?.money.applied).toBe(4);
  expect(JSON.stringify(scenario.initial)).toBe(before);
}
test("offline preparation uses real wall intervals, dynamic caps and one return effect per gap", () => {
  checkAtomicPreparation(createNumberEngine());
  checkAtomicPreparation(createBreakInfinityEngine());
});

test("a selected credit policy also controls the inverse wall clock of an until stop", () => {
  const scenario = fixture(createNumberEngine());
  const result = simulateSessionPattern({ scenario: { ...scenario, run: { ...scenario.run,
    offline: { maxSec: 1, actions: { mode: "none" } }, until: state => state.wallet.money.amount >= 10 } },
    pattern: { id: "twice-daily", days: 1, schedule: [{ day: 0, startOffsetSec: 100, durationSec: 1 }] },
    prepareOffline: () => ({ stepSec: 5, policy: { maxSec: 80, decay: { kind: "linear", floorRatio: 0.5 } } }),
  });
  const absence = 20 / (1 + Math.sqrt(1 - 4 * 0.5 / 80 * 10));
  expect(result.summary.stop.reason).toBe("until");
  expect(result.summary.activeSec).toBe(0);
  expect(result.summary.offlineCreditedSec).toBe(10);
  expect(result.summary.elapsedSec).toBeCloseTo(absence, 10);
  expect(result.summary.lostRewardSec).toBeCloseTo(absence - 10, 10);
});

test("an empty preparation retains the default runner and always-on sessions have no offline callback", () => {
  const scenario = fixture(createNumberEngine());
  const baseline = simulateSessionPattern({ scenario, pattern });
  expect(simulateSessionPattern({ scenario, pattern, prepareOffline: () => ({}) })).toEqual(baseline);
  let calls = 0;
  simulateSessionPattern({ scenario: { ...scenario, run: { ...scenario.run, stepSec: 86400 } },
    pattern: { id: "always-on", days: 1 }, prepareOffline: () => { calls++; return {}; } });
  expect(calls).toBe(0);
});

test("invalid preparation cannot mutate the source checkpoint or override session action policy", () => {
  const scenario = fixture(createNumberEngine());
  const before = JSON.stringify(scenario.initial);
  const bad: unknown[] = [null, [], Promise.resolve({}), { stepSec: 0 }, { stepSec: NaN },
    { policy: { maxSec: NaN } }, { policy: { maxSec: -1 } },
    { policy: { decay: { kind: "linear", floorRatio: 2 } } },
    { policy: { actions: { mode: "legacy-all" } } }, { model: {} }, { model: null }];
  for (const value of bad) {
    expect(() => simulateSessionPattern({ scenario,
      pattern: { id: "twice-daily", days: 1, schedule: [{ day: 0, startOffsetSec: 10, durationSec: 1 }] },
      prepareOffline: ({ state }) => { state.vars.returns = 99;
        return value as SessionOfflinePreparation<number, "COIN", Vars<number>>; },
    })).toThrow();
    expect(JSON.stringify(scenario.initial)).toBe(before);
  }
});

test("zero credit and an initial goal do not commit a prepared return effect", () => {
  const scenario = fixture(createNumberEngine());
  for (const goal of [false, true]) {
    let transitions = 0;
    const result = simulateSessionPattern({ scenario: { ...scenario,
      run: { ...scenario.run, ...(goal ? { goals: [{ id: "ready", met: () => true }] } : {}) } },
      pattern: { id: "twice-daily", days: 1, schedule: [{ day: 0, startOffsetSec: 10, durationSec: 1 }] },
      prepareOffline: ({ model }) => ({ policy: { maxSec: goal ? 10 : 0 }, model: { ...model,
        evolve: (_ctx, current) => { transitions++; return current; },
      } }),
    });
    expect(transitions).toBe(0);
    expect(result.summary.offlineCreditedSec).toBe(0);
    expect(result.summary.elapsedSec).toBe(goal ? 0 : 86400);
    expect(result.summary.stop.reason).toBe(goal ? "goal" : "horizon");
  }
});

test("empty credit policy removes the old cap and decay without changing action filtering", () => {
  const scenario = fixture(createNumberEngine());
  let decisions = 0;
  const result = simulateSessionPattern({ scenario: { ...scenario,
    strategy: { id: "count", decide: () => { decisions++; return []; } },
    run: { ...scenario.run, offline: { maxSec: 0, decay: { kind: "linear", floorRatio: 0 }, actions: { mode: "none" } } } },
    pattern, prepareOffline: ({ seconds }) => ({ policy: {}, stepSec: seconds }),
  });
  expect(result.summary.offlineCreditedSec).toBe(86398);
  expect(result.summary.lostRewardSec).toBe(0);
  expect(decisions).toBe(2);
});

test("a replacement model owns its clock declaration for that gap only", () => {
  for (const declaresActive of [false, true]) {
    const scenario = fixture(createNumberEngine());
    const clocks: Array<unknown> = [];
    simulateSessionPattern({ scenario: { ...scenario, model: { ...scenario.model,
      ...(declaresActive ? { clocks: { respondsTo: ["wall" as const] } } : {}),
      income: (ctx) => { clocks.push(ctx.clocks); return { unit: ctx.unit, amount: ctx.E.from(1) }; },
    } }, pattern, prepareOffline: () => ({ policy: { maxSec: 1 }, model: {
      id: "replacement", version: 1, actions: () => [],
      ...(!declaresActive ? { clocks: { respondsTo: ["wall" as const] } } : {}),
      income: (ctx) => { clocks.push(ctx.clocks); return { unit: ctx.unit, amount: ctx.E.from(1) }; },
    } }),
    });
    expect(clocks.length).toBe(4);
    expect(clocks[declaresActive ? 0 : 1]).toBeDefined();
    expect(clocks[declaresActive ? 1 : 0]).toBeUndefined();
    expect(clocks[declaresActive ? 2 : 3]).toBeDefined();
    expect(clocks[declaresActive ? 3 : 2]).toBeUndefined();
  }
});
