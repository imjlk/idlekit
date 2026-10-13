import { analyzeDistribution, type DistributionSample } from "@idlekit/core";
import { describe, expect, it } from "bun:test";
import { milestoneTime, renderExperienceMarkdown, type ExperienceMonteCarloSummary, type ExperienceSnapshot } from "./experience";

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

function monteCarlo(samples: readonly DistributionSample[]): ExperienceMonteCarloSummary {
  const numeric = { mean: 10, quantiles: { q50: 10, q95: 10 } };
  return {
    draws: samples.length, seed: 1, quantiles: [0.5, 0.95],
    endNetWorthLog10: numeric, visibleChangesPerMinute: numeric, maxNoRewardGapSec: numeric,
    firstVisibleChangeSec: samples.some((sample) => sample.status === "observed") ? numeric : null,
    firstVisible: analyzeDistribution({ samples, quantiles: [0.5, 0.95], horizonSec: 120 }),
  };
}

describe("experience next checks", () => {
  it("turns budget, key coverage, offline loss, sampled stalls, and prestige into concrete checks without changing data", () => {
    const base = snapshot();
    const data = {
      ...base, endPrestige: { count: 1, points: "10", multiplier: "2" },
      session: { ...base.session, totalOfflineSec: 120, offlineElapsedSec: 120, offlineCreditedSec: 110, lostRewardSec: 10 },
    };
    const before = JSON.stringify(data);
    const report = renderExperienceMarkdown({ scenarioPath: "checks.json", mode: "deterministic", snapshot: data });
    expect(report).toContain("## Next checks");
    expect(report).toContain("Increase the step budget");
    expect(report).toContain("complete milestone observation");
    expect(report).toContain("cap or decay changed");
    expect(report).toContain("sampled stall or softcap windows");
    expect(report).toContain("matched run without that reset");
    expect(report).toContain("First milestone: 0s");
    expect(JSON.stringify(data)).toBe(before);
  });

  it("keeps quiet complete snapshots free of unrelated corrective advice", () => {
    const base = snapshot();
    const data: ExperienceSnapshot = {
      ...base, milestones: { milestones: [], coverage: "complete" },
      growth: { ...base.growth, segments: [], bottlenecks: [] },
      session: { ...base.session, budgetStops: 0 },
    };
    const report = renderExperienceMarkdown({ scenarioPath: "complete.json", mode: "deterministic", snapshot: data });
    const checks = report.split("## Next checks")[1]!;
    expect(checks).toContain("same initial state, horizon, session pattern, and seed policy");
    expect(checks).not.toContain("Increase the step budget");
    expect(checks).not.toContain("complete milestone observation");
    expect(checks).not.toContain("cap or decay changed");
    expect(checks).not.toContain("counterfactual");
    expect(checks).not.toContain("No visible change");
  });

  it("distinguishes an absent active window from a window with no visible change", () => {
    const base = snapshot();
    const noWindow = renderExperienceMarkdown({ scenarioPath: "empty.json", mode: "deterministic", snapshot: {
      ...base, perceived: { ...base.perceived, activeSeconds: 0, visibleChangeCount: 0 },
    } });
    expect(noWindow).toContain("Collect an active-play observation window");
    expect(noWindow).not.toContain("No visible change was observed in the active window");
    const noChange = renderExperienceMarkdown({ scenarioPath: "flat.json", mode: "deterministic", snapshot: {
      ...base, perceived: { ...base.perceived, activeSeconds: 120, visibleChangeCount: 0 },
    } });
    expect(noChange).toContain("No visible change was observed in the active window");
    expect(noChange).not.toContain("Collect an active-play observation window");
  });

  it("does not infer a reset in this session from an accumulated prestige count", () => {
    const base = snapshot();
    const report = renderExperienceMarkdown({ scenarioPath: "prior-prestige.json", mode: "deterministic", snapshot: {
      ...base, endPrestige: { count: 3, points: "10", multiplier: "2" },
      milestones: { milestones: [], coverage: "complete" },
    } });
    expect(report).toContain("First prestige: not observed");
    expect(report).toContain("Final prestige count: 3");
    expect(report.split("## Next checks")[1]).not.toContain("without that reset");
  });

  it("labels the recorded session and keeps conditional timings separate from unresolved population p95", () => {
    const samples: DistributionSample[] = Array.from({ length: 102 }, (_, drawIndex) => ({
      drawIndex, seed: drawIndex, source: "model-strategy-session",
      status: drawIndex < 90 ? "observed" : drawIndex < 100 ? "censored" : drawIndex === 100 ? "failed" : "unsupported",
      value: drawIndex < 90 ? "10" : null,
    }));
    const summary = monteCarlo(samples);
    const before = JSON.stringify(summary);
    const report = renderExperienceMarkdown({ scenarioPath: "mc.json", mode: "monte-carlo", snapshot: snapshot(), monteCarlo: summary });
    expect(report).toContain("Snapshot scope: one recorded session");
    expect(report).toContain("First visible observed / right-censored / failed / unsupported: 90 / 10 / 1 / 1");
    expect(report).toContain("First visible population p95: outside-observed-range");
    expect(report).not.toContain("First visible population p95: 10s");
    expect(report).toContain("10 draw(s) had no visible change through the last active observation on the reward-time clock");
    expect(report).toContain("Conditional observed-change timings describe only the observations that completed");
    expect(report).toContain("Resolve failed or unsupported draws");
    expect(JSON.stringify(summary)).toBe(before);
  });

  it("does not diagnose failed or unsupported draws as censoring", () => {
    const samples: DistributionSample[] = (["observed", "failed", "unsupported"] as const).map((status, drawIndex) => ({
      drawIndex, seed: drawIndex, source: "model-strategy-session", status,
      value: status === "observed" ? "10" : null,
    }));
    const report = renderExperienceMarkdown({ scenarioPath: "failed.json", mode: "monte-carlo", snapshot: snapshot(), monteCarlo: monteCarlo(samples) });
    expect(report).toContain("First visible observed / right-censored / failed / unsupported: 1 / 0 / 1 / 1");
    expect(report).toContain("First visible population p95: 10s");
    expect(report).toContain("Resolve failed or unsupported draws");
    expect(report).not.toContain("draw(s) had no visible change through the last active observation");
  });

  it("keeps an all-censored timing population unavailable", () => {
    const samples: DistributionSample[] = [0, 1, 2].map((drawIndex) => ({
      drawIndex, seed: drawIndex, source: "model-strategy-session", status: "censored", value: null,
    }));
    const report = renderExperienceMarkdown({ scenarioPath: "censored.json", mode: "monte-carlo", snapshot: snapshot(), monteCarlo: monteCarlo(samples) });
    expect(report).toContain("First visible population p95: unavailable");
    expect(report).not.toContain("First visible population p95: 0s");
    expect(report).toContain("3 draw(s) had no visible change through the last active observation on the reward-time clock");
  });
});
