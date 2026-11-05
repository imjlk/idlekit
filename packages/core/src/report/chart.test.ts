import { describe, expect, it } from "bun:test";
import {
  CHART_DATA_CONTRACT,
  DEFAULT_CHART_MAX_POINTS,
  buildCompareKpiRows,
  buildProgressionChartData,
  buildSensitivityChartData,
  chartTraceEverySteps,
  compareMetricPreference,
  createChartData,
  decimalLog10,
  downsampleLttb,
  growthRateSeries,
  resolveChartMaxPoints,
  type ChartPoint,
  type ProgressionSample,
} from "./chart";

function line(n: number, f: (i: number) => number | null): ChartPoint[] {
  return Array.from({ length: n }, (_, i) => ({ t: i, y: f(i) }));
}

describe("chart data helpers", () => {
  it("checks the point budget", () => {
    expect(resolveChartMaxPoints(undefined)).toBe(DEFAULT_CHART_MAX_POINTS);
    expect(resolveChartMaxPoints(3)).toBe(3);
    expect(resolveChartMaxPoints(10_000)).toBe(10_000);
    for (const bad of [2, 10_001, 1.5, Number.NaN]) expect(() => resolveChartMaxPoints(bad)).toThrow(RangeError);
  });

  it("bounds the trace interval by the point budget", () => {
    expect(chartTraceEverySteps({ totalSteps: undefined, maxPoints: 100 })).toBe(1);
    expect(chartTraceEverySteps({ totalSteps: 400, maxPoints: 100 })).toBe(1);
    expect(chartTraceEverySteps({ totalSteps: 401, maxPoints: 100 })).toBe(2);
    expect(chartTraceEverySteps({ totalSteps: 86_400, maxPoints: 512 })).toBe(43);
    expect(chartTraceEverySteps({ totalSteps: 1000, maxPoints: 10, oversample: 1 })).toBe(100);
  });

  it("reads log10 from decimal text beyond the double range", () => {
    expect(decimalLog10("1000")).toBe(3);
    expect(decimalLog10("-100")).toBe(2);
    expect(decimalLog10("2.5e400")).toBeCloseTo(400 + Math.log10(2.5), 12);
    expect(decimalLog10("1e-3")).toBeCloseTo(-3, 12);
    expect(decimalLog10("0")).toBeNull();
    expect(decimalLog10("")).toBeNull();
    expect(decimalLog10("unreachable")).toBeNull();
    expect(decimalLog10("Infinity")).toBeNull();
  });

  it("downsamples with LTTB, keeps both ends and peaks, and is deterministic", () => {
    const spike = line(1000, (i) => (i === 500 ? 100 : i % 7));
    const kept = downsampleLttb(spike, 50);
    expect(kept.length).toBe(50);
    expect(kept[0]).toEqual(spike[0]!);
    expect(kept[kept.length - 1]).toEqual(spike[999]!);
    expect(kept.some((p) => p.t === 500)).toBeTrue();
    for (let i = 1; i < kept.length; i += 1) expect(kept[i]!.t).toBeGreaterThan(kept[i - 1]!.t);
    expect(downsampleLttb(spike, 50)).toEqual(kept);
    expect(downsampleLttb(spike.slice(0, 10), 50)).toEqual(spike.slice(0, 10));
    expect(() => downsampleLttb(spike, 2)).toThrow(RangeError);
  });

  it("keeps a gap only when its bucket has nothing else", () => {
    const gaps = line(100, (i) => (i >= 40 && i < 60 ? null : i));
    const kept = downsampleLttb(gaps, 10);
    expect(kept.length).toBe(10);
    expect(kept.some((p) => p.y === null)).toBeTrue();
  });

  it("derives the growth rate as log10 change per second", () => {
    const rate = growthRateSeries([
      { t: 0, y: 1 },
      { t: 2, y: 3 },
      { t: 4, y: 2 },
      { t: 4, y: 5 },
      { t: 6, y: null },
    ]);
    expect(rate).toEqual([
      { t: 2, y: 1 },
      { t: 4, y: -0.5 },
      { t: 4, y: null },
      { t: 6, y: null },
    ]);
  });

  it("builds progression data with a primary series, sorted milestones, and sampling facts", () => {
    const samples: ProgressionSample[] = Array.from({ length: 2000 }, (_, i) => ({
      t: 100 + i,
      money: { text: String(10 ** (i / 500)), log10: i / 500 },
      netWorth: { text: String(2 * 10 ** (i / 500)), log10: Math.log10(2) + i / 500 },
    }));
    samples.push({ ...samples[samples.length - 1]! });
    const data = buildProgressionChartData({
      samples,
      startT: 100,
      unit: "COIN",
      primarySeries: "netWorth",
      milestones: [
        { key: "b", t: 30, source: "upgrade" },
        { key: "a", t: 30, source: "upgrade" },
        { key: "c", t: 5, source: "goal" },
      ],
      droppedMilestones: 2,
      maxPoints: 64,
      traceEverySteps: 4,
    });
    expect(data.primarySeries).toBe("netWorth");
    expect(data.series.map((s) => s.id)).toEqual(["money", "netWorth", "growthRate"]);
    expect(data.series[0]!.points.length).toBe(64);
    expect(data.series[0]!.points[0]).toEqual({ t: 0, y: 0, value: "1" });
    expect(data.series[2]!.label).toBe("Growth rate (net worth)");
    for (const p of data.series[2]!.points) expect(p.y!).toBeCloseTo(1 / 500, 9);
    expect(data.milestones.map((m) => m.key)).toEqual(["c", "a", "b"]);
    expect(data.droppedMilestones).toBe(2);
    expect(data.sampling).toEqual({ method: "lttb", maxPoints: 64, sourcePoints: 2000, retainedPoints: 64, traceEverySteps: 4 });
  });

  it("falls back to money when a sample has no net worth", () => {
    const data = buildProgressionChartData({
      samples: [
        { t: 0, money: { text: "0", log10: Number.NEGATIVE_INFINITY } },
        { t: 1, money: { text: "10", log10: 1 } },
      ],
      startT: 0,
      unit: "COIN",
      primarySeries: "netWorth",
    });
    expect(data.primarySeries).toBe("money");
    expect(data.series.map((s) => s.id)).toEqual(["money", "growthRate"]);
    expect(data.series[0]!.points[0]).toEqual({ t: 0, y: null, value: "0" });
    expect(data.sampling.method).toBe("none");
    expect(data.sampling.traceEverySteps).toBeNull();
  });

  it("derives compare KPI rows from measured text", () => {
    const rows = buildCompareKpiRows([
      { metric: "endMoney", better: "b", measured: { a: { endMoney: "100" }, b: { endMoney: "150" } } },
      { metric: "droppedRate", better: "tie", measured: { a: { droppedRate: 0 }, b: { droppedRate: 0 } } },
      { metric: "timeToMilestone", measured: { a: { timeToMilestone: "0" }, b: { timeToMilestone: "5" } } },
      { metric: "endNetWorth", better: "a", measured: { a: { endNetWorth: "1e400" }, b: { endNetWorth: "1e398" } } },
      { metric: "custom", better: "weird", measured: { a: {}, b: { custom: "unreachable" } } },
    ]);
    expect(rows[0]).toEqual({
      metric: "endMoney", a: "100", b: "150", preference: "higher", better: "b", relativeChangePct: 50, log10Delta: rows[0]!.log10Delta,
    });
    expect(rows[0]!.log10Delta!).toBeCloseTo(Math.log10(1.5), 12);
    expect(rows[1]!.relativeChangePct).toBe(0);
    expect(rows[1]!.preference).toBe("lower");
    expect(rows[2]!.relativeChangePct).toBeNull();
    expect(rows[2]!.better).toBe("undetermined");
    expect(rows[3]!.relativeChangePct).toBeNull();
    expect(rows[3]!.log10Delta!).toBeCloseTo(-2, 12);
    expect(rows[4]).toMatchObject({ a: null, b: "unreachable", preference: "n/a", better: "undetermined", relativeChangePct: null, log10Delta: null });
    expect(compareMetricPreference("visibleChangesPerMinute")).toBe("higher");
    expect(compareMetricPreference("maxNoRewardGapSec")).toBe("lower");
  });

  it("lays out sensitivity rows and columns by first appearance", () => {
    const data = buildSensitivityChartData([
      { dimensionId: "d", candidateId: "oat:d:1", metricId: "m2", status: "observed", elasticity: "-1.5", direction: "lower" },
      { dimensionId: "d", candidateId: "oat:d:1", metricId: "m1", status: "unavailable", elasticity: null, direction: "unavailable" },
      { dimensionId: "d", candidateId: "oat:d:2", metricId: "m2", status: "observed", elasticity: "1e400", direction: "higher" },
    ]);
    expect(data.rows).toEqual([{ dimensionId: "d", candidateId: "oat:d:1" }, { dimensionId: "d", candidateId: "oat:d:2" }]);
    expect(data.columns).toEqual(["m2", "m1"]);
    expect(data.cells.map((c) => c.elasticity)).toEqual([-1.5, null, null]);
    expect(data.cells[2]!.elasticityText).toBe("1e400");
    expect(data).toMatchObject({ method: "one-at-a-time-local", globalSensitivity: false, sobol: false });
  });

  it("stamps the versioned contract", () => {
    const data = createChartData({ kind: "sensitivity", title: "t", source: { command: "experiment" }, sensitivity: buildSensitivityChartData([]) });
    expect(data.contract).toBe(CHART_DATA_CONTRACT);
    expect(data.schemaVersion).toBe(1);
    expect("progression" in data).toBeFalse();
  });
});
