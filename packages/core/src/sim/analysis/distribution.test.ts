import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createModelRegistry, defineModelFactory } from "../../scenario/registry";
import { createNumberEngine } from "../../engine/breakInfinity";
import {
  assertMonteCarloDrawRequest,
  monteCarloDrawBudget,
  simulateMonteCarlo,
} from "../monteCarlo";
import { createRunFactory } from "../runFactory";
import { deriveDrawSeed, logicalDrawId, logicalDrawSeed, mulberry32 } from "../random";
import { runScenario } from "../simulator";
import type { CompiledScenario, Model, SimState } from "../types";
import {
  analyzeDistribution,
  assertDistributionRun,
  canonicalQuantileKey,
  distributionAlgorithmVersion,
  distributionEmpiricalDrop,
  distributionJsonSchema,
  distributionLogicalDraws,
  distributionMeanIdentity,
  distributionQuantileConvention,
  distributionSchemaId,
  distributionSampleAccounting,
  firstVisibleDistributionSample,
  independentBernoulli,
  quantileInclusiveFloor,
  validateDistributionArtifact,
  type DistributionSample,
} from "./distribution";

const dropFixture = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../../../fixtures/conformance/independent-drop.json"), "utf8"),
) as {
  id: string;
  seed: number;
  draws: number;
  probability: number;
  absoluteTolerance: number;
};

const unit = { code: "COIN" as const };

function sample(
  drawIndex: number,
  status: DistributionSample["status"],
  value: string | null,
  source: DistributionSample["source"] = "model-strategy-session",
): DistributionSample {
  return { drawIndex, seed: logicalDrawSeed(0x7113, drawIndex), status, value, source };
}

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-sample-accounting Ninety completions do not supply the population p95, and a censored run is not zero.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-sample-accounting #6e4e90e Re-read the section, then ran this function: completion is 0.9, population p95 is null, and the censored mean is null.
 * @evidence ./distribution.ts#distributionSampleAccounting Reads the sample accounting contract.
 * @evidenceReview ./distribution.ts#distributionSampleAccounting #b204d5a The declaration is observed-censored-failed-unsupported.
 * @evidence ./distribution.ts#analyzeDistribution Analyzes observed, censored, failed, and unsupported samples.
 * @evidenceReview ./distribution.ts#analyzeDistribution #b84e856 The function orders samples by draw index, rejects duplicate or invalid draws, an unknown status or source, an observed value the number does not hold exactly, and a completion past the common horizon, counts each status apart, keeps censored draws out of the conditional quantiles, and keeps the mean finite inside the sample range and the variance finite or absent. The mean is a compensated sum over a power-of-two scale, so cancelling extremes keep a small residual.
 */
export function separatesCensoringFromObservedQuantiles(): void {
  expect(distributionSampleAccounting).toBe("observed-censored-failed-unsupported");
  const samples: DistributionSample[] = [];
  for (let drawIndex = 0; drawIndex < 90; drawIndex += 1) samples.push(sample(drawIndex, "observed", "10"));
  for (let drawIndex = 90; drawIndex < 100; drawIndex += 1) samples.push(sample(drawIndex, "censored", null));
  const report = analyzeDistribution({
    samples: [...samples].reverse(),
    quantiles: [0.5, 0.95],
    horizonSec: 40,
    populationProbability: 0.95,
  });
  expect(report.accounting.draws).toBe(100);
  expect(report.accounting.observed).toBe(90);
  expect(report.accounting.rightCensored).toBe(10);
  expect(report.accounting.failed).toBe(0);
  expect(report.accounting.completionRate).toBe(0.9);
  expect(report.population.status).toBe("outside-observed-range");
  expect(report.population.value).toBeNull();
  expect(report.population.conditioning).toBe("all-eligible-draws");
  const conditional = report.conditional.find((point) => point.q === 0.95);
  expect(conditional?.conditioning).toBe("completed-only");
  expect(conditional?.value).toBe("10");
  expect(report.population.value).not.toBe(conditional?.value);
  expect(report.seeds[0]?.drawId).toBe("0");
  expect(report.seeds[99]?.drawId).toBe("99");
  expect(report.reduction.workerCountIndependent).toBe(true);

  const censored = analyzeDistribution({
    samples: [0, 1, 2, 3, 4].map((drawIndex) => sample(drawIndex, "censored", null)),
    quantiles: [0.5, 0.95],
    horizonSec: 20,
  });
  expect(censored.status).toBe("unavailable");
  expect(censored.population.status).toBe("unavailable");
  expect(censored.population.value).toBeNull();
  expect(censored.means.arithmetic.value).toBeNull();
  expect(censored.means.arithmetic.value).not.toBe("0");
  expect(censored.conditional.every((point) => point.value === null)).toBe(true);
  expect(censored.accounting.completionRate).toBe(0);

  const failed = analyzeDistribution({
    samples: [sample(0, "observed", "10"), sample(1, "observed", "10"), sample(2, "failed", "0")],
    quantiles: [0.5],
    horizonSec: 10,
  });
  expect(failed.accounting.failed).toBe(1);
  expect(failed.means.arithmetic.value).toBe("10");
  expect(failed.means.arithmetic.value).not.toBe("0");

  // A completion past the common horizon would make the rank of a censored draw unknowable.
  expect(() =>
    analyzeDistribution({
      samples: [sample(0, "observed", "100"), sample(1, "censored", null)],
      quantiles: [0.5],
      horizonSec: 40,
    }),
  ).toThrow("exceeds the common horizonSec");
  // Untyped input with another status is not counted as a completion.
  const typo = { ...sample(0, "observed", "10"), status: "failure" } as unknown as DistributionSample;
  expect(() => analyzeDistribution({ samples: [typo], quantiles: [0.5] })).toThrow("sample status must be");
  // A value the number cannot hold is rejected. Another spelling of a representable value is kept.
  expect(() => analyzeDistribution({ samples: [sample(0, "observed", "9007199254740993")], quantiles: [0.5] })).toThrow(
    "not exactly representable",
  );
  const spelled = analyzeDistribution({
    samples: [sample(0, "observed", "1e3"), sample(1, "observed", "10.50"), sample(2, "observed", "-0")],
    quantiles: [0, 1],
  });
  expect(spelled.conditional.map((point) => point.value)).toEqual(["0", "1000"]);
  // Finite samples do not overflow the mean, and a variance past the number range is not reported.
  const huge = analyzeDistribution({ samples: [sample(0, "observed", "1e308"), sample(1, "observed", "1e308")], quantiles: [0.5] });
  expect(huge.means.arithmetic).toEqual({ label: "arithmetic-mean", status: "observed", value: "1e+308" });
  expect(huge.uncertainty.variance).toBe(0);
  const spread = analyzeDistribution({ samples: [sample(0, "observed", "-1e308"), sample(1, "observed", "1e308")], quantiles: [0.5] });
  expect(spread.means.arithmetic.value).toBe("0");
  expect(spread.uncertainty.variance).toBeNull();
  expect(spread.uncertainty.zeroVariance).toBe(false);
  expect(spread.warnings).toContain("variance exceeds the number range and is not reported");
  // At the number limit the scaled mean is kept inside [min, max], so it stays finite.
  const limit = String(Number.MAX_VALUE);
  const atLimit = analyzeDistribution({
    samples: [sample(0, "observed", limit), sample(1, "observed", limit), sample(2, "observed", limit)],
    quantiles: [0.5],
  });
  expect(atLimit.means.arithmetic).toEqual({ label: "arithmetic-mean", status: "observed", value: limit });
  // Large values that cancel keep the small residual.
  const negativeLimit = `-${limit}`;
  const cancelling = analyzeDistribution({
    samples: [
      sample(0, "observed", limit),
      sample(1, "observed", limit),
      sample(2, "observed", negativeLimit),
      sample(3, "observed", negativeLimit),
      sample(4, "observed", "1e-100"),
    ],
    quantiles: [0.5],
  });
  expect(cancelling.means.arithmetic.value).toBe(String(1e-100 / 5));
  // A long run of zeros is read in linear time, and a value that underflows to 0 is not the value written.
  const tiny = `0.${"0".repeat(20_000)}1${"0".repeat(20_000)}1`;
  expect(() => analyzeDistribution({ samples: [sample(0, "observed", tiny)], quantiles: [0.5] })).toThrow(
    "not exactly representable",
  );
  // Untyped input with another source is rejected, so the artifact names only declared sources.
  const billing = { ...sample(0, "observed", "10"), source: "billing" } as unknown as DistributionSample;
  expect(() => analyzeDistribution({ samples: [billing], quantiles: [0.5] })).toThrow("sample source must be");
}

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention Fixed ranks, bounds, an empty sample, and distinct keys.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-quantile-convention #2413847 Re-read the section, then ran this function: q0 is 1, q1 is 5, q0.5 is 3, q0.95 is 4, and the empty sample is null.
 * @evidence ./distribution.ts#distributionQuantileConvention Reads the quantile method id.
 * @evidenceReview ./distribution.ts#distributionQuantileConvention #43674a3 The declaration is inclusive-floor-index-v1.
 * @evidence ./distribution.ts#validateDistributionArtifact The fixed report validates.
 * @evidenceReview ./distribution.ts#validateDistributionArtifact #b87b2a8 The arrow builds typia.createValidate of DistributionArtifactV1 on first call and reuses it.
 * @evidence ./distribution.ts#distributionJsonSchema The schema is OpenAPI 3.1.
 * @evidenceReview ./distribution.ts#distributionJsonSchema #24ddd2f The function memoizes typia.json.schema of DistributionArtifactV1.
 * @evidence ./distribution.ts#quantileInclusiveFloor Reads inclusive floor ranks and an empty input.
 * @evidenceReview ./distribution.ts#quantileInclusiveFloor #afe5ae7 The function sorts the finite values and returns the floor-index element, or null for no values.
 * @evidence ./distribution.ts#canonicalQuantileKey Builds keys for distinct quantiles that round alike.
 * @evidenceReview ./distribution.ts#canonicalQuantileKey #68f7438 The function rejects a quantile outside [0, 1] and returns q followed by its decimal spelling.
 * @evidence ./distribution.ts#distributionSchemaId Reads the distribution schema id.
 * @evidenceReview ./distribution.ts#distributionSchemaId #2c5a312 The function returns the distribution.v1 schema URL constant.
 * @evidence ./distribution.ts#distributionAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./distribution.ts#distributionAlgorithmVersion #1e22b1c The function returns the distribution-v1 constant.
 */
export function fixesQuantileRanksAndKeys(): void {
  expect(distributionSchemaId()).toBe("https://idlekit.dev/schemas/distribution.v1.schema.json");
  expect(distributionAlgorithmVersion()).toBe("distribution-v1");
  expect(canonicalQuantileKey(0.5)).toBe("q0.5");
  expect(canonicalQuantileKey(0.995)).not.toBe(canonicalQuantileKey(0.999));
  expect(() => canonicalQuantileKey(1.5)).toThrow();
  expect(distributionQuantileConvention).toBe("inclusive-floor-index-v1");
  const values = [1, 2, 3, 4, 5];
  expect(quantileInclusiveFloor(values, 0)).toBe(1);
  expect(quantileInclusiveFloor(values, 1)).toBe(5);
  expect(quantileInclusiveFloor(values, 0.5)).toBe(3);
  expect(quantileInclusiveFloor(values, 0.95)).toBe(4);
  expect(quantileInclusiveFloor([], 0.5)).toBeNull();

  const ranked = analyzeDistribution({
    samples: values.map((value, drawIndex) => sample(drawIndex, "observed", String(value))),
    quantiles: [0, 0.5, 0.95, 1],
    horizonSec: 5,
  });
  expect(ranked.method).toEqual({ id: "inclusive-floor-index", version: 1 });
  expect(ranked.conditional.map((point) => point.value)).toEqual(["1", "3", "4", "5"]);
  expect(ranked.conditional.map((point) => point.key)).toEqual(["q0", "q0.5", "q0.95", "q1"]);
  expect(validateDistributionArtifact(ranked).success).toBe(true);
  expect(distributionJsonSchema().version).toBe("3.1");

  const nearby = analyzeDistribution({
    samples: values.map((value, drawIndex) => sample(drawIndex, "observed", String(value))),
    quantiles: [0.946, 0.954],
    horizonSec: 5,
  });
  expect(nearby.conditional.map((point) => point.key)).toEqual(["q0.946", "q0.954"]);

  expect(() =>
    analyzeDistribution({
      samples: [sample(0, "observed", "1")],
      quantiles: [0.5, 0.5],
    }),
  ).toThrow(/duplicated/);
  expect(() => analyzeDistribution({ samples: [], quantiles: [Number.NaN] })).toThrow(/quantile/);
  expect(() => analyzeDistribution({ samples: [], quantiles: [1.1] })).toThrow(/quantile/);
  const empty = analyzeDistribution({ samples: [], quantiles: [0, 0.5, 1] });
  expect(empty.status).toBe("unavailable");
  expect(empty.conditional.every((point) => point.status === "unavailable" && point.value === null)).toBe(true);
  expect(empty.means.arithmetic.value).not.toBe("0");
}

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws Reversed fresh draws keep the logical seed, and pairing without a stream throws.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-logical-draws #6e3688a Re-read the section, then ran this function: draw 2 stays at money 3 with its own seed, and a second call matches.
 * @evidence ./distribution.ts#distributionLogicalDraws Reads the logical draw contract.
 * @evidenceReview ./distribution.ts#distributionLogicalDraws #13ae205 The declaration is logical-index-not-worker-slot.
 * @evidence ../monteCarlo.ts#monteCarloDrawBudget Reads the finite draw bound.
 * @evidenceReview ../monteCarlo.ts#monteCarloDrawBudget #f92dee6 The declaration is finite-integer-draws.
 * @evidence ../monteCarlo.ts#simulateMonteCarlo Runs fresh draws and compares their logical seeds.
 * @evidenceReview ../monteCarlo.ts#simulateMonteCarlo #3487593 The function validates the draw request, binds a run factory, opens a fresh scenario per logical draw seed, and releases the binding without masking a draw failure.
 * @evidence ../monteCarlo.ts#assertMonteCarloDrawRequest Rejects NaN and Infinity draws, seeds, and budgets.
 * @evidenceReview ../monteCarlo.ts#assertMonteCarloDrawRequest #30c61b4 The function floors finite draws to at least 1 and rejects a nonfinite seed or a budget below the draws.
 * @evidence ../random.ts#mulberry32 Replays one stream from one seed.
 * @evidenceReview ../random.ts#mulberry32 #4d4aba0 The function returns a 32-bit mulberry generator whose outputs are in [0, 1) and repeat for the same seed.
 * @evidence ../random.ts#deriveDrawSeed Derives the seed of one draw.
 * @evidenceReview ../random.ts#deriveDrawSeed #f9d31a5 The function seeds mulberry32 with the base seed mixed with the draw index and returns one unsigned 32-bit integer.
 * @evidence ../random.ts#logicalDrawSeed Checks its inputs and derives the logical draw seed.
 * @evidenceReview ../random.ts#logicalDrawSeed #d14b996 The function rejects a non-finite base and an index that is not an integer >= 0, then returns deriveDrawSeed.
 * @evidence ../random.ts#logicalDrawId Spells the logical draw id.
 * @evidenceReview ../random.ts#logicalDrawId #5e0466d The function rejects an index that is not an integer >= 0 and returns its decimal spelling.
 * @evidence ./distribution.ts#assertDistributionRun Rejects nonfinite draws and common random numbers without the execution stream.
 * @evidenceReview ./distribution.ts#assertDistributionRun #95dc466 The function checks draws, seed, budget, and quantile keys, and rejects coupling without the execution stream.
 */
export function keepsLogicalDrawsIndependentOfOrder(): void {
  const left = mulberry32(7);
  const right = mulberry32(7);
  const stream = [left(), left(), left()];
  expect(stream).toEqual([right(), right(), right()]);
  expect(stream.every((value) => value >= 0 && value < 1)).toBe(true);
  const derived = deriveDrawSeed(0x7113, 2);
  expect(Number.isInteger(derived) && derived >= 0 && derived < 2 ** 32).toBe(true);
  expect(logicalDrawSeed(0x7113, 2)).toBe(derived);
  expect(logicalDrawSeed(0x7113, 3)).not.toBe(derived);
  expect(() => logicalDrawSeed(Number.NaN, 0)).toThrow("logical draw seed base must be finite");
  expect(() => logicalDrawSeed(1, -1)).toThrow("logical draw index must be an integer >= 0");
  expect(logicalDrawId(12)).toBe("12");
  expect(() => logicalDrawId(1.5)).toThrow("logical draw index must be an integer >= 0");
  expect(distributionLogicalDraws).toBe("logical-index-not-worker-slot");
  expect(monteCarloDrawBudget).toBe("finite-integer-draws");
  expect(() => assertMonteCarloDrawRequest(Number.NaN, 1)).toThrow(/draws/);
  expect(() => assertMonteCarloDrawRequest(Number.POSITIVE_INFINITY, 1)).toThrow(/draws/);
  expect(() => assertMonteCarloDrawRequest(0, 1)).toThrow(/draws/);
  expect(() => assertMonteCarloDrawRequest(2, Number.NaN)).toThrow(/seed/);
  expect(() => assertDistributionRun({ draws: 4, seed: 1, quantiles: [0.5], budget: Number.POSITIVE_INFINITY })).toThrow(
    /budget/,
  );
  expect(() =>
    assertDistributionRun({
      draws: 2,
      seed: 1,
      quantiles: [0.5],
      coupling: { commonRandomNumbers: true, executionStream: false },
    }),
  ).toThrow(/execution stream/);
  expect(logicalDrawSeed(0x7113, 2)).toBe(logicalDrawSeed(0x7113, 2));
  expect(logicalDrawId(2)).toBe("2");

  const E = createNumberEngine();
  const factory = defineModelFactory<number, "COIN", { calls: number }>({
    id: "stateful-income",
    version: 1,
    create: () => {
      let calls = 0;
      const model: Model<number, "COIN", { calls: number }> = {
        id: "stateful-income",
        version: 1,
        income: (ctx) => {
          calls += 1;
          return { unit: ctx.unit, amount: calls };
        },
        actions: () => [],
      };
      return model;
    },
  });
  const initial: SimState<number, "COIN", { calls: number }> = {
    t: 0,
    wallet: { money: { unit, amount: 0 }, bucket: 0 },
    maxMoneyEver: { unit, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { calls: 0 },
  };
  const scenario: CompiledScenario<number, "COIN", { calls: number }> = {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: { id: "placeholder", version: 1, income: () => ({ unit, amount: 0 }), actions: () => [] },
    initial,
    run: { stepSec: 1, durationSec: 2 },
  };
  const isolation = { model: { id: "stateful-income", version: 1 }, statefulModel: true as const };
  const registries = { models: createModelRegistry([factory]) };
  const run = () =>
    simulateMonteCarlo({
      scenario,
      draws: 3,
      seed: 0x7113,
      registries,
      isolation,
      metrics: ({ run: result, seed, drawIndex }) => ({
        money: result.end.wallet.money.amount,
        seed,
        drawIndex,
      }),
    });
  const first = run();
  const second = run();
  expect(second.results).toEqual(first.results);
  expect(first.results.map((entry) => entry.metrics.money)).toEqual([3, 3, 3]);
  expect(first.results.map((entry) => entry.seed)).toEqual([0, 1, 2].map((index) => logicalDrawSeed(0x7113, index)));

  const binding = createRunFactory(registries).bind(scenario, isolation);
  try {
    const reversed = [2, 0, 1].map((drawIndex) => {
      const seed = logicalDrawSeed(0x7113, drawIndex);
      const opened = binding.fresh({ trialId: logicalDrawId(drawIndex), seed });
      const result = runScenario(opened.scenario);
      return { drawIndex, seed: opened.seed, money: result.end.wallet.money.amount };
    });
    expect(reversed.map((entry) => entry.money)).toEqual([3, 3, 3]);
    for (const entry of reversed) {
      expect(first.results[entry.drawIndex]?.seed).toBe(entry.seed);
      expect(first.results[entry.drawIndex]?.metrics.money).toBe(entry.money);
    }
  } finally {
    binding.release();
  }
}

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-empirical-drop The seeded drop rate stays inside the fixture tolerance, and a constant series has variance 0.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-empirical-drop #466e88b Re-read the section, then ran this function: the absolute gap is within 0.005 and the constant series is zero variance.
 * @evidence ./distribution.ts#distributionEmpiricalDrop Reads the empirical drop contract.
 * @evidenceReview ./distribution.ts#distributionEmpiricalDrop #240092f The declaration is seeded-bernoulli-tolerance.
 * @evidence ./distribution.ts#independentBernoulli Draws the seeded drop for each logical draw.
 * @evidenceReview ./distribution.ts#independentBernoulli #f10ffa3 The function rejects a probability outside [0, 1] and compares one mulberry32 uniform from the logical draw seed.
 */
export function checksSeededDropAndZeroVariance(): void {
  expect(distributionEmpiricalDrop).toBe("seeded-bernoulli-tolerance");
  expect(dropFixture.id).toBe("independent-drop-one-percent");
  expect(dropFixture.absoluteTolerance).toBe(0.005);
  let hits = 0;
  for (let drawIndex = 0; drawIndex < dropFixture.draws; drawIndex += 1) {
    if (independentBernoulli(dropFixture.seed, drawIndex, dropFixture.probability)) hits += 1;
  }
  const rate = hits / dropFixture.draws;
  expect(Math.abs(rate - dropFixture.probability)).toBeLessThanOrEqual(dropFixture.absoluteTolerance);

  const constant = analyzeDistribution({
    samples: [0, 1, 2, 3, 4].map((drawIndex) => sample(drawIndex, "observed", "5")),
    quantiles: [0.5],
    horizonSec: 5,
  });
  expect(constant.uncertainty.zeroVariance).toBe(true);
  expect(constant.uncertainty.variance).toBe(0);
  expect(constant.status).toBe("ok");
  expect(constant.uncertainty.source).toBe("model-strategy-session");

  const monetized = analyzeDistribution({
    samples: [sample(0, "observed", "5", "monetization"), sample(1, "observed", "7", "monetization")],
    quantiles: [0.5],
  });
  expect(monetized.uncertainty.source).toBe("monetization");
  expect(monetized.uncertainty.zeroVariance).toBe(false);
}

/**
 * @evidence docs/requirements/active/simulation-distribution.md#req-pr13-mean-identity Log-space means stay in their own slots, and a missing first visible change is censored.
 * @evidenceReview docs/requirements/active/simulation-distribution.md#req-pr13-mean-identity #5fa6bcc Re-read the section, then ran this function: mean of log10 is 2, and an absent change does not become 30 or 0.
 * @evidence ./distribution.ts#distributionMeanIdentity Reads the mean identity contract.
 * @evidenceReview ./distribution.ts#distributionMeanIdentity #b0d53fa The declaration is arithmetic-mean-log-and-log-mean.
 * @evidence ./distribution.ts#firstVisibleDistributionSample Censors a missing first visible change.
 * @evidenceReview ./distribution.ts#firstVisibleDistributionSample #d243eb8 The function validates the draw and seed, returns a censored sample for a missing change, a failed sample for a non-finite or negative time, and an observed value otherwise.
 */
export function separatesMeansAndCensorsMissingVisibleChange(): void {
  expect(distributionMeanIdentity).toBe("arithmetic-mean-log-and-log-mean");
  const report = analyzeDistribution({
    samples: [sample(0, "observed", "10"), sample(1, "observed", "1000")],
    quantiles: [0.5],
    horizonSec: 1000,
  });
  expect(report.means.arithmetic).toEqual({ label: "arithmetic-mean", status: "observed", value: "505" });
  expect(report.means.meanLog10).toEqual({ label: "mean-of-log10", status: "observed", value: "2" });
  expect(report.means.log10OfMean.label).toBe("log10-of-arithmetic-mean");
  expect(report.means.log10OfMean.value).not.toBe("2");
  expect(report.means.log10OfMean.value).not.toBe(report.means.arithmetic.value);
  expect(report.means.meanLog10.value).not.toBe(report.means.arithmetic.value);

  const missing = firstVisibleDistributionSample({ drawIndex: 0, seed: 1, firstVisibleChangeSec: undefined });
  expect(missing.status).toBe("censored");
  expect(missing.value).toBeNull();
  expect(missing.value).not.toBe("30");
  expect(missing.value).not.toBe("0");
  // Seconds since the session start cannot be negative, so a negative time is a failed sample.
  expect(firstVisibleDistributionSample({ drawIndex: 2, seed: 3, firstVisibleChangeSec: -1 }).status).toBe("failed");
  const seen = firstVisibleDistributionSample({ drawIndex: 1, seed: 2, firstVisibleChangeSec: 12 });
  expect(seen).toEqual({
    drawIndex: 1,
    seed: 2,
    status: "observed",
    value: "12",
    source: "model-strategy-session",
  });
}

describe("simulation distribution", () => {
  it("separates censored samples from the population quantile", separatesCensoringFromObservedQuantiles);
  it("fixes quantile ranks, bounds, and canonical keys", fixesQuantileRanksAndKeys);
  it("keeps logical draws independent of call order", keepsLogicalDrawsIndependentOfOrder);
  it("checks a seeded drop inside tolerance and zero variance", checksSeededDropAndZeroVariance);
  it("separates log means and censors a missing visible change", separatesMeansAndCensorsMissingVisibleChange);
});
