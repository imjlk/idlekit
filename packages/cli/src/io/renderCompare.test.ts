import { describe, expect, it } from "bun:test";
import { renderCompareMarkdown } from "./renderCompare";

describe("comparison Markdown", () => {
  it("exposes opposing metric preferences and preserves warnings", () => {
    const rows = [
      { metric: "endNetWorth", better: "a", measured: { a: { endNetWorth: "200" }, b: { endNetWorth: "100" } }, insights: { warnings: ["different horizons"] } },
      { metric: "maxNoRewardGapSec", better: "b", measured: { a: { maxNoRewardGapSec: 20 }, b: { maxNoRewardGapSec: 5 } } },
      { metric: "timeToMilestone", better: "tie", measured: { a: { timeToMilestone: 86401 }, b: { timeToMilestone: 86401 } } },
    ];
    const before = JSON.stringify(rows);
    const report = renderCompareMarkdown({ aPath: "a|scenario.json", bPath: "b.json", results: rows });
    expect(report).toContain("| endNetWorth | 200 | 100 | higher | A |");
    expect(report).toContain("| maxNoRewardGapSec | 20s | 5s | lower | B |");
    expect(report).toContain("A is preferred on: endNetWorth");
    expect(report).toContain("B is preferred on: maxNoRewardGapSec");
    expect(report).toContain("different horizons");
    expect(report).toContain("not an observed milestone time");
    expect(report).toContain("a\\|scenario.json");
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("renders missing measurements and decisions as unavailable", () => {
    const report = renderCompareMarkdown({ aPath: "a.json", bPath: "b.json", results: [{ metric: "endMoney" }] });
    expect(report).toContain("| endMoney | n/a | n/a | higher | undetermined |");
  });
});
