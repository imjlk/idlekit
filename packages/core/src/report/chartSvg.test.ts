import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import {
  buildCompareKpiRows,
  buildProgressionChartData,
  buildSensitivityChartData,
  createChartData,
  type ChartDataV1,
  type ProgressionSample,
} from "./chart";
import { escapeXml, formatDurationLabel, renderChartSvg } from "./chartSvg";

/** Set IDLEKIT_UPDATE_CHART_GOLDEN=1 to rewrite the golden files after an intended rendering change. */
const GOLDEN_DIR = resolve(import.meta.dir, "../../../../fixtures/charts");
const UPDATE = process.env.IDLEKIT_UPDATE_CHART_GOLDEN === "1";

/** Exponential start, a softcap plateau, then a prestige-like drop and recovery. Fully deterministic. */
function samples(scale: number): ProgressionSample[] {
  const out: ProgressionSample[] = [];
  for (let i = 0; i <= 3600; i += 1) {
    const money = i < 1200 ? i / 120 : i < 2400 ? 10 + (i - 1200) / 1200 : i < 2410 ? 2 : 2 + (i - 2410) / 150;
    const log = money * scale;
    out.push({
      t: 1000 + i * 10,
      money: { text: `1e${log.toFixed(6)}`, log10: log },
      netWorth: { text: `1e${(log + 0.5).toFixed(6)}`, log10: log + 0.5 },
    });
  }
  return out;
}

function progression(scale: number) {
  return buildProgressionChartData({
    samples: samples(scale),
    startT: 1000,
    unit: "COIN",
    primarySeries: "netWorth",
    milestones: [
      { key: "upgrade.producer.1", t: 600, source: "upgrade" },
      { key: "upgrade.producer.2", t: 610, source: "upgrade" },
      { key: "money>=1e10", t: 12_000, source: "goal" },
      { key: "prestige.1", t: 24_000, source: "prestige" },
    ],
    droppedMilestones: 3,
    maxPoints: 128,
    traceEverySteps: 10,
  });
}

function fixtures(): Record<string, ChartDataV1> {
  return {
    progression: createChartData({
      kind: "progression",
      title: "Simulate: golden <fixture> & \"quotes\"",
      source: { command: "simulate", scenario: "golden.json", seed: 7, runId: "golden" },
      progression: progression(1),
    }),
    compare: createChartData({
      kind: "compare",
      title: "Compare: a.json vs b.json",
      source: { command: "compare", scenario: ["a.json", "b.json"] },
      compare: {
        labels: { a: "a.json", b: "b.json" },
        kpis: buildCompareKpiRows([
          { metric: "endNetWorth", better: "b", measured: { a: { endNetWorth: "1e12" }, b: { endNetWorth: "1.5e12" } } },
          { metric: "etaToTargetWorth", better: "a", measured: { a: { etaToTargetWorth: "600" }, b: { etaToTargetWorth: "900" } } },
          { metric: "droppedRate", better: "tie", measured: { a: { droppedRate: 0 }, b: { droppedRate: 0 } } },
          { metric: "endMoney", better: "b", measured: { a: { endMoney: "1e300" }, b: { endMoney: "1e320" } } },
          { metric: "timeToMilestone", measured: { a: { timeToMilestone: "unreachable" }, b: { timeToMilestone: "40" } } },
        ]),
        progression: { a: progression(1), b: progression(1.1) },
      },
    }),
    sensitivity: createChartData({
      kind: "sensitivity",
      title: "Local sensitivity: golden.json",
      source: { command: "experiment", scenario: "golden.json" },
      sensitivity: buildSensitivityChartData([
        { dimensionId: "costGrowth", candidateId: "oat:costGrowth:1.08", metricId: "timeToMoney", status: "observed", elasticity: "-2.16", direction: "lower" },
        { dimensionId: "costGrowth", candidateId: "oat:costGrowth:1.08", metricId: "endMoney", status: "observed", elasticity: "-6.06", direction: "lower" },
        { dimensionId: "costGrowth", candidateId: "oat:costGrowth:1.14", metricId: "timeToMoney", status: "observed", elasticity: "1.44", direction: "higher" },
        { dimensionId: "costGrowth", candidateId: "oat:costGrowth:1.14", metricId: "endMoney", status: "unavailable", elasticity: null, direction: "unavailable" },
        { dimensionId: "baseIncome", candidateId: "oat:baseIncome:2", metricId: "timeToMoney", status: "observed", elasticity: "0", direction: "flat" },
        { dimensionId: "baseIncome", candidateId: "oat:baseIncome:2", metricId: "endMoney", status: "observed", elasticity: "1e400", direction: "higher" },
      ]),
    }),
  };
}

describe("chart SVG rendering", () => {
  for (const [name, data] of Object.entries(fixtures())) {
    it(`${name} matches the golden SVG and renders deterministically`, async () => {
      const svg = renderChartSvg(data);
      expect(renderChartSvg(JSON.parse(JSON.stringify(data)) as ChartDataV1)).toBe(svg);
      expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBeTrue();
      expect(svg.trimEnd().endsWith("</svg>")).toBeTrue();
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("Infinity");
      expect(svg).not.toMatch(/[^\w.]-0(?![.\d])/);
      const goldenPath = resolve(GOLDEN_DIR, `${name}.svg`);
      if (UPDATE) await Bun.write(goldenPath, svg);
      expect(svg).toBe(await Bun.file(goldenPath).text());
    });
  }

  it("escapes text and labels durations on whole units", () => {
    expect(escapeXml("<a & \"b\" 'c'>")).toBe("&lt;a &amp; &quot;b&quot; &#39;c&#39;&gt;");
    expect(formatDurationLabel(30)).toBe("30s");
    expect(formatDurationLabel(600)).toBe("10m");
    expect(formatDurationLabel(7200)).toBe("2h");
    expect(formatDurationLabel(86_400)).toBe("1d");
  });

  it("rejects chart data with a missing body", () => {
    expect(() => renderChartSvg(createChartData({ kind: "compare", title: "x", source: { command: "compare" } }))).toThrow();
  });
});
