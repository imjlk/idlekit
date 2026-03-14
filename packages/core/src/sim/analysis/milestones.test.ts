import { describe, expect, it } from "bun:test";
import { analyzeMilestones } from "./milestones";
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
});
