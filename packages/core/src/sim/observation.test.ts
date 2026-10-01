import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { analyzeMilestones } from "./analysis/milestones";
import { maxNoRewardGapSec, mergeRewardGaps, observationContract, observationFromLegacyEvents, ObservationError } from "./observation";
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
 * @evidenceReview docs/requirements/active/observation-retention.md#req-pr05-observation-retention #4c5ab79 Re-read the section, then ran this function: retention changes the log, not the counters. A disabled observation is missing. A boundary gap is not the max of the pieces.
 * @evidence ./observation.ts#observationContract Reads the observation contract and rejects a measured zero for a disabled run.
 * @evidenceReview ./observation.ts#observationContract #7c97372 The declaration is idlekit.run-observation. This test reads that property and expects missing rates to stay null.
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
}

describe("PR-05 observation retention", () => {
  it("keeps stats independent of retention", keepsStatsIndependentOfRetention);
});
