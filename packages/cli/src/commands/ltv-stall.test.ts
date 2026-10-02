import { describe, expect, it } from "bun:test";
import { buildGuardrailKpi, emptyCounts, mergeCounts } from "./ltv";

describe("ltv guardrail counts", () => {
  it("counts cooldown skips without diluting the funds stall ratio", () => {
    const counts = mergeCounts(emptyCounts(), {
      actions: {
        applied: 100,
        skippedCannotApply: 0,
        skippedInsufficientFunds: 100,
        skippedInvalidQuote: 0,
        skippedCooldown: 300,
      },
    });
    expect(counts.actionsSkippedCooldown).toBe(300);
    const kpi = buildGuardrailKpi({
      counts,
      actionCounts: {},
      firstUpgradeSec: null,
      growthLog10PerDay: 0,
    });
    expect(kpi.stallRatio).toBe(0.5);
  });
});
