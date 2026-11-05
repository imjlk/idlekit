import { describe, expect, it } from "bun:test";
import type { GrowthSegment } from "@idlekit/core";
import { buildCompareKpiRows } from "@idlekit/core";
import {
  PACING_TARGETS,
  compareDecisionHints,
  experienceDecisionHints,
  experimentDecisionHints,
  renderDecisionHints,
  slowWindowSummary,
  type ExperienceHintInput,
} from "./decisionHints";

const QUIET: ExperienceHintInput = {
  perceived: { firstVisibleChangeSec: 5, visibleChangesPerMinute: 4, maxNoRewardGapSec: 30, p95PostPurchaseFeedbackSec: 1, visibleChangeCount: 40, activeSeconds: 600 },
  growth: { segments: [{ tFrom: 0, tTo: 600, regime: "exp", slope: 0.01, doublingTimeSec: 30 }] },
  milestones: { coverage: "complete" },
  session: { budgetStops: 0, lostRewardSec: 0, offlineElapsedSec: 0 },
  endNetWorthLog10: 6,
};

describe("decision hints", () => {
  it("stays quiet when every reading meets the default targets", () => {
    expect(experienceDecisionHints(QUIET)).toEqual({ bottlenecks: [], adjustments: [], risks: [] });
  });

  it("measures pacing against the intent's targets", () => {
    const hints = experienceDecisionHints({
      ...QUIET,
      intent: "frequent-progression",
      perceived: { ...QUIET.perceived, firstVisibleChangeSec: 20, visibleChangesPerMinute: 0.5, maxNoRewardGapSec: 240, p95PostPurchaseFeedbackSec: 6 },
    });
    expect(PACING_TARGETS["frequent-progression"].firstVisibleSec).toBe(5);
    expect(hints.bottlenecks).toEqual([
      "First visible change at 20s is later than the `frequent-progression` target of 5s.",
      "Visible changes per minute is 0.5, below the `frequent-progression` target of 2.",
      "Longest no-reward gap is 240s, above the `frequent-progression` limit of 60s.",
      "P95 post-purchase feedback is 6s, above the `frequent-progression` limit of 3s.",
    ]);
    expect(hints.adjustments[0]).toContain("about 75% (20s → 5s)");
    expect(hints.adjustments[1]).toContain("about 4x");
    expect(hints.adjustments[2]).toContain("about 75%");
  });

  it("reads slow windows with a what-if only when exponential windows are a fair reference", () => {
    const mixed: GrowthSegment[] = [
      { tFrom: 0, tTo: 300, regime: "exp", slope: 0.02 },
      { tFrom: 300, tTo: 900, regime: "softcap", slope: 0.002 },
      { tFrom: 900, tTo: 1000, regime: "stall", slope: 0, doublingTimeSec: 7200 },
    ];
    const summary = slowWindowSummary({ segments: mixed });
    expect(summary.share).toBeCloseTo(0.7, 12);
    expect(summary.longest).toMatchObject({ tFrom: 300, tTo: 900 });
    expect(summary.referenceSlope).toBe(0.02);
    expect(summary.estimatedSec).toBeCloseTo(60, 9);
    const hints = experienceDecisionHints({ ...QUIET, growth: { segments: mixed } });
    expect(hints.bottlenecks[0]).toContain("cover 70% of the sampled growth trace (2 window(s)); growth first slows at 5m; by the end the tracked value doubles every 2h");
    expect(hints.adjustments[0]).toContain("about 60s instead of 10m (90% shorter)");

    const plateau = slowWindowSummary({ segments: [{ tFrom: 0, tTo: 5, regime: "exp", slope: 1 }, { tFrom: 5, tTo: 1000, regime: "softcap", slope: 0.001 }] });
    expect(plateau.referenceSlope).toBeUndefined();
    const plateauHints = experienceDecisionHints({
      ...QUIET,
      growth: { segments: [{ tFrom: 0, tTo: 5, regime: "exp", slope: 1 }, { tFrom: 5, tTo: 1000, regime: "softcap", slope: 0.001 }] },
    });
    expect(plateauHints.adjustments[0]).toStartWith("Growth leaves the exponential regime at 5s.");
  });

  it("collects data-quality risks", () => {
    const hints = experienceDecisionHints({
      ...QUIET,
      milestones: { coverage: "partial" },
      session: { budgetStops: 2, lostRewardSec: 600, offlineElapsedSec: 1000 },
      endNetWorthLog10: Number.POSITIVE_INFINITY,
      monteCarlo: { firstVisible: { accounting: { rightCensored: 3, failed: 0, unsupported: 0 }, population: { status: "outside-observed-range" } } },
      uxFlags: [{ code: "TOO_MANY_DROPS", severity: "warn" }],
      monetizationConfigured: false,
    });
    expect(hints.risks).toHaveLength(8);
    expect(hints.risks[0]).toStartWith("2 active block(s) were cut short");
    expect(hints.risks[2]).toContain("discarded 60% of offline time");
    expect(hints.risks[5]).toBe("Monte Carlo population p95 is outside-observed-range.");
    expect(hints.risks[6]).toContain("`TOO_MANY_DROPS`");
  });

  it("summarizes A/B rows into a direction", () => {
    const rows = buildCompareKpiRows([
      { metric: "endNetWorth", better: "b", measured: { a: { endNetWorth: "100" }, b: { endNetWorth: "120" } } },
      { metric: "visibleChangesPerMinute", better: "b", measured: { a: { visibleChangesPerMinute: 1 }, b: { visibleChangesPerMinute: 2 } } },
      { metric: "maxNoRewardGapSec", better: "a", measured: { a: { maxNoRewardGapSec: 60 }, b: { maxNoRewardGapSec: 90 } } },
      { metric: "custom", measured: {} },
    ]);
    const hints = compareDecisionHints({ rows, warnings: ["different units"] });
    expect(hints.bottlenecks).toEqual(["B trails A on `maxNoRewardGapSec` (lower is better): 60 → 90 (+50%)."]);
    expect(hints.adjustments[0]).toBe("B wins 2 of 4 KPI(s) (`endNetWorth` +20%, `visibleChangesPerMinute` +100%). Move toward B, then recover `maxNoRewardGapSec`.");
    expect(hints.risks).toEqual(["`custom` could not be ranked.", "1 comparison warning(s) apply (see Comparison notes); the KPI differences may not be like for like."]);
  });

  it("names the strongest experiment lever and judges it against the objective", () => {
    const hints = experimentDecisionHints({
      candidates: [
        { id: "baseline", metrics: [{ metricId: "endMoney", status: "observed", value: "100" }], constraintViolations: [] },
        { id: "oat:a:2", metrics: [{ metricId: "endMoney", status: "observed", value: "150" }], constraintViolations: [] },
        { id: "oat:b:2", metrics: [{ metricId: "endMoney", status: "observed", value: "100" }], constraintViolations: ["cap"] },
      ],
      elasticities: [
        { dimensionId: "a", candidateId: "oat:a:2", metricId: "endMoney", status: "observed", elasticity: "0.5", direction: "higher" },
        { dimensionId: "b", candidateId: "oat:b:2", metricId: "endMoney", status: "observed", elasticity: "0", direction: "flat" },
        { dimensionId: "c", candidateId: "oat:c:2", metricId: "endMoney", status: "unavailable", elasticity: null, direction: "unavailable" },
      ],
      pareto: { nonDominated: ["oat:a:2"], uncompared: [] },
      objectives: [{ id: "rich", metricId: "endMoney", sense: "higher" }],
    });
    expect(hints.adjustments[0]).toBe("`endMoney` responds most to `a`: probe `oat:a:2` moved it higher, better for objective `rich` (100 → 150, +50%; local elasticity 0.5).");
    expect(hints.bottlenecks).toEqual([
      "`endMoney` did not move for `b`; those probes are not levers for it at this horizon.",
      "Candidate `oat:b:2` violates `cap`.",
    ]);
    expect(hints.risks[0]).toBe("1 elasticity cell(s) are unavailable (a censored, failed, or zero baseline reading).");
  });

  it("renders a stable section with placeholders", () => {
    const md = renderDecisionHints({ bottlenecks: [], adjustments: ["x"], risks: [] }, { verify: "Verify it." }).join("\n");
    expect(md).toBe([
      "## Decision hints",
      "",
      "### Bottlenecks",
      "",
      "- None crossed the thresholds in this run.",
      "",
      "### Recommended adjustment direction",
      "",
      "- x",
      "",
      "### Risk summary",
      "",
      "- No data-quality risk detected.",
      "",
      "_Hints are heuristics computed from this report's measurements. Verify it._",
    ].join("\n"));
  });
});
