import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { builtinModelFactories } from "../models/index";
import { compileScenario } from "../scenario/compile";
import { createModelRegistry } from "../scenario/registry";
import type { ScenarioV1 } from "../scenario/types";
import { validateScenarioV1 } from "../scenario/validate";
import { morrisScreening, sobolIndices } from "./analysis/globalSensitivity";
import { DesignSpaceRejected, mapUnit } from "./analysis/designSpace";
import { searchParameters } from "./analysis/parameterSearch";
import { analyzePrestigeCycle } from "./analysis/prestigeCycle";
import { noResetBaselineNetWorth, summarizeResetPolicy, analyzeResetLayers } from "./analysis/resetInsights";
import { analyzeResetPolicies } from "./analysis/resetOptimization";
import { summarizeSamples, normalQuantile } from "./analysis/sampleStats";
import { runScenario } from "./simulator";
import {
  countStochasticOutcomes,
  expectedStochasticIncomeFactor,
  parseStochasticSpec,
  stochasticTickOutcome,
  stochasticUniform,
} from "./stochastic";
import { builtinStrategyFactories } from "./strategy/builtins";
import { createStrategyRegistry } from "./strategy/registry";
import type { CompiledScenario } from "./types";

const tutorialDir = resolve(import.meta.dir, "../../../../examples/tutorials");
const tutorial = (name: string): ScenarioV1 => JSON.parse(readFileSync(resolve(tutorialDir, name), "utf8")) as ScenarioV1;
const E = createNumberEngine();

function compile(raw: ScenarioV1): CompiledScenario<number, string, any> {
  const registry = createModelRegistry(builtinModelFactories());
  const strategies = createStrategyRegistry([...builtinStrategyFactories]);
  const checked = validateScenarioV1(raw, registry, strategies);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return compileScenario<number, string, any>({ E, scenario: checked.scenario!, registry, strategyRegistry: strategies });
}

function withStochastic(raw: ScenarioV1, stochastic: unknown, durationSec = 900): ScenarioV1 {
  return {
    ...raw,
    clock: { ...raw.clock, durationSec },
    model: { ...raw.model, params: { ...(raw.model.params as object), stochastic } },
  } as ScenarioV1;
}

const spec = {
  crit: { chance: 0.1, multiplier: 5 },
  drops: [{ id: "chest", ratePerSec: 0.02, rewardIncomeSec: 60 }],
  events: [{ id: "frenzy", windowSec: 300, chance: 0.5, durationSec: 30, incomeMultiplier: 7 }],
};

describe("stochastic events", () => {
  it("draws the same outcome for the same seed, stream, and index", () => {
    expect(stochasticUniform(7, "crit", 12)).toBe(stochasticUniform(7, "crit", 12));
    expect(stochasticUniform(7, "crit", 12)).not.toBe(stochasticUniform(8, "crit", 12));
    const parsed = parseStochasticSpec(spec);
    expect(stochasticTickOutcome(parsed, 3, 120, 1)).toEqual(stochasticTickOutcome(parsed, 3, 120, 1));
  });

  it("hits the configured rates within a fixed tolerance", () => {
    const parsed = parseStochasticSpec(spec);
    const counts = countStochasticOutcomes(parsed, 11, { startT: 0, dt: 1, ticks: 200_000 });
    expect(counts.crits / 200_000).toBeGreaterThan(0.095);
    expect(counts.crits / 200_000).toBeLessThan(0.105);
    const dropRate = counts.drops.chest! / 200_000;
    expect(dropRate).toBeGreaterThan((1 - Math.exp(-0.02)) * 0.9);
    expect(dropRate).toBeLessThan((1 - Math.exp(-0.02)) * 1.1);
    expect(expectedStochasticIncomeFactor(parsed, 1)).toBeGreaterThan(1);
  });

  it("rejects duplicate ids and an event longer than its window", () => {
    expect(() => parseStochasticSpec({ drops: [spec.drops[0], spec.drops[0]] })).toThrow();
    expect(() => parseStochasticSpec({ events: [{ ...spec.events[0], durationSec: 400 }] })).toThrow();
  });

  it("makes the exponential model seed-dependent and drops the analytic shortcut", () => {
    const raw = withStochastic(tutorial("26-exponential-forge-v1.json"), spec);
    const end = (seed: number) => {
      const compiled = compile(raw);
      return runScenario({ ...compiled, ctx: { ...compiled.ctx, seed } }).end.wallet.money.amount;
    };
    expect(end(1)).toBe(end(1));
    expect(end(1)).not.toBe(end(2));
    expect(compile(raw).model.analytic?.(compile(raw).ctx, compile(raw).initial) ?? null).toBeNull();
    // Without a stochastic block the model keeps its deterministic path.
    const plain = compile({ ...raw, model: { ...raw.model, params: { ...(raw.model.params as object), stochastic: undefined } } } as ScenarioV1);
    expect(runScenario({ ...plain, ctx: { ...plain.ctx, seed: 1 } }).end.wallet.money.amount).toBe(
      runScenario({ ...plain, ctx: { ...plain.ctx, seed: 2 } }).end.wallet.money.amount,
    );
  });
});

describe("sample statistics", () => {
  it("matches the normal quantile and brackets the median", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    const values = Array.from({ length: 1001 }, (_, i) => i);
    const summary = summarizeSamples(values, { quantiles: [0.5, 0.9] });
    expect(summary.mean).toBe(500);
    expect(summary.quantiles[0]!.value).toBe(500);
    expect(summary.quantiles[0]!.interval!.lower).toBeLessThan(500);
    expect(summary.quantiles[0]!.interval!.upper).toBeGreaterThan(500);
    expect(summary.meanInterval!.lower).toBeLessThan(500);
  });

  it("leaves an interval null when the draws cannot support it", () => {
    const summary = summarizeSamples([1, 2, 3], { quantiles: [0.9] });
    expect(summary.quantiles[0]!.interval).toBeNull();
    expect(summarizeSamples([4]).meanInterval).toBeNull();
    expect(() => summarizeSamples([])).toThrow();
  });
});

describe("global sensitivity", () => {
  const params = [
    { id: "x1", min: -Math.PI, max: Math.PI },
    { id: "x2", min: -Math.PI, max: Math.PI },
    { id: "x3", min: -Math.PI, max: Math.PI },
  ];
  const ishigami = (v: Readonly<Record<string, number>>) =>
    Math.sin(v.x1!) + 7 * Math.sin(v.x2!) ** 2 + 0.1 * v.x3! ** 4 * Math.sin(v.x1!);

  it("recovers the Ishigami Sobol indices", () => {
    const result = sobolIndices({ parameters: params, evaluate: ishigami, seed: 42, maxRuns: 5 * 8192, bootstrap: 50 });
    const byId = Object.fromEntries(result.parameters.map((row) => [row.id, row]));
    expect(byId.x1!.firstOrder.value!).toBeCloseTo(0.314, 1);
    expect(byId.x2!.firstOrder.value!).toBeCloseTo(0.442, 1);
    expect(Math.abs(byId.x3!.firstOrder.value!)).toBeLessThan(0.05);
    expect(byId.x1!.totalOrder.value!).toBeCloseTo(0.558, 1);
    expect(byId.x3!.totalOrder.value!).toBeCloseTo(0.244, 1);
    expect(result.ranking).toEqual(["x1", "x2", "x3"]);
    expect(result.runs).toBe(5 * 8192);
    expect(byId.x1!.totalOrder.interval!.lower).toBeLessThan(byId.x1!.totalOrder.value!);
  });

  it("ranks a linear function by Morris mu* and is seed-stable", () => {
    const linear = (v: Readonly<Record<string, number>>) => 10 * v.a! + v.b!;
    const parameters = [
      { id: "a", min: 0, max: 1 },
      { id: "b", min: 0, max: 1 },
      { id: "c", min: 0, max: 1 },
    ];
    const first = morrisScreening({ parameters, evaluate: linear, seed: 5, maxRuns: 40 });
    expect(first.trajectories).toBe(10);
    expect(first.runs).toBe(40);
    expect(first.ranking).toEqual(["a", "b", "c"]);
    const a = first.parameters.find((row) => row.id === "a")!;
    expect(a.muStar).toBeCloseTo(10, 9);
    expect(a.sigma).toBeCloseTo(0, 9);
    expect(JSON.stringify(morrisScreening({ parameters, evaluate: linear, seed: 5, maxRuns: 40 }))).toBe(JSON.stringify(first));
  });

  it("refuses a budget below one design and counts failed runs", () => {
    expect(() => morrisScreening({ parameters: params, evaluate: ishigami, seed: 1, maxRuns: 7 })).toThrow(DesignSpaceRejected);
    const flaky = morrisScreening({ parameters: params, evaluate: (_v, i) => (i % 5 === 0 ? null : i), seed: 1, maxRuns: 40 });
    expect(flaky.failedRuns).toBeGreaterThan(0);
  });
});

describe("parameter search", () => {
  const parameters = [
    { id: "x", min: 0, max: 1 },
    { id: "y", min: 1, max: 100, scale: "log" as const },
  ];
  const bowl = (v: Readonly<Record<string, number>>) => (v.x! - 0.3) ** 2 + (Math.log10(v.y!) - 1) ** 2;

  it("maps log and integer parameters", () => {
    expect(mapUnit({ id: "y", min: 1, max: 100, scale: "log" }, 0.5)).toBeCloseTo(10, 9);
    expect(mapUnit({ id: "n", min: 1, max: 5, integer: true }, 0.49)).toBe(3);
  });

  it("covers a grid within maxRuns and finds the bowl", () => {
    const result = searchParameters({ parameters, evaluate: bowl, method: "grid", seed: 0, maxRuns: 121 });
    expect(result.gridLevels).toBe(11);
    expect(result.runs).toBe(121);
    expect(result.best!.values.x).toBeCloseTo(0.3, 9);
    expect(result.best!.values.y).toBeCloseTo(10, 6);
  });

  it("runs a seeded GA that is reproducible and honors maxRuns", () => {
    const run = () => searchParameters({ parameters, evaluate: bowl, method: "ga", seed: 9, maxRuns: 200 });
    const first = run();
    expect(first.runs).toBeLessThanOrEqual(200);
    expect(first.stoppedBy).toBe("max-runs");
    expect(first.best!.score!).toBeLessThan(0.01);
    expect(JSON.stringify(run())).toBe(JSON.stringify(first));
    const random = searchParameters({ parameters, evaluate: bowl, method: "random", seed: 9, maxRuns: 50, sense: "maximize" });
    expect(random.sense).toBe("maximize");
    expect(random.best!.score).toBe(Math.max(...random.top.map((row) => row.score!)));
  });

  it("stops on the time limit with an injected clock", () => {
    let clock = 0;
    const result = searchParameters({
      parameters,
      evaluate: (v) => {
        clock += 10;
        return bowl(v);
      },
      method: "random",
      seed: 1,
      maxRuns: 1000,
      timeLimitMs: 35,
      now: () => clock,
    });
    expect(result.stoppedBy).toBe("time-limit");
    expect(result.runs).toBe(4);
  });
});

describe("reset cycle analysis", () => {
  const prestige = tutorial("27-prestige-loop-v1.json");

  it("prestige-cycle reports the pending reset instead of 0 points per hour", () => {
    const result = analyzePrestigeCycle({
      scenario: compile(prestige),
      scan: { fromSec: 600, toSec: 1800, stepSec: 600 },
      horizonSec: 5400,
      cycles: 3,
      objective: "pointsPerHour",
    });
    for (const row of result.rows) expect(Number(row.pointsPerHour)).toBeGreaterThan(0);
  });

  it("summarizes ROI, timing window, and stability from a reset policy", () => {
    const request = {
      createScenario: () => compile(prestige),
      scan: { fromSec: 600, toSec: 1800, stepSec: 600 },
      horizonSec: 5400,
      cycleBudget: 10,
      objective: "cumulative-reset-reward" as const,
      recovery: { metric: "pre-reset-net-worth" as const },
      stability: { minObservedCycles: 3, windows: [2, 3], absoluteTolerance: "0", relativeTolerance: 0.5 },
    };
    const artifact = analyzeResetPolicies(request);
    const baseline = noResetBaselineNetWorth(compile(prestige), 5400);
    const insights = summarizeResetPolicy(artifact, { baselineNetWorth: String(baseline) });
    expect(insights.optimalIntervalSec).toBe(artifact.best.intervalSec);
    expect(insights.rows).toHaveLength(3);
    for (const row of insights.rows) {
      expect(row.rewardPerHour!).toBeGreaterThan(0);
      // 1200s leaves a 600s tail; 600s and 1800s end on a reset, where ROI is not read.
      expect(row.roiVsNoReset === null).toBe(row.intervalSec !== 1200);
    }
    expect(insights.timingWindow.fromSec).toBeLessThanOrEqual(insights.optimalIntervalSec);
    expect(insights.hints.length).toBeGreaterThan(0);

    const layers = analyzeResetLayers([
      { id: "prestige", request: () => request },
      {
        id: "prestige-again",
        request: (inner) => ({ ...request, scan: { fromSec: inner!.insights.optimalIntervalSec, toSec: inner!.insights.optimalIntervalSec, stepSec: 1 } }),
      },
    ]);
    expect(layers.map((layer) => layer.id)).toEqual(["prestige", "prestige-again"]);
    expect(layers[1]!.artifact.candidates).toHaveLength(1);
  });
});
