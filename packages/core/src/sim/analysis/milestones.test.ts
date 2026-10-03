import { describe, expect, it } from "bun:test";
import { analyzeMilestones } from "./milestones";
import type { RunObservation } from "../observation";
import type { RunResult, SimEvent, TimedSimEvent, SimState } from "../types";

type UnitCode = "COIN";
type Vars = { owned: number };

function makeState(t: number, prestigeCount = 0): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: {
      money: { unit: { code: "COIN" }, amount: 0 },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
    prestige: { count: prestigeCount, points: prestigeCount, multiplier: 1 },
    vars: { owned: 0 },
  };
}

describe("analyzeMilestones", () => {
  it("collects event, action, and prestige milestones", () => {
    const events: SimEvent<number>[] = [{ type: "milestone", key: "system.unlock" }];
    const eventTimeline: TimedSimEvent<number>[] = [{ t: 12, event: events[0]! }];
    const run: RunResult<number, UnitCode, Vars> = {
      start: makeState(0, 0),
      end: makeState(20, 1),
      events,
      eventTimeline,
      actionsLog: [{ t: 5, actionId: "buy.generator" }],
      trace: [makeState(0, 0), makeState(20, 1)],
    };

    const report = analyzeMilestones({ run });
    expect(report.firstActionSec).toBe(5);
    expect(report.firstPrestigeSec).toBe(20);
    expect(report.milestones.some((x) => x.key === "system.unlock")).toBeTrue();
    expect(report.milestones.some((x) => x.key === "action.buy.generator.firstApplied")).toBeTrue();
    expect(report.milestones.some((x) => x.key === "prestige.first")).toBeTrue();
  });

  it("keeps milestone coverage complete when only goals were capped", () => {
    const observation = (droppedMilestones: number, droppedGoals: number): RunObservation => ({
      contract: "idlekit.run-observation",
      version: 1,
      coverage: droppedMilestones > 0 || droppedGoals > 0 ? "partial" : "complete",
      legacyEventFallback: false,
      money: { status: "observed", applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 0 },
      actions: { status: "observed", applied: 0, skippedCannotApply: 0, skippedInsufficientFunds: 0, skippedInvalidQuote: 0, skippedCooldown: 0 },
      rewardGap: { status: "missing", startT: 0, endT: 20, interiorMaxGapSec: 0 },
      milestones: [{ key: "level-1", firstSeenT: 3, source: "milestone" }],
      goals: [],
      droppedMilestones,
      droppedGoals,
    });
    const run = (droppedMilestones: number, droppedGoals: number): RunResult<number, UnitCode, Vars> => ({
      start: makeState(0),
      end: makeState(20),
      events: [],
      observation: observation(droppedMilestones, droppedGoals),
    });
    expect(analyzeMilestones({ run: run(0, 2) }).coverage).toBe("complete");
    expect(analyzeMilestones({ run: run(1, 0) }).coverage).toBe("partial");
  });
});
