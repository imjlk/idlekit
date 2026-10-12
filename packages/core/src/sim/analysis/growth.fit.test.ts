import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine, type Decimal } from "../../engine/breakInfinity";
import { runScenario } from "../simulator";
import type { CompiledScenario, Model, RunResult, SimState } from "../types";
import { analyzeGrowth } from "./growth";
import {
  fitGrowth,
  fitGrowthFromRun,
  growthDomainNotDisguised,
  growthFitAlgorithmVersion,
  growthFitJsonSchema,
  growthFitSchemaId,
  growthFitSlopeTolerance,
  growthLegacyObservationPreserved,
  growthShapeIndependentOfSpeed,
  validateGrowthFitArtifact,
  type GrowthFitArtifactV1,
  type GrowthSamplingContract,
  type GrowthSampleInput,
} from "./growthFit";


/*
 * PR-12 inventory host. The analyzeGrowth cases stay in growth.test.ts, whose printf-titled
 * it.each row is not a static runner registration.
 */

type UnitCode = "COIN";
type Vars = { owned: number };
type CaseSpec = {
  id: string;
  kind: "exponential" | "power" | "linear" | "exp-quadratic" | "saturating" | "constant" | "reset-drop";
  k?: number;
  c?: number;
  power?: number;
  intercept?: number;
  slope?: number;
  limit?: number;
  value?: number;
  scale?: number;
  split?: number;
  scaleLog10?: number;
  engine?: "breakInfinity";
  t0?: number;
  t1?: number;
  step?: number;
  times?: number[];
  simulate?: boolean;
};

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../../../fixtures/conformance/growth-shapes.json"), "utf8"),
) as {
  windowSec: number;
  samplingBudget: number;
  slopeTolerance: number;
  cases: CaseSpec[];
};

function sampling(windowSec = fixture.windowSec, cadenceSec?: number): GrowthSamplingContract {
  return {
    samplingBudget: fixture.samplingBudget,
    method: "growth-fit-v1",
    methodVersion: 1,
    windowSec,
    ...(cadenceSec !== undefined ? { cadenceSec } : {}),
  };
}

function makeState(t: number, money: number, owned = 0): SimState<number, UnitCode, Vars> {
  return {
    t,
    wallet: { money: { unit: { code: "COIN" }, amount: money }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount: money },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned },
  };
}

function timesOf(spec: CaseSpec): number[] {
  if (spec.times) return spec.times;
  const start = spec.t0 ?? 0;
  const end = spec.t1 ?? start;
  const step = spec.step ?? 1;
  const times: number[] = [];
  for (let t = start; t <= end + 1e-9; t += step) times.push(t);
  return times;
}

function formula(spec: CaseSpec, t: number): number {
  if (spec.kind === "exponential") return Math.exp((spec.k ?? 0) * t);
  if (spec.kind === "power") return (t + 1) ** (spec.power ?? 2);
  if (spec.kind === "linear") return (spec.intercept ?? 0) + (spec.slope ?? 0) * t;
  if (spec.kind === "exp-quadratic") return Math.exp((spec.c ?? 0) * t * t);
  if (spec.kind === "saturating") return (spec.limit ?? 1) * (1 - Math.exp(-(spec.k ?? 0) * t));
  if (spec.kind === "constant") return spec.value ?? 0;
  if (spec.kind === "reset-drop") {
    const split = spec.split ?? 0;
    if (t <= split) return Math.exp((spec.k ?? 0) * t);
    return (spec.scale ?? 1) * Math.exp((spec.k ?? 0) * (t - split));
  }
  return 0;
}

function samplesFor(spec: CaseSpec): GrowthSampleInput<number>[] {
  return timesOf(spec).map((t) => ({ t, amount: formula(spec, t) }));
}

function largeSamples(spec: CaseSpec): GrowthSampleInput<Decimal>[] {
  const E = createBreakInfinityEngine();
  return timesOf(spec).map((t) => {
    const log10 = (spec.scaleLog10 ?? 0) + ((spec.k ?? 0) * t) / Math.LN10;
    return { t, amount: E.from(`1e${log10}`) };
  });
}

function fitSpec(spec: CaseSpec, windowSec = fixture.windowSec): GrowthFitArtifactV1 {
  if (spec.engine === "breakInfinity") {
    return fitGrowth({
      E: createBreakInfinityEngine(),
      samples: largeSamples(spec),
      seriesRequested: "money",
      valueSource: "money",
      sampling: sampling(windowSec),
      softcap: "absent",
    });
  }
  return fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(spec),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(windowSec),
    softcap: "absent",
  });
}

function caseById(id: string): CaseSpec {
  const found = fixture.cases.find((item) => item.id === id);
  if (!found) throw new Error(`missing growth fixture ${id}`);
  return found;
}

function onlyWindow(artifact: GrowthFitArtifactV1) {
  expect(artifact.windows.length).toBe(1);
  return artifact.windows[0]!;
}

function model(income: number, evolve?: Model<number, UnitCode, Vars>["evolve"], analytic?: Model<number, UnitCode, Vars>["analytic"]): Model<number, UnitCode, Vars> {
  return {
    id: "growth-fixture",
    version: 1,
    income: () => ({ unit: { code: "COIN" }, amount: income }),
    actions: () => [],
    ...(evolve ? { evolve } : {}),
    ...(analytic ? { analytic } : {}),
  };
}

function scenarioFor(amount: number, durationSec: number, next: Model<number, UnitCode, Vars>): CompiledScenario<number, UnitCode, Vars> {
  const E = createNumberEngine();
  return {
    ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" } },
    model: next,
    initial: makeState(0, amount),
    run: { stepSec: 1, durationSec, trace: { everySteps: 1, keepActionsLog: false } },
  };
}

function simulate(spec: CaseSpec): RunResult<number, UnitCode, Vars> {
  const evolve: Model<number, UnitCode, Vars>["evolve"] = (_ctx, state, dt) => {
    const t = state.t + dt;
    return {
      ...state,
      wallet: { ...state.wallet, money: { unit: { code: "COIN" }, amount: formula(spec, t) } },
      maxMoneyEver: { unit: { code: "COIN" }, amount: formula(spec, t) },
    };
  };
  const compiled = scenarioFor(formula(spec, 0), spec.t1 ?? 0, model(0, evolve));
  return runScenario(compiled);
}

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed Slow and fast exponentials match in shape, and the other formulas do not.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-shape-speed #acbd473 Re-read the section: both exponentials are exponential, and a short trace is unknown.
 * @evidence ./growthFit.ts#growthShapeIndependentOfSpeed Reads the shape contract id.
 * @evidenceReview ./growthFit.ts#growthShapeIndependentOfSpeed #311b592 The declaration is shape-independent-of-log-slope.
 * @evidence ./growthFit.ts#validateGrowthFitArtifact Runs the generated validator.
 * @evidenceReview ./growthFit.ts#validateGrowthFitArtifact #c0e6c97 The arrow builds typia.createValidate of GrowthFitArtifactV1 on first call and reuses it.
 * @evidence ./growthFit.ts#growthFitJsonSchema Reads the generated schema.
 * @evidenceReview ./growthFit.ts#growthFitJsonSchema #ff8650e The function memoizes typia.json.schema of GrowthFitArtifactV1.
 * @evidence ./growthFit.ts#fitGrowth Fits slow, fast, and softcap-configured literal series.
 * @evidenceReview ./growthFit.ts#fitGrowth #aea08bf The function fits log values relative to the first one, reads log extrema in a loop, keeps a moving exact value fit out of constant, keeps one break per time by precedence, supplied ones included, finds sign and drop breaks, an exact tenfold drop included, on every prepared point, keeps both sides of each break through the sampling budget, reads irregular cadence from the input in one loop, handles a one-point budget, keeps a non-positive domain invalid under coarse cadence, fits on time since the window start, scaled by its largest magnitude so the regression moments stay finite, fits value space in units of the series magnitude, reads saturation from gap-normalized rates, lets an exact value fit win only when it beats the log fit's relative error, and withholds shape claims when the action history is incomplete. Saturation midpoints add half a gap to the earlier time, so they stay finite near the number limit. An exact log-linear fit with a real slope is not constant either. It keeps samples per fit window under the budget, judges acceleration by the quadratic term against its residual, judges saturation without the retained gap, and reports a doubling time for any positive slope. Saturation allows a flat plateau tail and reports its own log-rate residual. It splits the budget at breaks before windows, judges acceleration without a minimum line residual, and runs value-space fits on log-derived ratios when amounts leave the Number range. Under a tight budget it spends samples on fittable windows, rejects renewed growth after a plateau, and takes log rates as log(step) - log(gap). An exact log-quadratic or power fit keeps precedence over an approximate value fit, thinning keeps samples before a window settles, power laws are also fitted from their break segment's start, and incomplete history withholds residual, speed, and diagnostics. A power fit far closer than the log-linear fit takes precedence over the exponential shortcut.
 * @evidence ./growthFit.ts#fitGrowthFromRun Fits executed runs of the slow and fast models.
 * @evidenceReview ./growthFit.ts#fitGrowthFromRun #44923e5 The function keeps a present but empty trace empty, maps each action row by binary search to the first trace state after it, takes its break kind from the model's Action.kind before falling back to the id, reads the softcap hint at the run's start, marks prestige count changes as breaks, reports the action history complete only for a full action log or an observed zero action count, uses netWorthFallback without a model netWorth, and calls fitGrowth. An action the model did not list at the traced state is a purchase unless a prestige count change confirms a reset.
 * @evidence ./growthFit.ts#growthFitSchemaId Reads the growth fit schema id.
 * @evidenceReview ./growthFit.ts#growthFitSchemaId #5247d65 The function returns the growth.fit.v1 schema URL constant.
 * @evidence ./growthFit.ts#growthFitAlgorithmVersion Reads the algorithm version on the artifact.
 * @evidenceReview ./growthFit.ts#growthFitAlgorithmVersion #af32797 The function returns the growth-fit-v1 constant.
 * @evidence ./growthFit.ts#growthFitSlopeTolerance Bounds the fitted slopes against the generating rates.
 * @evidenceReview ./growthFit.ts#growthFitSlopeTolerance #a83b3c7 The function returns the 1e-4 slope tolerance constant.
 */
export function separatesShapeFromSpeed(): void {
  expect(growthShapeIndependentOfSpeed).toBe("shape-independent-of-log-slope");
  expect(growthFitJsonSchema().version).toBe("3.1");
  const slow = fitSpec(caseById("slow-exp"));
  const fast = fitSpec(caseById("fast-exp"));
  expect(validateGrowthFitArtifact(slow).success).toBe(true);
  expect(validateGrowthFitArtifact(fast).success).toBe(true);
  expect(growthFitSchemaId()).toBe("https://idlekit.dev/schemas/growth.fit.v1.schema.json");
  expect(slow.algorithmVersion).toBe(growthFitAlgorithmVersion());
  expect(growthFitSlopeTolerance()).toBe(1e-4);
  const slowWindow = onlyWindow(slow);
  const fastWindow = onlyWindow(fast);
  expect(slowWindow.shape).toBe("exponential");
  expect(fastWindow.shape).toBe("exponential");
  expect(slowWindow.speed.logSlopePerSec).not.toBe(fastWindow.speed.logSlopePerSec);
  expect(slowWindow.legacySpeedBucket).toBe("softcap");
  expect(fastWindow.legacySpeedBucket).toBe("exp");
  expect(Math.abs((slowWindow.speed.logSlopePerSec ?? 0) - 0.001 / Math.LN10)).toBeLessThan(growthFitSlopeTolerance());
  expect(Math.abs((fastWindow.speed.logSlopePerSec ?? 0) - 0.2 / Math.LN10)).toBeLessThan(growthFitSlopeTolerance());
  expect(slow.method).toBe("heuristic-fit");
  expect(slow.algorithmVersion).toBe("growth-fit-v1");
  expect(slow.fitWindow.windowSec).toBe(fixture.windowSec);
  expect(slow.sampleCount).toBeGreaterThanOrEqual(8);
  expect(slowWindow.residual.rmse).not.toBeNull();
  expect(slow.claimsResourceBottleneck).toBe(false);

  expect(onlyWindow(fitSpec(caseById("polynomial-power"))).shape).toBe("polynomial");
  expect(onlyWindow(fitSpec(caseById("polynomial-linear"))).shape).toBe("polynomial");
  expect(onlyWindow(fitSpec(caseById("accelerating"))).shape).toBe("accelerating-log");
  expect(onlyWindow(fitSpec(caseById("saturating"))).shape).toBe("saturating");
  expect(onlyWindow(fitSpec(caseById("constant"))).shape).toBe("constant");
  const short = fitSpec(caseById("short-exp"));
  expect(onlyWindow(short).shape).toBe("unknown");
  expect(short.status).toBe("insufficient-data");

  const slowRun = simulate(caseById("slow-exp"));
  const fastRun = simulate(caseById("fast-exp"));
  const linearRun = simulate(caseById("polynomial-linear"));
  const slowFit = fitGrowthFromRun({
    run: slowRun,
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
    softcap: "absent",
  });
  expect(onlyWindow(slowFit).shape).toBe("exponential");
  expect(onlyWindow(fitGrowthFromRun({
    run: fastRun,
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  })).shape).toBe("exponential");
  expect(onlyWindow(fitGrowthFromRun({
    run: linearRun,
    series: "money",
    scenario: scenarioFor(10, 60, model(0)),
    sampling: sampling(60),
  })).shape).toBe("polynomial");
  const legacySlow = analyzeGrowth({ run: slowRun, series: "money", windowSec: 80 });
  expect(legacySlow.segments.length).toBeGreaterThan(1);
  expect(legacySlow.segments.every((segment) => segment.regime === "softcap")).toBe(true);
  const configured = fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(caseById("slow-exp")),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(),
    softcap: "configured",
  });
  expect(configured.softcap).toBe("configured");
  expect(onlyWindow(configured).shape).toBe("exponential");
  expect(configured.warnings.some((warning) => warning.includes("configured softcap"))).toBe(true);
  // A time axis wide enough that t * t overflows still fits on a scaled axis.
  const wide = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 8 }, (_, index) => ({ t: index * 1e155, amount: 10 ** index })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(7e155),
  });
  const wideWindow = onlyWindow(wide);
  expect(wideWindow.shape).toBe("exponential");
  expect(Number.isFinite(wideWindow.residual.rmse ?? Number.NaN)).toBe(true);
  expect(Math.abs((wideWindow.speed.logSlopePerSec ?? 0) / 1e-155 - 1)).toBeLessThan(1e-9);
  expect(validateGrowthFitArtifact(wide).success).toBe(true);
}

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-scale-domain Huge rescaled series match. Refused domains do not become stall or super-exp.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-scale-domain #38e5c42 Re-read the section: the 1e400 slope matches the rescaled slope, and a drop is split.
 * @evidence ./growthFit.ts#growthDomainNotDisguised Reads the domain contract id.
 * @evidenceReview ./growthFit.ts#growthDomainNotDisguised #cb12cc1 The declaration is non-positive-and-discontinuity-are-not-speed.
 */
export function refusesDisguisedDomains(): void {
  expect(growthDomainNotDisguised).toBe("non-positive-and-discontinuity-are-not-speed");
  const large = fitSpec(caseById("large-exp"), 40);
  const scaled = fitSpec(caseById("large-exp-rescaled"), 40);
  expect(onlyWindow(large).shape).toBe("exponential");
  expect(onlyWindow(scaled).shape).toBe(onlyWindow(large).shape);
  expect(
    Math.abs((onlyWindow(large).speed.logSlopePerSec ?? 0) - (onlyWindow(scaled).speed.logSlopePerSec ?? 0)),
  ).toBeLessThan(fixture.slopeTolerance);
  expect(createBreakInfinityEngine().absLog10(largeSamples(caseById("large-exp"))[0]!.amount)).toBeGreaterThan(300);

  const coarse = fitSpec(caseById("coarse-exp"));
  const fine = fitSpec(caseById("fast-exp"));
  expect(onlyWindow(coarse).shape).toBe("exponential");
  expect(
    Math.abs((onlyWindow(coarse).speed.logSlopePerSec ?? 0) - (onlyWindow(fine).speed.logSlopePerSec ?? 0)),
  ).toBeLessThan(fixture.slopeTolerance);

  const zero = fitSpec(caseById("zero"));
  const negative = fitSpec(caseById("negative"));
  const single = fitSpec(caseById("single"));
  expect(onlyWindow(zero).domain).toBe("zero");
  expect(onlyWindow(zero).shape).toBe("unknown");
  expect(onlyWindow(zero).legacySpeedBucket).toBeNull();
  expect(zero.status).toBe("invalid");
  expect(onlyWindow(negative).domain).toBe("negative");
  expect(onlyWindow(negative).shape).toBe("unknown");
  expect(negative.status).toBe("invalid");
  expect(single.status).toBe("insufficient-data");
  expect(onlyWindow(single).shape).toBe("unknown");
  for (const artifact of [zero, negative, single]) {
    expect(artifact.claimsResourceBottleneck).toBe(false);
    expect(JSON.stringify(artifact.windows)).not.toContain("stall");
    expect(JSON.stringify(artifact.windows)).not.toContain("super-exp");
  }

  const irregular = fitSpec(caseById("irregular-exp"));
  expect(irregular.irregular).toBe(true);
  expect(onlyWindow(irregular).shape).toBe("exponential");
  expect(onlyWindow(irregular).legacySpeedBucket).not.toBe("super-exp");
  expect(onlyWindow(irregular).legacySpeedBucket).not.toBe("stall");

  const reset = fitSpec(caseById("reset-drop"));
  expect(reset.windows.length).toBe(2);
  expect(reset.windows.every((window) => window.shape === "exponential")).toBe(true);
  expect(reset.windows.every((window) => window.legacySpeedBucket !== "super-exp" && window.legacySpeedBucket !== "stall")).toBe(true);
  expect(reset.windows[1]?.discontinuity).toBe("drop");
  const resetRun = simulate(caseById("reset-drop"));
  const resetFit = fitGrowthFromRun({
    run: resetRun,
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(resetFit.windows.length).toBe(2);
  expect(resetFit.windows.every((window) => window.shape === "exponential")).toBe(true);

  const purchased = fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(caseById("fast-exp")),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(),
    discontinuities: [{ t: 40, kind: "purchase" }],
  });
  expect(purchased.windows.length).toBe(2);
  expect(purchased.windows.every((window) => window.shape === "exponential")).toBe(true);
  expect(purchased.windows[1]?.discontinuity).toBe("purchase");

  const cadence = fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(caseById("fast-exp")),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80, 80),
  });
  expect(cadence.cadenceCoarserThanWindow).toBe(true);
  expect(cadence.status).toBe("insufficient-data");
  expect(onlyWindow(cadence).shape).toBe("unknown");

  const retained = fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(caseById("short-exp")),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(),
    retention: { totalSeen: 80, retained: 7, dropped: 73 },
  });
  expect(retained.status).toBe("insufficient-data");
  expect(retained.warnings.some((warning) => warning.includes("retained trace"))).toBe(true);
  expect(onlyWindow(retained).shape).toBe("unknown");

  const fitNumbers = (samples: GrowthSampleInput<number>[], overrides: Partial<GrowthSamplingContract> = {}) =>
    fitGrowth({
      E: createNumberEngine(),
      samples,
      seriesRequested: "money",
      valueSource: "money",
      sampling: { ...sampling(), ...overrides },
      softcap: "absent",
    });
  const offsets = Array.from({ length: 81 }, (_unused, index) => index);

  // A large absolute t does not change the fitted slope or shape.
  const lateWindow = onlyWindow(fitNumbers(offsets.map((offset) => ({ t: 1e9 + offset, amount: Math.exp(0.2 * offset) }))));
  expect(lateWindow.shape).toBe("exponential");
  expect(Math.abs((lateWindow.speed.logSlopePerSec ?? 0) - 0.2 / Math.LN10)).toBeLessThan(growthFitSlopeTolerance());

  // A one-point budget keeps one observation.
  const onePoint = fitNumbers(samplesFor(caseById("fast-exp")), { samplingBudget: 1 });
  expect(onePoint.sampleCount).toBe(1);
  expect(onlyWindow(onePoint).status).toBe("insufficient-data");
  expect(onlyWindow(onePoint).domain).toBe("positive");

  // A value-space fit near 1e200 keeps a finite residual instead of an overflowed square.
  const hugeFit = fitNumbers(offsets.map((t) => ({ t, amount: 1e200 + 1e198 * t })));
  for (const window of hugeFit.windows) {
    if (window.residual.rmse !== null) expect(Number.isFinite(window.residual.rmse)).toBe(true);
  }
  expect(hugeFit.windows.some((window) => window.residual.space === "value")).toBe(true);

  // An exact line with a large intercept is polynomial, not exponential.
  const lineWindow = onlyWindow(fitNumbers(offsets.map((t) => ({ t, amount: 10000 + 3 * t }))));
  expect(lineWindow.shape).toBe("polynomial");
  expect(lineWindow.residual.space).toBe("value");

  // Downsampling keeps both sides of a zero, so the sign break is not hidden.
  const zeroedFit = fitNumbers(
    offsets.map((t) => ({ t, amount: t === 40 ? 0 : Math.exp(0.2 * t) })),
    { samplingBudget: 8 },
  );
  expect(zeroedFit.windows.some((window) => window.domain !== "positive")).toBe(true);
  expect(zeroedFit.windows.some((window) => window.discontinuity === "sign")).toBe(true);

  // A cubic that starts at t=1000 is a log-space power fit on rebased time.
  const shiftedPower = onlyWindow(fitNumbers(offsets.map((offset) => ({ t: 1000 + offset, amount: (offset + 1) ** 3 }))));
  expect(shiftedPower.shape).toBe("polynomial");
  expect(shiftedPower.residual.space).toBe("log10");

  // An exact tenfold drop opens a new window.
  const tenfold = fitNumbers(
    offsets.map((t) => ({ t, amount: t <= 40 ? 10 ** (t / 20) : 10 ** ((t - 41) / 20 + 1) })),
  );
  expect(tenfold.windows.some((window) => window.discontinuity === "drop")).toBe(true);

  // A saturating trace downsampled to uneven gaps is still saturating.
  const saturatingFull = onlyWindow(fitSpec(caseById("saturating")));
  const saturatingCoarse = onlyWindow(fitNumbers(samplesFor(caseById("saturating")), { samplingBudget: 8 }));
  expect(saturatingFull.shape).toBe("saturating");
  expect(saturatingCoarse.shape).toBe("saturating");

  // Coarse cadence keeps an all-zero trace invalid.
  const coarseZero = fitNumbers(samplesFor(caseById("zero")), { windowSec: 80, cadenceSec: 80 });
  expect(onlyWindow(coarseZero).status).toBe("invalid");

  // A sub-unit exponential keeps its shape; a unit conversion does not make it polynomial.
  // 1e-11 stays above the number engine's zero tolerance, and the whole series stays below 1e-9.
  const tinyExp = onlyWindow(fitNumbers(offsets.map((t) => ({ t, amount: 1e-11 * Math.exp(0.05 * t) }))));
  const unitExp = onlyWindow(fitNumbers(offsets.map((t) => ({ t, amount: Math.exp(0.05 * t) }))));
  expect(tinyExp.shape).toBe("exponential");
  expect(tinyExp.shape).toBe(unitExp.shape);

  // A slow exponential keeps its exact log fit over a threshold-close value parabola.
  const slowExp = onlyWindow(fitNumbers(offsets.map((t) => ({ t, amount: Math.exp(1e-5 * t) }))));
  expect(slowExp.shape).toBe("exponential");
  expect(onlyWindow(fitNumbers(offsets.map((t) => ({ t, amount: 10000 + 3 * t })))).shape).toBe("polynomial");

  // An irregular input cadence stays irregular after the sampling budget thins it.
  const gappedTimes = [...Array.from({ length: 40 }, (_unused, index) => index), ...Array.from({ length: 41 }, (_unused, index) => 50 + index)];
  const gapped = fitNumbers(gappedTimes.map((t) => ({ t, amount: Math.exp(0.05 * t) })), { samplingBudget: 8 });
  expect(gapped.irregular).toBe(true);

  // A trace that retention emptied stays empty.
  const emptyTraceRun = runScenario({
    ...scenarioFor(1, 10, model(1)),
    run: { stepSec: 1, durationSec: 10, trace: { everySteps: 1, maxPoints: 0, keepActionsLog: false } },
  });
  expect(emptyTraceRun.trace).toEqual([]);
  const emptyTraceFit = fitGrowthFromRun({ run: emptyTraceRun, series: "money", scenario: scenarioFor(1, 10, model(1)), sampling: sampling() });
  expect(emptyTraceFit.sampleCount).toBe(0);
  expect(emptyTraceFit.status).toBe("insufficient-data");

  // An action row opens its window at the first trace state after the action.
  const fastTrace = simulate(caseById("fast-exp"));
  const withActionRows = (rows: { t: number; actionId: string }[], logged: boolean): RunResult<number, UnitCode, Vars> => ({
    ...fastTrace,
    actionsLog: logged ? rows : undefined,
    ...(logged ? { actionsLogMeta: { totalSeen: rows.length, dropped: 0, retained: rows.length } } : {}),
    stats: { ...fastTrace.stats!, actions: { ...fastTrace.stats!.actions, applied: rows.length } },
  });
  const boughtFit = fitGrowthFromRun({
    run: withActionRows([{ t: 40, actionId: "buy" }], true),
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(boughtFit.windows.map((window) => window.startSec)).toEqual([0, 41]);
  expect(boughtFit.windows[1]?.discontinuity).toBe("purchase");
  const openingFit = fitGrowthFromRun({
    run: withActionRows([{ t: 0, actionId: "buy" }], true),
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(openingFit.windows.some((window) => window.startSec === 1 && window.discontinuity === "purchase")).toBe(true);

  // Without a complete action history the fit withholds shape claims.
  const unloggedFit = fitGrowthFromRun({
    run: withActionRows([{ t: 40, actionId: "buy" }], false),
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(unloggedFit.windows.every((window) => window.status !== "ok" && window.shape === "unknown")).toBe(true);
  expect(unloggedFit.warnings.some((warning) => warning.includes("action history is incomplete"))).toBe(true);
  // A missing action counter reports 0 too. That zero is not proof that no action ran.
  const unobserved: RunResult<number, UnitCode, Vars> = {
    ...fastTrace,
    actionsLog: undefined,
    stats: { ...fastTrace.stats!, actions: { ...fastTrace.stats!.actions, status: "missing", applied: 0 } },
  };
  const unobservedFit = fitGrowthFromRun({
    run: unobserved,
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(unobservedFit.warnings.some((warning) => warning.includes("action history is incomplete"))).toBe(true);
  const observedZero = fitGrowthFromRun({
    run: { ...unobserved, stats: { ...fastTrace.stats!, actions: { ...fastTrace.stats!.actions, status: "observed", applied: 0 } } },
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(observedZero.warnings.some((warning) => warning.includes("action history is incomplete"))).toBe(false);

  // Breaks at one time keep the reset, whatever order the caller lists them in.
  const ordered = fitGrowth({
    E: createNumberEngine(),
    samples: samplesFor(caseById("fast-exp")),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(),
    discontinuities: [
      { t: 40, kind: "reset" },
      { t: 40, kind: "purchase" },
    ],
  });
  expect(ordered.windows.find((window) => window.startSec >= 40)?.discontinuity).toBe("reset");

  // A trace longer than the argument limit of a spread call is measured in a loop, gaps and kept log values both.
  const longTrace = Array.from({ length: 1_000_001 }, (_, index) => ({ t: index / 1000, amount: Math.exp(index / 100_000) }));
  const longFit = fitGrowth({
    E: createNumberEngine(),
    samples: longTrace,
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(1000), samplingBudget: 1_000_001 },
  });
  expect(longFit.sampleCount).toBe(1_000_001);
  expect(onlyWindow(longFit).shape).toBe("exponential");
  // A trace that alternates sign on every point is split in linear time.
  const flicker = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 20_001 }, (_, index) => ({ t: index, amount: index % 2 === 0 ? 1 : -1 })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(20_000),
  });
  expect(flicker.windows.length).toBeGreaterThan(0);

  // An exact line with a large intercept is a polynomial, not a constant. A flat series stays constant.
  const intercept = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: 1e9 + 3 * t })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(intercept).shape).toBe("polynomial");
  const flat = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: 1e9 })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(flat).shape).toBe("constant");

  // A large log offset does not change the shape. The fit runs on log values relative to the first one.
  const offsetEngine = createBreakInfinityEngine();
  const offset = fitGrowth({
    E: offsetEngine,
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: offsetEngine.from(`1e${1e12 + 0.01 * t}`) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(offset).shape).toBe("exponential");
  expect(Math.abs((onlyWindow(offset).speed.logSlopePerSec ?? 0) - 0.01)).toBeLessThan(1e-4);

  // A buy whose id mentions prestige is a purchase. Action.kind decides, not the id.
  const generator = {
    id: "prestige-generator",
    kind: "buy" as const,
    canApply: () => true,
    cost: () => null,
    apply: (_ctx: unknown, state: SimState<number, UnitCode, Vars>) => state,
  };
  const namedFit = fitGrowthFromRun({
    run: withActionRows([{ t: 40, actionId: "prestige-generator" }], true),
    series: "money",
    scenario: scenarioFor(1, 80, { ...model(0), actions: () => [generator] }),
    sampling: sampling(),
  });
  expect(namedFit.windows[1]?.discontinuity).toBe("purchase");
  // An action the model did not list at the traced state is a purchase, whatever its id says.
  const unlistedFit = fitGrowthFromRun({
    run: withActionRows([{ t: 40, actionId: "prestige-generator" }], true),
    series: "money",
    scenario: scenarioFor(1, 80, model(0)),
    sampling: sampling(),
  });
  expect(unlistedFit.windows[1]?.discontinuity).toBe("purchase");

  // The softcap hint is read at the analyzed run's start.
  const softcapped = fitGrowthFromRun({
    run: { ...fastTrace, start: makeState(10, 1) },
    series: "money",
    scenario: scenarioFor(1, 80, {
      ...model(0),
      analytic: (_ctx, state) =>
        state.t >= 10 ? { softcap: { kind: "log", startsAt: { unit: { code: "COIN" }, amount: 1 } } } : null,
    }),
    sampling: sampling(),
  });
  expect(softcapped.softcap).toBe("configured");

  // Saturation midpoints near the number limit stay finite: gaps of 2.5e307 seconds sum past Number.MAX_VALUE.
  const farSaturating = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 8 }, (_, index) => ({ t: index * 2.5e307, amount: 100 - 90 * 0.5 ** index })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(7 * 2.5e307),
  });
  expect(onlyWindow(farSaturating).shape).toBe("saturating");
  // A slow but exact exponential is exponential, not constant, even when its log span is tiny.
  const slowExact = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(1e-8 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(slowExact).shape).toBe("exponential");
  // An exact log-quadratic is accelerating however gentle the acceleration.
  const gentleAccel = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(3e-6 * t * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(gentleAccel).shape).toBe("accelerating-log");
  const gentlerAccel = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(1e-7 * t * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(gentlerAccel).shape).toBe("accelerating-log");
  // Each side of a break gets its own share of the budget.
  const splitBudget = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(0.05 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 16 },
    discontinuities: [{ t: 31, kind: "purchase" }],
  });
  expect(splitBudget.windows.map((window) => window.status)).toEqual(["ok", "ok"]);
  // A big-number affine series is a polynomial, as the same series in small units is.
  const bigEngine = createBreakInfinityEngine();
  const bigLine = fitGrowth({
    E: bigEngine,
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: bigEngine.mul(bigEngine.from("1e400"), 10 + 3 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(bigLine).shape).toBe("polynomial");
  // The budget goes to windows that can be fitted, not to an isolated sample before them.
  const isolated = fitGrowth({
    E: createNumberEngine(),
    samples: [{ t: 0, amount: 1 }, ...Array.from({ length: 81 }, (_, index) => ({ t: 100 + index, amount: Math.exp(0.05 * index) }))],
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 8 },
  });
  expect(isolated.windows.some((window) => window.shape === "exponential")).toBe(true);
  // Renewed growth after a flat step is not a saturating tail.
  const renewed = fitGrowth({
    E: createNumberEngine(),
    samples: [1, 50, 75, 87.5, 93.75, 96.875, 96.875, 200, 300, 500, 900].map((amount, index) => ({ t: index * 5, amount })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(renewed).shape).not.toBe("saturating");
  // Rates whose quotient would underflow stay finite through log(step) - log(gap).
  // The default number engine treats amounts within 1e-12 of zero as zero, so this probe turns that tolerance off.
  const tinyRates = fitGrowth({
    E: createNumberEngine({ epsilon: 0 }),
    samples: Array.from({ length: 10 }, (_, index) => ({ t: index * 1e100, amount: 1e-240 * (2 - 0.5 ** index) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(1e102),
  });
  expect(onlyWindow(tinyRates).shape).toBe("saturating");
  // An exact log-quadratic curve is accelerating-log even when a value-space parabola is nearly as close.
  const faintAccel = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(1e-8 * t * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  expect(onlyWindow(faintAccel).shape).toBe("accelerating-log");
  // A long plateau does not take the samples a thinned saturation fit needs.
  const longPlateau = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 1000 }, (_, index) => ({ t: index + 1, amount: 100 * (1 - Math.exp(-0.2 * (index + 1))) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(1000), samplingBudget: 16 },
  });
  expect(onlyWindow(longPlateau).shape).toBe("saturating");
  // A power law keeps its shape in windows that do not start at its origin.
  const cubic = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 241 }, (_, t) => ({ t, amount: (t + 1) ** 3 })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 241 },
  });
  expect(cubic.windows.map((window) => window.shape)).toEqual(["polynomial", "polynomial", "polynomial"]);
  // Far from its origin a power law is nearly log-linear, but the exact power fit still wins.
  const farCubic = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 3078 }, (_, t) => ({ t, amount: (t + 1) ** 3 })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 3078 },
  });
  expect(farCubic.windows[farCubic.windows.length - 1]?.shape).toBe("polynomial");
  // Incomplete history withholds the fitted shape's residual, speed, and diagnostics too.
  const withheld = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: Math.exp(0.05 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
    actionHistory: "incomplete",
  });
  expect(onlyWindow(withheld).residual).toEqual({ space: "none", rmse: null });
  expect(onlyWindow(withheld).speed).toEqual({ logSlopePerSec: null, doublingTimeSec: null });
  expect(onlyWindow(withheld).quality).not.toContain("exponential");
  // Saturation does not depend on the retained cadence.
  const saturationSamples = Array.from({ length: 80 }, (_, index) => ({ t: index + 1, amount: 100 * (1 - Math.exp(-0.3 * (index + 1))) }));
  const fullSaturation = fitGrowth({
    E: createNumberEngine(),
    samples: saturationSamples,
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 80 },
  });
  const thinSaturation = fitGrowth({
    E: createNumberEngine(),
    samples: saturationSamples,
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 8 },
  });
  expect(onlyWindow(fullSaturation).shape).toBe("saturating");
  expect(onlyWindow(thinSaturation).shape).toBe("saturating");
  // The saturating residual is the saturation fit's own, in log-rate space.
  expect(onlyWindow(fullSaturation).residual.space).toBe("log-rate");
  expect(onlyWindow(fullSaturation).residual.rmse).toBeLessThan(1e-6);
  // A plateau that rounds to equal values does not hide saturation.
  const plateau = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 500 }, (_, index) => ({ t: index + 1, amount: 100 * (1 - Math.exp(-0.08 * (index + 1))) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(500), samplingBudget: 500 },
  });
  expect(onlyWindow(plateau).shape).toBe("saturating");
  // A very slow exponential still has a finite doubling time.
  const verySlow = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 81 }, (_, t) => ({ t, amount: 10 ** (1e-13 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: sampling(80),
  });
  const verySlowDoubling = onlyWindow(verySlow).speed.doublingTimeSec;
  expect(verySlowDoubling).not.toBeNull();
  expect(Math.abs((verySlowDoubling ?? 0) / (Math.log10(2) / 1e-13) - 1)).toBeLessThan(1e-3);
  // A long trace under a small budget keeps analyzable windows instead of one point per window.
  const longExp = fitGrowth({
    E: createNumberEngine(),
    samples: Array.from({ length: 100_001 }, (_, t) => ({ t, amount: Math.exp(1e-4 * t) })),
    seriesRequested: "money",
    valueSource: "money",
    sampling: { ...sampling(80), samplingBudget: 256 },
  });
  expect(longExp.windows.some((window) => window.shape === "exponential")).toBe(true);
  expect(longExp.warnings.some((warning) => warning.includes("The rest are not fitted"))).toBe(true);
}

/**
 * @evidence docs/requirements/active/growth-model-classification.md#req-pr12-legacy-preserved netWorthFallback remains, and the legacy regime is not rewritten.
 * @evidenceReview docs/requirements/active/growth-model-classification.md#req-pr12-legacy-preserved #1355aa0 Re-read the section: the net-worth fixture still names netWorth, and a missing net worth falls back.
 * @evidence ./growthFit.ts#growthLegacyObservationPreserved Reads the legacy contract id.
 * @evidenceReview ./growthFit.ts#growthLegacyObservationPreserved #dfb88c0 The declaration is legacy-report-and-net-worth-fallback.
 */
export function preservesLegacyNetWorthFallback(): void {
  expect(growthLegacyObservationPreserved).toBe("legacy-report-and-net-worth-fallback");
  const E = createNumberEngine();
  const withWorth: Model<number, UnitCode, Vars> = {
    id: "m",
    version: 1,
    income: () => ({ unit: { code: "COIN" }, amount: 0 }),
    actions: () => [],
    netWorth: (_ctx, state) => ({ unit: { code: "COIN" }, amount: state.wallet.money.amount + state.vars.owned * 100 }),
  };
  const compiled: CompiledScenario<number, UnitCode, Vars> = {
    ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" } },
    model: withWorth,
    initial: makeState(0, 10, 0),
    run: { stepSec: 1, durationSec: 2 },
  };
  const run: RunResult<number, UnitCode, Vars> = {
    start: makeState(0, 10, 0),
    end: makeState(2, 20, 2),
    events: [],
    trace: [makeState(0, 10, 0), makeState(1, 15, 1), makeState(2, 20, 2)],
  };
  const legacy = analyzeGrowth({ run, scenario: compiled, series: "netWorth", windowSec: 60 });
  expect(legacy.seriesRequested).toBe("netWorth");
  expect(legacy.valueSource).toBe("netWorth");
  expect(legacy.segments.length).toBe(2);
  const fit = fitGrowthFromRun({ run, scenario: compiled, series: "netWorth", sampling: sampling(60) });
  expect(fit.valueSource).toBe("netWorth");
  expect(fit.claimsResourceBottleneck).toBe(false);

  const noWorth = model(0);
  const fallbackScenario = scenarioFor(1, 2, noWorth);
  const fallbackRun: RunResult<number, UnitCode, Vars> = {
    start: makeState(0, 1),
    end: makeState(2, 3),
    events: [],
    trace: [makeState(0, 1), makeState(1, 2), makeState(2, 3)],
  };
  expect(analyzeGrowth({ run: fallbackRun, scenario: fallbackScenario, series: "netWorth", windowSec: 60 }).valueSource).toBe(
    "netWorthFallback",
  );
  expect(
    fitGrowthFromRun({ run: fallbackRun, scenario: fallbackScenario, series: "netWorth", sampling: sampling(60) }).valueSource,
  ).toBe("netWorthFallback");
}

describe("growth fit", () => {
  it("separates shape from speed", separatesShapeFromSpeed);
  it("refuses disguised domains", refusesDisguisedDomains);
  it("preserves the legacy net worth fallback", preservesLegacyNetWorthFallback);
});
