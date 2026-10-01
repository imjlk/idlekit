import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "bun:test";
import { type Decimal, createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import type { SimContext, SimState } from "../types";
import {
  analysisArtifactContract,
  analysisArtifactJson,
  analysisAlgorithmVersion,
  analysisArtifactJsonSchema,
  analysisCanonicalJson,
  analysisSchemaHash,
  analysisSchemaId,
  artifactProvenance,
  classifyAmount,
  classifyFinite,
  customMetricRegistration,
  parseAnalysisArtifact,
  renderAnalysisMarkdown,
  sharedGoalEvaluation,
  unavailableReading,
  validateAnalysisArtifact,
  validateAnalysisSemantics,
  type AnalysisArtifactV1,
} from "./contracts";
import {
  buildAnalysisArtifact,
  evaluateGoalForCheck,
  evaluateGoalForEta,
  evaluateGoalForExperiment,
  finiteValueMetric,
  milestoneReached,
  moneyAtLeast,
  netWorthAtLeast,
  netWorthMetric,
  prestigePointsAtLeast,
  prestigePointsMetric,
  readMetric,
  walletMoneyMetric,
} from "./metrics";
import { createModelAnalysisRegistry, flowResult, resetResult } from "./registry";

type Coin = "COIN";
type Vars = { owned: number };
type GemVars = { gems: number };

function state(amount: number, owned = 0, points = 0): SimState<number, Coin, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points, multiplier: 1 },
    vars: { owned },
  };
}

function ctx(engine = createNumberEngine()): SimContext<number, Coin, Vars> {
  return { E: engine, unit: { code: "COIN" }, tickPolicy: { mode: "drop" } };
}

function agree<T extends { reached?: boolean; status: string; goalId: string }>(goal: Parameters<typeof evaluateGoalForEta<number, Coin, Vars>>[0], current: SimState<number, Coin, Vars>) {
  const context = ctx();
  const eta = evaluateGoalForEta(goal, current, context);
  const experiment = evaluateGoalForExperiment(goal, current, context);
  const check = evaluateGoalForCheck(goal, current, context);
  expect(eta.reached).toBe(experiment.reached);
  expect(eta.reached).toBe(check.reached);
  expect(eta.status).toBe(experiment.status);
  expect(eta.status).toBe(check.status);
  expect(eta.goalId).toBe(check.goalId);
  if (eta.status === "ok") {
    expect(eta.method).toBe("fixed-step");
    expect(experiment.method).toBe("monte-carlo");
    expect(check.method).toBe("exact");
  } else {
    expect(eta.method).toBeUndefined();
    expect(experiment.method).toBeUndefined();
    expect(check.method).toBeUndefined();
  }
  return { eta, experiment, check };
}

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-shared-goal The three adapters agree on money, net worth, prestige points, and a milestone.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-shared-goal #89fb124 Re-read the section, then compared the three reached values.
 * @evidence ./contracts.ts#sharedGoalEvaluation Reads the shared evaluation id.
 * @evidenceReview ./contracts.ts#sharedGoalEvaluation #f20c0db The declaration is eta-experiment-check.
 */
export function sharesDefaultGoalEvaluation(): void {
  expect(sharedGoalEvaluation).toBe("eta-experiment-check");
  const current = state(10, 2, 5);
  const context = ctx();
  const money = agree(moneyAtLeast<number, Coin, Vars>("10"), current);
  expect(money.eta.reached).toBe(true);
  expect(agree(moneyAtLeast<number, Coin, Vars>("11"), current).eta.reached).toBe(false);

  const worth = (_state: SimState<number, Coin, Vars>) => current.wallet.money.amount + current.vars.owned * 100;
  const net = agree(
    netWorthAtLeast<number, Coin, Vars>({
      target: "200",
      netWorth: (next) => worth(next),
    }),
    current,
  );
  expect(net.eta.reached).toBe(true);
  expect(net.eta.assumptions).toEqual([]);
  const missing = agree(
    netWorthAtLeast<number, Coin, Vars>({
      target: "1",
      netWorth: () => undefined,
    }),
    current,
  );
  expect(missing.eta.status).toBe("unsupported");
  expect(missing.eta.reached).toBeUndefined();
  expect(JSON.stringify(missing.eta)).not.toContain("stable");

  expect(agree(prestigePointsAtLeast<number, Coin, Vars>("5"), current).eta.reached).toBe(true);
  expect(agree(prestigePointsAtLeast<number, Coin, Vars>("6"), current).eta.reached).toBe(false);
  expect(agree(milestoneReached<number, Coin, Vars>({ key: "first", seen: ["first"] }), current).eta.reached).toBe(true);
  expect(agree(milestoneReached<number, Coin, Vars>({ key: "later", seen: ["first"] }), current).eta.reached).toBe(false);

  const moneyReading = readMetric(walletMoneyMetric<number, Coin, Vars>(), context, current);
  const worthReading = readMetric(
    netWorthMetric<number, Coin, Vars>((_ctx, next) => ({
      amount: next.wallet.money.amount + next.vars.owned * 100,
      unit: next.wallet.money.unit.code,
    })),
    context,
    current,
  );
  expect(moneyReading.reading).toBe("observed");
  expect(moneyReading.amount?.decimal).toBe("10");
  expect(worthReading.amount?.decimal).toBe("210");
  expect(readMetric(prestigePointsMetric<number, Coin, Vars>(), context, current).amount?.unit).toBe("prestige.points");
}

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-custom-metric A caller registers another unit, vars field, and metric id. Flow and reset stay unsupported.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-custom-metric #9564912 Re-read the section: the fixture id is not a core resource name, and unsupported has no score.
 * @evidence ./contracts.ts#customMetricRegistration Reads the registry contract id.
 * @evidenceReview ./contracts.ts#customMetricRegistration #8a93c53 The declaration is model-analysis-registry.
 */
export function registersCustomMetric(): void {
  expect(customMetricRegistration).toBe("model-analysis-registry");
  const source = readFileSync(join(import.meta.dir, "metrics.ts"), "utf8");
  expect(source).not.toContain("gems");
  const registry = createModelAnalysisRegistry<number, "GEM", GemVars>();
  registry.register({
    modelId: "gem-shop",
    modelVersion: 1,
    capabilities: { metrics: "statically-known", goals: "statically-known" },
    metrics: [
      finiteValueMetric({
        id: "gems.held",
        meaning: "Gems held by the caller",
        domain: "count",
        read: (_ctx, next) => next.vars.gems,
      }),
    ],
    goals: [
      {
        id: "gems.atLeast",
        version: 1,
        observation: "custom",
        timeResolution: "step",
        met: (next) => next.vars.gems >= 3,
      },
    ],
  });
  const adapter = registry.get("gem-shop", 1);
  expect(adapter?.metrics?.[0]?.id).toBe("gems.held");
  expect(registry.knowledge("gem-shop", 1, "metrics")).toBe("statically-known");
  expect(registry.knowledge("gem-shop", 1, "flow")).toBe("unsupported");
  expect(registry.knowledge("gem-shop", 1, "reset")).toBe("unsupported");
  expect(registry.knowledge("missing", 1, "flow")).toBe("unknown");
  const flow = flowResult("unsupported");
  const reset = resetResult("unsupported");
  expect(flow.status).toBe("unsupported");
  expect(reset.status).toBe("unsupported");
  expect(JSON.stringify(flow)).not.toContain("0");
  expect(JSON.stringify(flow)).not.toContain("stable");
  expect("value" in flow).toBe(false);
  const gemState: SimState<number, "GEM", GemVars> = {
    t: 0,
    wallet: { money: { unit: { code: "GEM" }, amount: 0 }, bucket: 0 },
    maxMoneyEver: { unit: { code: "GEM" }, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { gems: 4 },
  };
  const gemCtx: SimContext<number, "GEM", GemVars> = {
    E: createNumberEngine(),
    unit: { code: "GEM" },
    tickPolicy: { mode: "drop" },
  };
  const reading = readMetric(adapter!.metrics![0]!, gemCtx, gemState);
  expect(reading.value).toBe(4);
  expect(reading.amount).toBeUndefined();
  const goal = adapter!.goals![0]!;
  expect(evaluateGoalForCheck(goal, gemState, gemCtx).reached).toBe(true);
}

/**
 * @evidence docs/requirements/active/analysis-contracts.md#req-pr08-analysis-artifact Decimal strings, nonfinite readings, and provenance survive a schema round-trip.
 * @evidenceReview docs/requirements/active/analysis-contracts.md#req-pr08-analysis-artifact #5f4c544 Re-read the section: 1e400 stays a string, and a missing sample is omitted.
 * @evidence ./contracts.ts#analysisArtifactContract Reads the artifact contract id.
 * @evidenceReview ./contracts.ts#analysisArtifactContract #b110251 The declaration is idlekit.analysis.artifact.v1.
 * @evidence ./contracts.ts#validateAnalysisArtifact Runs the generated artifact validator.
 * @evidenceReview ./contracts.ts#validateAnalysisArtifact #8dea21b The arrow builds typia.createValidate of AnalysisArtifactV1 on first call and reuses it.
 * @evidence ./contracts.ts#analysisArtifactJsonSchema Reads the generated OpenAPI 3.1 schema object twice.
 * @evidenceReview ./contracts.ts#analysisArtifactJsonSchema #c080fe4 The function memoizes typia.json.schema of AnalysisArtifactV1, so both reads return the same 3.1 object.
 * @evidence ./contracts.ts#analysisSchemaId Reads the artifact schema id.
 * @evidenceReview ./contracts.ts#analysisSchemaId #7d586c3 The function returns the analysis.artifact.v1 schema URL constant.
 * @evidence ./contracts.ts#analysisAlgorithmVersion Reads the default algorithm version that buildAnalysisArtifact stamps.
 * @evidenceReview ./contracts.ts#analysisAlgorithmVersion #8bed2c5 The function returns the analysis-artifact-v1 constant.
 * @evidence ./contracts.ts#parseAnalysisArtifact Parses the rendered artifact JSON.
 * @evidenceReview ./contracts.ts#parseAnalysisArtifact #b7b8a89 The function is typia.json.validateParse of AnalysisArtifactV1.
 * @evidence ./contracts.ts#analysisCanonicalJson Compares the parsed artifact with the rendered text.
 * @evidenceReview ./contracts.ts#analysisCanonicalJson #4f8ccf4 The function delegates to renderCanonical, which sorts keys and drops undefined entries.
 * @evidence ./contracts.ts#analysisArtifactJson Renders the artifact as canonical JSON text.
 * @evidenceReview ./contracts.ts#analysisArtifactJson #52695d2 The function appends a newline to analysisCanonicalJson of the artifact.
 * @evidence ./contracts.ts#validateAnalysisSemantics Accepts the fixture and rejects an unavailable reading that carries a value.
 * @evidenceReview ./contracts.ts#validateAnalysisSemantics #21ef7c1 The function reports unavailable readings with values, missing ok values, nonfinite values, and reached on unreached goals.
 * @evidence ./contracts.ts#analysisSchemaHash Hashes the generated schema for provenance.
 * @evidenceReview ./contracts.ts#analysisSchemaHash #0ec17bb The function hashes the canonical JSON of the memoized artifact schema.
 * @evidence ./contracts.ts#artifactProvenance Changes provenance with assumptions, algorithm, and schema, and not with the run hash.
 * @evidenceReview ./contracts.ts#artifactProvenance #689a3a5 The function hashes the algorithm version, the assumption hash, and the schema hash only.
 * @evidence ./contracts.ts#classifyAmount Classifies negative, zero, and nonfinite amounts directly and through readMetric.
 * @evidenceReview ./contracts.ts#classifyAmount #3f6b4bb The function returns invalid nonfinite for a nonfinite amount and a signed decimal otherwise.
 * @evidence ./contracts.ts#classifyFinite Classifies NaN, negative, and positive numbers.
 * @evidenceReview ./contracts.ts#classifyFinite #ed723f0 The function returns invalid nonfinite with a nan or infinity reason, and a signed value otherwise.
 * @evidence ./contracts.ts#unavailableReading Builds unknown and censored readings without a value.
 * @evidenceReview ./contracts.ts#unavailableReading #9f1f861 The function copies the metric fields, sets reading unavailable, and adds reason only when given.
 * @evidence ./contracts.ts#renderAnalysisMarkdown Renders the fixture and an artifact without sampleCount.
 * @evidenceReview ./contracts.ts#renderAnalysisMarkdown #102dd42 The function prints samples only when sampleCount is present and prints decimals as wire strings.
 */
export function roundTripsAnalysisArtifact(): void {
  expect(analysisArtifactContract).toBe("idlekit.analysis.artifact.v1");
  const bigEngine = createBreakInfinityEngine();
  const huge = bigEngine.from("1e400");
  const bigState: SimState<Decimal, Coin, Vars> = {
    t: 1,
    wallet: { money: { unit: { code: "COIN" }, amount: huge }, bucket: bigEngine.zero() },
    maxMoneyEver: { unit: { code: "COIN" }, amount: huge },
    prestige: { count: 0, points: bigEngine.zero(), multiplier: bigEngine.from(1) },
    vars: { owned: 0 },
  };
  const bigCtx: SimContext<Decimal, Coin, Vars> = {
    E: bigEngine,
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
  };
  const hugeReading = readMetric(walletMoneyMetric<Decimal, Coin, Vars>(), bigCtx, bigState);
  expect(hugeReading.amount?.decimal).toBe(bigEngine.toString(huge));
  expect(Number(hugeReading.amount?.decimal)).not.toBeFinite();
  expect(hugeReading.amount?.decimal).not.toBe("Infinity");
  expect(bigEngine.cmp(bigEngine.from(hugeReading.amount!.decimal), huge)).toBe(0);

  const numberCtx = ctx();
  const negative = readMetric(walletMoneyMetric<number, Coin, Vars>(), numberCtx, state(-3));
  const zero = readMetric(walletMoneyMetric<number, Coin, Vars>(), numberCtx, state(0));
  const infinite = readMetric(walletMoneyMetric<number, Coin, Vars>(), numberCtx, state(Number.POSITIVE_INFINITY));
  expect(negative.sign).toBe("negative");
  expect(negative.amount?.decimal).toBe("-3");
  expect(zero.sign).toBe("zero");
  expect(zero.amount?.decimal).toBe("0");
  expect(infinite.status).toBe("invalid");
  expect(infinite.sign).toBe("nonfinite");
  expect(infinite.amount).toBeUndefined();
  expect(infinite.value).toBeUndefined();

  const unknown = unavailableReading({
    metricId: "money",
    metricVersion: 1,
    meaning: "Current wallet amount",
    metricKind: "stock",
    timeAxis: "instant",
    domain: "amount",
    status: "unknown",
    reason: "not observed",
  });
  const censored = unavailableReading({
    metricId: "money",
    metricVersion: 1,
    meaning: "Current wallet amount",
    metricKind: "stock",
    timeAxis: "instant",
    domain: "amount",
    status: "censored",
    reason: "withheld",
  });
  const artifact = buildAnalysisArtifact({
    assumptions: ["literal fixture"],
    warnings: ["no run"],
    observationCoverage: "complete",
    effectiveRunHash: "abc",
    metrics: [hugeReading, negative, zero, infinite, unknown, censored],
    goals: [evaluateGoalForCheck(moneyAtLeast<number, Coin, Vars>("1"), state(1), numberCtx)],
    capabilities: {
      metrics: "statically-known",
      goals: "statically-known",
      reset: "unsupported",
      flow: "unsupported",
      advance: "unsupported",
    },
  });
  expect(artifact.sampleCount).toBeUndefined();
  expect(JSON.stringify(artifact)).not.toContain('"sampleCount"');
  const explicitZero = buildAnalysisArtifact({ sampleCount: 0 });
  expect(explicitZero.sampleCount).toBe(0);

  const json = analysisArtifactJson(artifact);
  const parsed = parseAnalysisArtifact(json);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  expect(analysisCanonicalJson(parsed.data)).toBe(json.trim());
  expect(validateAnalysisArtifact(parsed.data).success).toBe(true);
  expect(validateAnalysisSemantics(parsed.data)).toEqual([]);
  const bad: AnalysisArtifactV1 = {
    ...artifact,
    metrics: [{ ...unknown, value: 0 }],
  };
  expect(validateAnalysisSemantics(bad).length).toBeGreaterThan(0);

  expect(analysisArtifactJsonSchema().version).toBe("3.1");
  expect(analysisSchemaId()).toBe("https://idlekit.dev/schemas/analysis.artifact.v1.schema.json");
  expect(analysisAlgorithmVersion()).toBe("analysis-artifact-v1");
  expect(artifact.algorithmVersion).toBe(analysisAlgorithmVersion());
  const numberEngine = createNumberEngine();
  expect(classifyAmount(numberEngine, -3, "COIN")).toEqual({
    status: "ok",
    sign: "negative",
    amount: { unit: "COIN", decimal: "-3" },
  });
  expect(classifyAmount(numberEngine, Number.POSITIVE_INFINITY, "COIN")).toEqual({
    status: "invalid",
    sign: "nonfinite",
    reason: "infinity",
  });
  expect(classifyFinite(Number.NaN)).toEqual({ status: "invalid", sign: "nonfinite", reason: "nan" });
  expect(classifyFinite(-1)).toEqual({ status: "ok", sign: "negative", value: -1 });
  expect(classifyFinite(2)).toEqual({ status: "ok", sign: "positive", value: 2 });
  expect(analysisArtifactJsonSchema()).toBe(analysisArtifactJsonSchema());
  const schemaHash = analysisSchemaHash();
  const first = artifactProvenance(artifact, schemaHash);
  const changedAssumption = artifactProvenance({ ...artifact, assumptions: ["other"] }, schemaHash);
  const changedAlgorithm = artifactProvenance({ ...artifact, algorithmVersion: "analysis-artifact-v1.1" }, schemaHash);
  const changedSchema = artifactProvenance(artifact, `${schemaHash}ff`);
  const changedRun = artifactProvenance({ ...artifact, effectiveRunHash: "zzz" } as AnalysisArtifactV1, schemaHash);
  expect(changedAssumption.provenance).not.toBe(first.provenance);
  expect(changedAlgorithm.provenance).not.toBe(first.provenance);
  expect(changedSchema.provenance).not.toBe(first.provenance);
  expect(changedRun.provenance).toBe(first.provenance);
  expect(first.algorithmVersion).toBe(artifact.algorithmVersion);

  const markdown = renderAnalysisMarkdown(artifact);
  expect(markdown).toContain("analysis-artifact-v1");
  expect(markdown).toContain(hugeReading.amount?.decimal ?? "");
  expect(markdown).not.toContain("자주");
  const omitted = renderAnalysisMarkdown(buildAnalysisArtifact());
  expect(omitted).not.toContain("Samples:");
}
describe("PR-08 analysis contracts", () => {
  it("shares one goal evaluation", sharesDefaultGoalEvaluation);
  it("registers a custom metric", registersCustomMetric);
  it("round-trips the analysis artifact", roundTripsAnalysisArtifact);
});
