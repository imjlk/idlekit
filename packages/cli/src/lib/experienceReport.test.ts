import { describe, expect, it } from "bun:test";
import { milestoneTime, renderExperienceMarkdown, type ExperienceSnapshot } from "./experience";

function snapshot(): ExperienceSnapshot {
  return {
    endMoney: "100", endNetWorth: "200", endNetWorthLog10: Math.log10(200),
    growth: {
      windowSec: 60, seriesRequested: "netWorth", valueSource: "netWorth",
      segments: [{ tFrom: 0, tTo: 1, regime: "stall", slope: 0 }],
      bottlenecks: [{ t: 1, reason: "stall" }],
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
  it("preserves short intervals and distinct adjacent endpoints", () => {
    const data = snapshot();
    const from = 1e12;
    const to = from + 0.001;
    const report = renderExperienceMarkdown({ scenarioPath: "short.json", mode: "deterministic", snapshot: {
      ...data, growth: { ...data.growth, segments: [
        { tFrom: 0.001, tTo: 0.002, regime: "stall", slope: 0 },
        { tFrom: from, tTo: to, regime: "stall", slope: 0 },
      ] },
    } });
    expect(report).toContain("| 0.001s | 0.002s | stall |");
    expect(report).toContain(`| ${from}s | ${to}s | stall |`);
  });

  it("shows retained-independent first times and sampled stall windows", () => {
    const data = { ...snapshot(), endPrestige: { count: 1, points: "10", multiplier: "2" } };
    const report = renderExperienceMarkdown({ scenarioPath: "capped.json", mode: "deterministic", snapshot: data });
    expect(report).toContain("First milestone: 0s");
    expect(report).not.toContain("none observed");
    expect(report).toContain("Milestone coverage: partial");
    expect(report).toContain("First prestige: 8s");
    expect(report).toContain("Final prestige multiplier: `2`");
    expect(report).toContain("| 0s | 1s | stall |");
    expect(report).toContain("Configured sampling window: 60s");
    expect(report).not.toContain("60s samples");
    expect(report).toContain("counterfactual");
  });

  it("requires complete coverage for exact keys that can collide with summary facts", () => {
    const milestones = snapshot().milestones;
    expect(() => milestoneTime(milestones, "prestige.first")).toThrow("complete milestone report");
    expect(() => milestoneTime(milestones, "action.first")).toThrow("complete milestone report");
    expect(() => milestoneTime(milestones, "custom.key")).toThrow("complete milestone report");
    expect(() => milestoneTime({ ...milestones, coverage: "incomplete" }, "prestige.first")).toThrow("complete milestone report");
  });

  it("keeps emitted keys distinct from first-action and prestige summary facts", () => {
    const report = {
      ...snapshot().milestones,
      coverage: "complete" as const,
      milestones: [
        { key: "action.first", firstSeenT: 3, firstSeenSec: 3, source: "event" as const },
        { key: "prestige.first", firstSeenT: 5, firstSeenSec: 5, source: "event" as const },
      ],
    };
    expect(milestoneTime(report, "action.first")).toBe(3);
    expect(milestoneTime(report, "prestige.first")).toBe(5);
  });
});
