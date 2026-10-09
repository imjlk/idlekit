import { describe, expect, it } from "bun:test";
import { milestoneTime, renderExperienceMarkdown, type ExperienceSnapshot } from "./experience";

function snapshot(): ExperienceSnapshot {
  return {
    endMoney: "100", endNetWorth: "200", endNetWorthLog10: Math.log10(200),
    growth: {
      windowSec: 60, seriesRequested: "netWorth", valueSource: "netWorth",
      segments: [{ tFrom: 0, tTo: 60, regime: "stall", slope: 0 }],
      bottlenecks: [{ t: 60, reason: "stall" }],
    },
    milestones: { milestones: [], coverage: "partial", firstMilestoneSec: 0, firstActionSec: 0, firstPrestigeSec: 8 },
    perceived: {
      series: "netWorth", visibleChangesPerMinute: 1, maxNoRewardGapSec: 12,
      visibleChangeCount: 2, activeSeconds: 120,
    },
    session: {
      pattern: { id: "always-on", days: 1 }, activeBlocks: 1, totalActiveSec: 120,
      totalOfflineSec: 0, elapsedSec: 86400, horizonSec: 86400, activeSec: 120,
      offlineElapsedSec: 0, offlineCreditedSec: 0, lostRewardSec: 0, rewardSec: 120,
      budgetStops: 1, stopReason: "horizon",
    },
  };
}

describe("experience report coverage and interpretation", () => {
  it("shows retained-independent first times and sampled stall windows", () => {
    const data = { ...snapshot(), endPrestige: { count: 1, points: "10", multiplier: "2" } };
    const report = renderExperienceMarkdown({ scenarioPath: "capped.json", mode: "deterministic", snapshot: data });
    expect(report).toContain("First milestone: 0s");
    expect(report).not.toContain("none observed");
    expect(report).toContain("Milestone coverage: partial");
    expect(report).toContain("First prestige: 8s");
    expect(report).toContain("Final prestige multiplier: `2`");
    expect(report).toContain("| 0s | 60s | stall |");
    expect(report).toContain("counterfactual");
  });

  it("uses known builtin first times under a cap while refusing unknown keys", () => {
    const milestones = snapshot().milestones;
    expect(milestoneTime(milestones, "prestige.first")).toBe(8);
    expect(milestoneTime(milestones, "action.first")).toBe(0);
    expect(() => milestoneTime(milestones, "custom.key")).toThrow("complete milestone report");
    expect(() => milestoneTime({ ...milestones, coverage: "incomplete" }, "prestige.first")).toThrow("complete milestone report");
  });
});
