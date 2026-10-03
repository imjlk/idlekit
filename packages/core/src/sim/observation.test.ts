import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { analyzeMilestones } from "./analysis/milestones";
import { createSimStatsAccumulator } from "./analysis/ux";
import { maxNoRewardGapSec, mergeObservations, mergeRewardGaps, observationContract, observationFromLegacyEvents, ObservationError } from "./observation";
import { createGreedyStrategy } from "./strategy/greedy";
import { runScenario } from "./simulator";
import type { CompiledScenario, Model, SimState } from "./types";

type UnitCode = "COIN";

/** Repro label. The runs below do not draw from this value. */
export const observationCaseSeed = 0x7105;

function state(amount = 0): SimState<number, UnitCode, { owned: number }> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned: 0 },
  };
}

function scenario(args: {
  income: number | ((t: number) => number);
  durationSec: number;
  stepSec?: number;
  eventLog?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["eventLog"];
  fast?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["fast"];
  observation?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["observation"];
  trace?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["trace"];
  observer?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["observer"];
  goals?: CompiledScenario<number, UnitCode, { owned: number }>["run"]["goals"];
  milestones?: string[];
}): CompiledScenario<number, UnitCode, { owned: number }> {
  const model: Model<number, UnitCode, { owned: number }> = {
    id: "observe",
    version: 1,
    income: (ctx, current) => ({
      unit: ctx.unit,
      amount: typeof args.income === "number" ? args.income : args.income(current.t),
    }),
    actions: () => [
      {
        id: "buy",
        kind: "custom",
        canApply: () => true,
        cost: () => null,
        apply: (_ctx, current) => current,
      },
    ],
    milestones: () => args.milestones ?? [],
  };
  return {
    ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: observationCaseSeed },
    model,
    initial: state(),
    strategy: { id: "buy-once", decide: () => [{ action: model.actions(undefined as never, undefined as never)[0]! }] },
    run: {
      stepSec: args.stepSec ?? 1,
      durationSec: args.durationSec,
      eventLog: args.eventLog,
      fast: args.fast,
      observation: args.observation,
      trace: args.trace,
      observer: args.observer,
      goals: args.goals,
    },
  };
}

/**
 * @evidence docs/requirements/active/observation-retention.md#req-pr05-observation-retention Compares four retention policies, a fast run, a milestone cap, a trace budget, and a throwing observer.
 * @evidenceReview docs/requirements/active/observation-retention.md#req-pr05-observation-retention #15fc049 Re-read the section, including the session trace budget sentence that the session tests cover, then ran this function: retention changes the log, not the counters. A disabled observation is missing. A boundary gap is not the max of the pieces.
 * @evidence ./observation.ts#observationContract Reads the observation contract and rejects a measured zero for a disabled run.
 * @evidenceReview ./observation.ts#observationContract #7c97372 The declaration is idlekit.run-observation. This test reads that property and expects missing rates to stay null.
 * @evidence ./observation.ts#maxNoRewardGapSec A run with no reward reports the whole 5s span, and each boundary run reports its 8s edge gap.
 * @evidenceReview ./observation.ts#maxNoRewardGapSec #ccf099e Re-read maxNoRewardGapSec: a missing gap is null, no reward returns the whole span, and otherwise it is the largest of the leading edge, the trailing edge, and the interior gap. Ran this function: the quiet run gives 5, each boundary run gives 8, and the joined gap gives 16.
 * @evidence ./observation.ts#mergeRewardGaps Joining the two boundary runs gives a 16s interior gap, not the 8s maximum of either piece.
 * @evidenceReview ./observation.ts#mergeRewardGaps #2334887 Re-read mergeRewardGaps and its pair merge: an empty list is missing, a missing part makes the result missing, and two observed parts add the gap between the left last reward and the right first reward. Ran this function: rewards at 2 and 18 merge to interior 16.
 * @evidence ./observation.ts#mergeObservations Two complete runs sum their money counters, a disabled part makes the merge disabled with missing counters, and a legacy part makes it incomplete.
 * @evidenceReview ./observation.ts#mergeObservations #3a013eb Re-read mergeObservations: coverage takes incomplete, then disabled, then partial, money and action counters are summed only when every part is observed and none is a legacy fallback, and goals keep the earliest reached time. Ran this function: two plain runs sum to twice the applied count, plain with disabled is disabled with missing zero counters, and plain with legacy is incomplete and missing.
 * @evidence ./observation.ts#statsFromObservation Four retention policies report the same applied money and action counts, and a disabled observation reports missing with a null dropped rate.
 * @evidenceReview ./observation.ts#statsFromObservation #d271a75 Re-read statsFromObservation: it passes coverage, money, and action counters from the observation to simStatsFromCounters and does not read events. Ran this function: four retention policies report applied money 6 and actions 6, and the disabled run reports status missing, a null dropped rate, and coverage disabled.
 * @evidence ./observation.ts#createObservationRecorder Counts come from committed steps under every retention policy, a milestone cap marks partial coverage, a goal records its step end, goal.met sees a clone, and an observer throw becomes ObservationError.
 * @evidenceReview ./observation.ts#createObservationRecorder #bdb76e9 Re-read createObservationRecorder: it rejects a maxMilestones or maxGoals that is not an integer >= 0, recordStep counts observedMoney and action events from each committed step, caps milestones and goals separately, counts a met goal past maxGoals once and leaves it out of goals instead of reporting it unreached, hands goal.met a clone, wraps observer throws in ObservationError, and finish returns a disabled observation when recording is off. Ran this function: counters match across retention, maxMilestones 1 is partial, goal two is reached at t 2, the goal that writes its argument leaves the wallet at 0, and a throwing onStep throws ObservationError.
 * @evidence ./observation.ts#observationFromLegacyEvents An event-only result is incomplete, marked as a legacy fallback, and has a missing reward gap.
 * @evidenceReview ./observation.ts#observationFromLegacyEvents #7b6a96d Re-read observationFromLegacyEvents: it counts money and action events from a retained log and marks the result incomplete, legacyEventFallback true, with a missing reward gap. Ran this function: one applied action gives coverage incomplete, the fallback flag, and a missing reward gap.
 */
export function keepsStatsIndependentOfRetention(): void {
  expect(observationContract).toBe("idlekit.run-observation");
  expect(observationCaseSeed).toBe(0x7105);

  const runs = [
    runScenario(scenario({ income: 1, durationSec: 6 })),
    runScenario(scenario({ income: 1, durationSec: 6, eventLog: { enabled: false } })),
    runScenario(scenario({ income: 1, durationSec: 6, eventLog: { enabled: true, maxEvents: 0 } })),
    runScenario(scenario({ income: 1, durationSec: 6, eventLog: { enabled: true, maxEvents: 5 } })),
  ];
  const wallets = runs.map((run) => run.end.wallet.money.amount);
  expect(new Set(wallets).size).toBe(1);
  const applied = runs.map((run) => run.stats?.money.applied);
  expect(applied).toEqual([6, 6, 6, 6]);
  expect(runs.map((run) => run.stats?.actions.applied)).toEqual([6, 6, 6, 6]);
  expect(runs[1]?.events.length).toBe(0);
  expect(runs[2]?.eventLog?.retained).toBe(0);
  expect(runs[3]?.eventLog?.retained).toBe(5);
  expect(runs[0]?.observation?.coverage).toBe("complete");

  const plain = runScenario(scenario({ income: 1, durationSec: 4 }));
  const fast = runScenario(scenario({ income: 1, durationSec: 4, fast: { enabled: true, disableMoneyEvents: true } }));
  expect(fast.stats?.money.applied).toBe(plain.stats?.money.applied);
  expect(fast.stats?.money.dropped).toBe(plain.stats?.money.dropped);
  expect(fast.events.some((event) => event.type === "money")).toBe(false);
  expect(plain.events.some((event) => event.type === "money")).toBe(true);
  expect(fast.end.wallet.money.amount).toBe(plain.end.wallet.money.amount);

  const disabled = runScenario(scenario({ income: 1, durationSec: 4, observation: { enabled: false } }));
  expect(disabled.end.wallet.money.amount).toBe(plain.end.wallet.money.amount);
  expect(disabled.stats?.money.status).toBe("missing");
  expect(disabled.stats?.money.droppedRate).toBeNull();
  expect(disabled.stats?.coverage).toBe("disabled");
  expect(disabled.observation?.rewardGap.status).toBe("missing");

  const quiet = runScenario(scenario({ income: 0, durationSec: 5 }));
  expect(quiet.stats?.money.applied).toBe(5);
  expect(maxNoRewardGapSec(quiet.observation!.rewardGap)).toBe(5);
  const boundaryLeft = runScenario(scenario({ income: (t) => (t === 1 ? 1 : 0), durationSec: 10 }));
  const boundaryRight = runScenario({
    ...scenario({ income: (t) => (t === 17 ? 1 : 0), durationSec: 10 }),
    initial: { ...state(), t: 10 },
  });
  expect(boundaryLeft.observation?.rewardGap).toMatchObject({ startT: 0, endT: 10, firstRewardT: 2, lastRewardT: 2 });
  expect(boundaryRight.observation?.rewardGap).toMatchObject({ startT: 10, endT: 20, firstRewardT: 18, lastRewardT: 18 });
  expect(maxNoRewardGapSec(boundaryLeft.observation!.rewardGap)).toBe(8);
  expect(maxNoRewardGapSec(boundaryRight.observation!.rewardGap)).toBe(8);
  const joined = mergeRewardGaps([boundaryLeft.observation!.rewardGap, boundaryRight.observation!.rewardGap]);
  expect(joined.interiorMaxGapSec).toBe(16);
  expect(maxNoRewardGapSec(joined)).toBe(16);
  expect(runs[3]?.observation?.milestones.some((sample) => sample.key === "action.buy.firstApplied")).toBe(true);

  const capped = runScenario(scenario({ income: 1, durationSec: 1, milestones: ["a", "b", "c"], observation: { maxMilestones: 1 } }));
  const open = runScenario(scenario({ income: 1, durationSec: 1, milestones: ["a", "b", "c"], observation: { maxMilestones: 8 } }));
  expect(capped.end.wallet.money.amount).toBe(open.end.wallet.money.amount);
  expect(capped.observation?.coverage).toBe("partial");
  expect(capped.observation?.milestones.length).toBe(1);
  expect(capped.observation?.droppedMilestones).toBeGreaterThan(0);
  expect(analyzeMilestones({ run: capped }).coverage).toBe("partial");
  expect(analyzeMilestones({ run: open }).milestones.length).toBeGreaterThan(1);

  const traced = runScenario(scenario({ income: 1, durationSec: 4, trace: { everySteps: 1, maxPoints: 1 } }));
  const fullTrace = runScenario(scenario({ income: 1, durationSec: 4, trace: { everySteps: 1 } }));
  expect(traced.end.wallet.money.amount).toBe(fullTrace.end.wallet.money.amount);
  expect(traced.stats).toEqual(fullTrace.stats);
  expect(traced.trace?.length).toBe(1);
  expect((traced.traceLog?.dropped ?? 0) > 0).toBe(true);
  expect(fullTrace.traceLog).toBeUndefined();

  const goalRun = runScenario(
    scenario({
      income: 1,
      durationSec: 3,
      goals: [{ id: "two", met: (current) => current.wallet.money.amount >= 2 }],
    }),
  );
  expect(goalRun.observation?.goals).toEqual([{ id: "two", status: "reached", t: 2 }]);

  let steps = 0;
  const watched = runScenario(
    scenario({
      income: 1,
      durationSec: 3,
      observer: { onStep: () => { steps += 1; } },
    }),
  );
  expect(steps).toBe(3);
  expect(watched.end.wallet.money.amount).toBe(runScenario(scenario({ income: 1, durationSec: 3 })).end.wallet.money.amount);

  const poisoned = runScenario(
    scenario({
      income: 0,
      durationSec: 1,
      goals: [
        {
          id: "touch",
          met: (current) => {
            (current.wallet.money as { amount: number }).amount = 99;
            return false;
          },
        },
      ],
    }),
  );
  expect(poisoned.end.wallet.money.amount).toBe(0);

  expect(() =>
    runScenario(
      scenario({
        income: 1,
        durationSec: 2,
        observer: {
          onStep: () => {
            throw new Error("observer failed");
          },
        },
      }),
    ),
  ).toThrow(ObservationError);

  const legacy = observationFromLegacyEvents({
    startT: 0,
    endT: 2,
    events: [{ type: "action.applied", actionId: "buy" }],
  });
  expect(legacy.coverage).toBe("incomplete");
  expect(legacy.legacyEventFallback).toBe(true);
  expect(legacy.rewardGap.status).toBe("missing");

  const merged = mergeObservations([plain.observation!, plain.observation!]);
  expect(merged.coverage).toBe("complete");
  expect(merged.money.applied).toBe(2 * plain.observation!.money.applied);
  const withDisabled = mergeObservations([plain.observation!, disabled.observation!]);
  expect(withDisabled.coverage).toBe("disabled");
  expect(withDisabled.money.status).toBe("missing");
  expect(withDisabled.money.applied).toBe(0);
  expect(withDisabled.actions.status).toBe("missing");
  const withLegacy = mergeObservations([plain.observation!, legacy]);
  expect(withLegacy.coverage).toBe("incomplete");
  expect(withLegacy.legacyEventFallback).toBe(true);
  expect(withLegacy.money.status).toBe("missing");
}

describe("PR-05 observation retention", () => {
  it("keeps stats independent of retention", keepsStatsIndependentOfRetention);
});

describe("prestige cooldown counters", () => {
  it("counts a cooldown skip from a greedy run", () => {
    type Vars = { owned: number };
    const model: Model<number, UnitCode, Vars> = {
      id: "cooldown",
      version: 1,
      income: (ctx) => ({ unit: ctx.unit, amount: 0 }),
      actions: () => [
        {
          id: "reset",
          kind: "prestige",
          canApply: () => true,
          cost: () => null,
          bulk: () => [{ size: 1, cost: null, deltaIncomePerSec: { unit: { code: "COIN" }, amount: 1 } }],
          apply: (_ctx, current) => ({ ...current, prestige: { ...current.prestige, count: current.prestige.count + 1 } }),
        },
      ],
    };
    const run = runScenario<number, UnitCode, Vars>({
      ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: observationCaseSeed },
      model,
      initial: state(),
      constraints: { minPrestigeIntervalSec: 60 },
      strategy: createGreedyStrategy({ schemaVersion: 1, objective: "maximizeIncome" }),
      run: { stepSec: 1, durationSec: 5 },
    });
    expect(run.end.prestige.count).toBe(1);
    expect(run.observation?.actions.applied).toBe(1);
    expect(run.observation?.actions.skippedCooldown).toBe(4);
    expect(run.stats?.actions.skippedCooldown).toBe(4);
    expect(mergeObservations([run.observation!, run.observation!]).actions.skippedCooldown).toBe(8);
    const legacy = observationFromLegacyEvents({ startT: 0, endT: 5, events: run.events });
    expect(legacy.actions.skippedCooldown).toBe(4);
    const accumulator = createSimStatsAccumulator();
    accumulator.push(run.events);
    expect(accumulator.snapshot().actions.skippedCooldown).toBe(4);
  });
});

describe("goal retention", () => {
  it("omits a met goal past maxGoals instead of reporting it unreached", () => {
    const goals = [
      { id: "one", met: (current: SimState<number, UnitCode, { owned: number }>) => current.wallet.money.amount >= 1 },
      { id: "two", met: (current: SimState<number, UnitCode, { owned: number }>) => current.wallet.money.amount >= 2 },
    ];
    const none = runScenario(scenario({ income: 1, durationSec: 4, goals, observation: { maxGoals: 0 } }));
    expect(none.observation?.goals).toEqual([]);
    expect(none.observation?.droppedGoals).toBe(2);
    expect(none.observation?.coverage).toBe("partial");
    const one = runScenario(scenario({ income: 1, durationSec: 4, goals, observation: { maxGoals: 1 } }));
    expect(one.observation?.goals).toEqual([{ id: "one", status: "reached", t: 1 }]);
    expect(one.observation?.droppedGoals).toBe(1);
    const open = runScenario(scenario({ income: 1, durationSec: 4, goals: [...goals, { id: "far", met: () => false }] }));
    expect(open.observation?.goals.map((goal) => goal.status)).toEqual(["reached", "reached", "unreached"]);
    expect(open.observation?.droppedGoals).toBe(0);
  });
});

describe("log and observation budgets", () => {
  it("rejects a trace or observation budget that is not an integer >= 0", () => {
    for (const bad of [-1, Number.NaN, 1.5]) {
      expect(() => runScenario(scenario({ income: 1, durationSec: 3, trace: { maxPoints: bad } }))).toThrow(
        "runScenario trace.maxPoints must be an integer >= 0",
      );
      expect(() =>
        runScenario(scenario({ income: 1, durationSec: 3, trace: { keepActionsLog: true, maxActions: bad } })),
      ).toThrow("runScenario trace.maxActions must be an integer >= 0");
      expect(() => runScenario(scenario({ income: 1, durationSec: 3, observation: { maxMilestones: bad } }))).toThrow(
        "observation.maxMilestones must be an integer >= 0",
      );
    }
    const kept = runScenario(scenario({ income: 1, durationSec: 3, trace: { maxPoints: 2 } }));
    expect(kept.trace).toHaveLength(2);
  });
});
