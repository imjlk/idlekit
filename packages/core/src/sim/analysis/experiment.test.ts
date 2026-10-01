import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createNumberEngine } from "../../engine/breakInfinity";
import { createModelRegistry, defineModelFactory } from "../../scenario/registry";
import { canonicalJson, sha256Text } from "../../scenario/scenarioContract";
import { zodStandardSchema } from "../../scenario/validate";
import { createObjectiveRegistry } from "../strategy/opt/registry";
import { runCandidateAndScore } from "../strategy/opt/runner";
import { validateTuneSpecV1 } from "../strategy/opt/validate";
import { createStrategyRegistry, type StrategyFactory } from "../strategy/registry";
import type { CompiledScenario, SimState } from "../types";
import {
  assertRegisteredPath,
  experimentAlgorithmVersion,
  experimentCandidateOrder,
  experimentEstimatorVersion,
  experimentCensoredHorizon,
  experimentLocalOat,
  experimentParetoUnknown,
  experimentRegisteredSetter,
  experimentSchemaId,
  experimentJsonSchema,
  experimentSeparateSpec,
  experimentTaskDescriptor,
  runExperiment,
  setRegisteredParam,
  validateExperimentArtifact,
  validateExperimentSpec,
  type ExperimentArtifactV1,
  type ExperimentSpecV1,
} from "./experiment";
import { localElasticity } from "./sensitivity";

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../../../fixtures/conformance/parameter-experiment.json"), "utf8"),
) as {
  id: string;
  seed: number;
  goalTarget: number;
  horizonSec: number;
  censoredHorizonSec: number;
  stepSec: number;
  incomeBaseline: number;
  incomeProbes: number[];
  policyBaseline: number;
  policyProbe: number;
  sessionPattern: string;
  sessionDays: number;
  modelId: string;
  modelVersion: number;
  strategyId: string;
};

const unit = { code: "COIN" as const };

function incomeFactory(creates: { count: number }) {
  return defineModelFactory({
    id: fixture.modelId,
    version: fixture.modelVersion,
    paramsSchema: zodStandardSchema(z.object({ incomeRate: z.number().positive() })),
    create(params: { incomeRate: number }) {
      creates.count += 1;
      return {
        id: fixture.modelId,
        version: fixture.modelVersion,
        income: () => ({ unit, amount: params.incomeRate }),
        actions: () => [],
      };
    },
  });
}

function policyFactory(): StrategyFactory {
  return {
    id: fixture.strategyId,
    paramsSchema: zodStandardSchema(z.object({ maxPicks: z.number().int().min(1).max(3) })),
    create: (params: { maxPicks: number }) => ({
      id: fixture.strategyId,
      decide: () => {
        void params.maxPicks;
        return [];
      },
    }),
  };
}

function specFor(scenario: unknown, patch: Partial<ExperimentSpecV1> = {}): ExperimentSpecV1 {
  const spec: { -readonly [K in keyof ExperimentSpecV1]: ExperimentSpecV1[K] } = {
    schemaVersion: 1,
    scenario: { ref: "fixtures/conformance/parameter-experiment.json", hash: sha256Text(canonicalJson(scenario)) },
    model: { id: fixture.modelId, version: fixture.modelVersion },
    strategy: { id: fixture.strategyId },
    metricId: "timeToMoney",
    goal: { target: fixture.goalTarget },
    dimensions: [
      {
        id: "incomeRate",
        target: "model",
        path: "incomeRate",
        space: { kind: "number", min: 0.1, max: 5 },
        baseline: fixture.incomeBaseline,
        probes: fixture.incomeProbes,
      },
      {
        id: "maxPicks",
        target: "strategy",
        path: "maxPicks",
        space: { kind: "int", min: 1, max: 3 },
        baseline: fixture.policyBaseline,
        probes: [fixture.policyProbe],
      },
    ],
    budget: { candidates: 8, seeds: 2 },
    seeds: [fixture.seed],
    horizonSec: fixture.horizonSec,
    stepSec: fixture.stepSec,
    session: { pattern: fixture.sessionPattern, days: fixture.sessionDays },
    ...patch,
  };
  spec.scenario = patch.scenario ?? {
    ref: "fixtures/conformance/parameter-experiment.json",
    hash: sha256Text(canonicalJson(scenario)),
  };
  for (const key of Object.keys(spec) as (keyof ExperimentSpecV1)[]) {
    if (spec[key] === undefined) delete spec[key];
  }
  return spec;
}

function runWith(scenario: unknown, spec: ExperimentSpecV1, creates: { count: number } = { count: 0 }): ExperimentArtifactV1 {
  return runExperiment({
    spec,
    scenario,
    modelRegistry: createModelRegistry([incomeFactory(creates)]),
    strategyRegistry: createStrategyRegistry([policyFactory()]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "run-hash-pr14",
  });
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity Rate 2 and rate 0.5 move reach time in opposite directions, and the policy probe stays flat.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity #253b8c6 Re-read the section, then ran this function: elasticity is -0.5 and -2, and maxPicks elasticity is 0.
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor The income candidate and the policy candidate record different parameter JSON on the same logical seed.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #9da008d Re-read the section, then ran this function: incomeRate becomes 2 on one task and maxPicks becomes 2 on another.
 * @evidence ./experiment.ts#experimentLocalOat Reads the local method contract.
 * @evidenceReview ./experiment.ts#experimentLocalOat #1c1bffa The declaration is one-at-a-time-local-not-sobol.
 * @evidence ./experiment.ts#experimentTaskDescriptor Reads the task descriptor contract.
 * @evidenceReview ./experiment.ts#experimentTaskDescriptor #03898ac The declaration is task-id-params-seed-version.
 * @evidence ./experiment.ts#runExperiment Runs the sweep and local sensitivity on a fixed spec.
 * @evidenceReview ./experiment.ts#runExperiment #1429075 The function checks the scenario hash against the spec, rejects a timeToMoney metric without a finite goal, runs each planned candidate per seed through a fresh binding, and reports local sensitivity only for completed horizons.
 * @evidence ./experiment.ts#experimentSchemaId Reads the experiment schema id.
 * @evidenceReview ./experiment.ts#experimentSchemaId #637335e The function returns the experiment.v1 schema URL constant.
 * @evidence ./experiment.ts#experimentAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./experiment.ts#experimentAlgorithmVersion #c4bd42f The function returns the experiment-oat-v1 constant.
 * @evidence ./experiment.ts#experimentEstimatorVersion Reads the estimator version.
 * @evidenceReview ./experiment.ts#experimentEstimatorVersion #d9e9c35 The function returns the one-at-a-time-local-v1 constant.
 */
export function checksLocalElasticityDirection(): void {
  expect(experimentSchemaId()).toBe("https://idlekit.dev/schemas/experiment.v1.schema.json");
  expect(experimentAlgorithmVersion()).toBe("experiment-oat-v1");
  expect(experimentEstimatorVersion()).toBe("one-at-a-time-local-v1");
  expect(experimentLocalOat).toBe("one-at-a-time-local-not-sobol");
  expect(experimentTaskDescriptor).toBe("task-id-params-seed-version");
  expect(localElasticity({ baselineP: 0, probeP: 1, baselineY: 10, probeY: 12 })).toEqual({
    status: "unavailable",
    elasticity: null,
    absoluteChange: "2",
    direction: "higher",
    globalSensitivity: false,
    sobol: false,
  });
  const scenario = { id: fixture.id, incomeRate: 0, nested: { keep: true } };
  const before = JSON.stringify(scenario);
  const artifact = runWith(scenario, specFor(scenario));
  expect(JSON.stringify(scenario)).toBe(before);
  expect(artifact.globalSensitivity).toBe(false);
  expect(artifact.sobol).toBe(false);
  expect(artifact.method).toBe("fixed-sweep-and-one-at-a-time");
  expect(artifact.estimatorVersion).toBe("one-at-a-time-local-v1");
  expect(artifact.warnings.join(" ")).toContain("not a Sobol index");
  expect(artifact.warnings.join(" ")).not.toContain("weighted score is");
  const baseline = artifact.candidates.find((candidate) => candidate.id === "baseline");
  const faster = artifact.candidates.find((candidate) => candidate.id === "oat:incomeRate:2");
  const slower = artifact.candidates.find((candidate) => candidate.id === "oat:incomeRate:0.5");
  const policy = artifact.candidates.find((candidate) => candidate.id === "oat:maxPicks:2");
  expect(baseline?.metrics.find((metric) => metric.metricId === "timeToMoney")?.value).toBe("10");
  expect(faster?.metrics.find((metric) => metric.metricId === "timeToMoney")?.value).toBe("5");
  expect(slower?.metrics.find((metric) => metric.metricId === "timeToMoney")?.value).toBe("20");
  expect(policy?.metrics.find((metric) => metric.metricId === "timeToMoney")?.value).toBe("10");
  const byId = (id: string) => artifact.elasticities.find((row) => row.candidateId === id && row.metricId === "timeToMoney");
  expect(byId("oat:incomeRate:2")).toMatchObject({ status: "observed", elasticity: "-0.5", direction: "lower", globalSensitivity: false, sobol: false });
  expect(byId("oat:incomeRate:0.5")).toMatchObject({ status: "observed", elasticity: "-2", direction: "higher", globalSensitivity: false, sobol: false });
  expect(byId("oat:maxPicks:2")).toMatchObject({ status: "observed", elasticity: "0", direction: "flat", absoluteChange: "0" });
  const incomeTask = artifact.tasks.find((task) => task.candidateId === "oat:incomeRate:2");
  const policyTask = artifact.tasks.find((task) => task.candidateId === "oat:maxPicks:2");
  expect(incomeTask).toMatchObject({
    taskId: "oat:incomeRate:2#28948",
    logicalSeed: 28948,
    engineId: "number",
    engineVersion: "1",
    modelId: "constant-income",
    modelVersion: 1,
    strategyId: "pick-cap",
    modelParams: "{\"incomeRate\":2}",
    strategyParams: "{\"maxPicks\":1}",
    sessionPattern: "always-active",
    sessionDays: 1,
  });
  expect(policyTask?.modelParams).toBe("{\"incomeRate\":1}");
  expect(policyTask?.strategyParams).toBe("{\"maxPicks\":2}");
  expect(JSON.stringify(artifact)).not.toContain("weightedScore");
  expect(JSON.stringify(incomeTask)).not.toContain("function");
}

class Bag {
  counter = 0;
  bump(): void {
    this.counter += 1;
  }
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature The existing strategy tune still returns mean score 9.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature #365035c Re-read the section, then ran this function: seeds 7 and 11 still score 9.
 * @evidence ./experiment.ts#experimentSeparateSpec Reads the separate-spec contract.
 * @evidenceReview ./experiment.ts#experimentSeparateSpec #acf5c11 The declaration is experiment-spec-not-tunespec.
 * @evidence ./experiment.ts#validateExperimentArtifact The fixed report validates.
 * @evidenceReview ./experiment.ts#validateExperimentArtifact #79179a2 The arrow builds typia.createValidate of ExperimentArtifactV1 on first call and reuses it.
 * @evidence ./experiment.ts#experimentJsonSchema The schema is OpenAPI 3.1.
 * @evidenceReview ./experiment.ts#experimentJsonSchema #d93f32e The function memoizes typia.json.schema of ExperimentArtifactV1.
 * @evidence ./experiment.ts#validateExperimentSpec The spec validator rejects an empty object.
 * @evidenceReview ./experiment.ts#validateExperimentSpec #0b08b43 The arrow builds typia.createValidate of ExperimentSpecV1 on first call and reuses it.
 */
export function keepsStrategyTuneSignature(): void {
  expect(experimentSeparateSpec).toBe("experiment-spec-not-tunespec");
  expect(experimentJsonSchema().version).toBe("3.1");
  expect(validateExperimentSpec({}).success).toBe(false);
  expect(validateExperimentArtifact({}).success).toBe(false);
  const tune = validateTuneSpecV1({
    schemaVersion: 1,
    strategy: { id: "s", space: [{ path: "limit", space: { kind: "int", min: 1, max: 3 } }] },
    objective: { id: "obj.seed" },
    runner: { seeds: [7, 11], budget: 2 },
  });
  expect(tune.ok).toBe(true);
  expect(tune.tuneSpec?.strategy.space).toHaveLength(1);
  const engine = createNumberEngine();
  const scenario: CompiledScenario<number, "COIN", Bag> = {
    ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: { id: "m", version: 1, income: () => ({ unit, amount: 0 }), actions: () => [] },
    initial: {
      t: 0,
      wallet: { money: { unit, amount: 0 }, bucket: 0 },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: new Bag(),
    },
    run: { stepSec: 1, durationSec: 1 },
  };
  const scored = runCandidateAndScore({
    baseScenario: scenario,
    params: {},
    strategyId: "s",
    objectiveId: "obj.seed",
    seeds: [7, 11],
    strategyRegistry: createStrategyRegistry([
      { id: "s", create: () => ({ id: "s", decide: () => [] }) },
    ]),
    objectiveRegistry: createObjectiveRegistry([
      { id: "obj.seed", create: () => ({ id: "obj.seed", score: ({ scenario: sc }) => Number(sc.ctx.seed ?? -1) }) },
    ]),
  });
  expect(scored.seedScores).toEqual([7, 11]);
  expect(scored.score).toBe(9);
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter Unsafe paths and invalid parameters throw before the model factory runs.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter #a9ad2ba Re-read the section, then ran this function: create count stays 0.
 * @evidence ./experiment.ts#experimentRegisteredSetter Reads the setter contract.
 * @evidenceReview ./experiment.ts#experimentRegisteredSetter #080a763 The declaration is registered-key-not-jsonpath.
 * @evidence ./experiment.ts#assertRegisteredPath Rejects prototype, bracket, and traversal paths, and session paths other than pattern or days.
 * @evidenceReview ./experiment.ts#assertRegisteredPath #7465c3e The function splits a trimmed dotted identifier path and rejects empty, bracketed, traversing, or banned segments, and session paths other than pattern or days.
 * @evidence ./experiment.ts#setRegisteredParam Sets a nested model parameter on a copy.
 * @evidenceReview ./experiment.ts#setRegisteredParam #2ac17d5 The function validates the path, deep-copies the root through JSON, creates missing objects, and sets the leaf without changing the input.
 */
export function rejectsUnsafeParametersBeforeRun(): void {
  const safePath = "income.rate";
  expect(assertRegisteredPath(safePath, "model")).toEqual(["income", "rate"]);
  for (const path of ["__proto__.x", "a..b", "a[0]", "a/b", " a"]) {
    expect(() => assertRegisteredPath(path, "model")).toThrow();
  }
  const sessionPath = "speed";
  expect(() => assertRegisteredPath(sessionPath, "session")).toThrow();
  const root = { income: { rate: 1 } };
  expect(setRegisteredParam(root, "income.bonus", 2)).toEqual({ income: { rate: 1, bonus: 2 } });
  expect(root).toEqual({ income: { rate: 1 } });
  expect(experimentRegisteredSetter).toBe("registered-key-not-jsonpath");
  const scenario = { id: "reject" };
  const creates = { count: 0 };
  const cases: ExperimentSpecV1[] = [
    specFor(scenario, {
      dimensions: [
        { id: "bad", target: "model", path: "__proto__.incomeRate", space: { kind: "number", min: 0.1, max: 5 }, baseline: 1 },
      ],
    }),
    specFor(scenario, {
      dimensions: [
        { id: "slot", target: "model", path: "income[0]", space: { kind: "number", min: 0.1, max: 5 }, baseline: 1 },
      ],
    }),
    specFor(scenario, {
      dimensions: [
        {
          id: "maxPicks",
          target: "strategy",
          path: "maxPicks",
          space: { kind: "int", min: 1, max: 3 },
          baseline: 9,
        },
      ],
    }),
    specFor(scenario, {
      dimensions: [
        {
          id: "incomeRate",
          target: "model",
          path: "incomeRate",
          space: { kind: "number", min: -5, max: 5 },
          baseline: -1,
        },
      ],
    }),
  ];
  for (const spec of cases) {
    expect(() => runWith(scenario, spec, creates)).toThrow();
  }
  expect(creates.count).toBe(0);
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order Reversed candidates keep the same report and leave the scenario JSON unchanged.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order #b77cabc Re-read the section, then ran this function: effective hashes match and incomeRate on the scenario stays 0.
 * @evidence ./experiment.ts#experimentCandidateOrder Reads the order contract.
 * @evidenceReview ./experiment.ts#experimentCandidateOrder #b4dbc98 The declaration is sorted-candidates-unmutated-scenario.
 */
export function keepsCandidateOrderAndScenario(): void {
  expect(experimentCandidateOrder).toBe("sorted-candidates-unmutated-scenario");
  const scenario = { id: "order", incomeRate: 0 };
  const before = JSON.stringify(scenario);
  const dimensions = [
    {
      id: "incomeRate",
      target: "model" as const,
      path: "incomeRate",
      space: { kind: "number" as const, min: 0.1, max: 5 },
      baseline: 1,
    },
  ];
  const forward = specFor(scenario, {
    strategy: undefined,
    dimensions,
    candidates: [
      { id: "b", assignments: [{ dimensionId: "incomeRate", value: 2 }] },
      { id: "a", assignments: [{ dimensionId: "incomeRate", value: 1 }] },
    ],
    budget: { candidates: 2, seeds: 1 },
  });
  const reversed = specFor(scenario, {
    strategy: undefined,
    dimensions,
    candidates: [
      { id: "a", assignments: [{ dimensionId: "incomeRate", value: 1 }] },
      { id: "b", assignments: [{ dimensionId: "incomeRate", value: 2 }] },
    ],
    budget: { candidates: 2, seeds: 1 },
  });
  const creates = { count: 0 };
  const first = runWith(scenario, forward, creates);
  const second = runWith(scenario, reversed, creates);
  expect(JSON.stringify(scenario)).toBe(before);
  expect(creates.count).toBe(4);
  expect(first.effectiveSpecHash).toBe(second.effectiveSpecHash);
  expect(first.originalSpecHash).not.toBe(second.originalSpecHash);
  expect(first.candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  const rest = (artifact: ExperimentArtifactV1) => ({ ...artifact, originalSpecHash: "omitted" });
  expect(rest(first)).toEqual(rest(second));
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon Horizon 9 does not become the reach time of an unmet target 10.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon #988285f Re-read the section, then ran this function: the censored value is null and elasticity is unavailable.
 * @evidence ./experiment.ts#experimentCensoredHorizon Reads the censor contract.
 * @evidenceReview ./experiment.ts#experimentCensoredHorizon #81f017f The declaration is censored-time-not-horizon.
 */
export function skipsCensoredHorizonForSensitivity(): void {
  expect(experimentCensoredHorizon).toBe("censored-time-not-horizon");
  const scenario = { id: "censor" };
  const artifact = runWith(
    scenario,
    specFor(scenario, {
      horizonSec: fixture.censoredHorizonSec,
      dimensions: [
        {
          id: "incomeRate",
          target: "model",
          path: "incomeRate",
          space: { kind: "number", min: 0.1, max: 5 },
          baseline: 1,
          probes: [2],
        },
      ],
      strategy: undefined,
      budget: { candidates: 2, seeds: 1 },
    }),
  );
  const baseline = artifact.tasks.find((task) => task.candidateId === "baseline");
  const faster = artifact.tasks.find((task) => task.candidateId === "oat:incomeRate:2");
  expect(baseline).toMatchObject({ status: "censored", value: null, horizonSec: 9 });
  expect(baseline?.value).not.toBe("9");
  expect(faster?.value).toBe("5");
  expect(artifact.elasticities[0]).toMatchObject({
    status: "unavailable",
    elasticity: null,
    absoluteChange: null,
    direction: "unavailable",
  });
  expect(JSON.stringify(artifact.elasticities)).not.toContain("\"9\"");
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown The hand tradeoff keeps A, B, and C, drops D, and leaves E uncompared.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown #b316c8c Re-read the section, then ran this function: nonDominated is A, B, C and E is uncompared.
 * @evidence ./experiment.ts#experimentParetoUnknown Reads the Pareto contract.
 * @evidenceReview ./experiment.ts#experimentParetoUnknown #4c62a0c The declaration is unknown-is-not-superior.
 */
export function matchesHandPareto(): void {
  expect(experimentParetoUnknown).toBe("unknown-is-not-superior");
  const scenario = { id: "pareto-hand" };
  const creates = { count: 0 };
  const model = defineModelFactory({
    id: "tradeoff",
    version: 1,
    paramsSchema: zodStandardSchema(
      z.object({ cost: z.number().positive(), benefit: z.number().nonnegative(), reportBenefit: z.boolean() }),
    ),
    create(params: { cost: number; benefit: number; reportBenefit: boolean }) {
      creates.count += 1;
      return {
        id: "tradeoff",
        version: 1,
        income: () => ({ unit, amount: params.cost }),
        evolve: (_ctx: unknown, state: SimState<number, "COIN", { benefit?: number }>) =>
          params.reportBenefit ? { ...state, vars: { ...state.vars, benefit: params.benefit } } : state,
        actions: () => [],
      };
    },
  });
  const dimensions = [
    { id: "cost", target: "model" as const, path: "cost", space: { kind: "number" as const, min: 1, max: 10 }, baseline: 1 },
    { id: "benefit", target: "model" as const, path: "benefit", space: { kind: "number" as const, min: 0, max: 10 }, baseline: 1 },
    { id: "report", target: "model" as const, path: "reportBenefit", space: { kind: "bool" as const }, baseline: true },
  ];
  const point = (id: string, cost: number, benefit: number, reportBenefit: boolean) => ({
    id,
    assignments: [
      { dimensionId: "cost", value: cost },
      { dimensionId: "benefit", value: benefit },
      { dimensionId: "report", value: reportBenefit },
    ],
  });
  const spec = specFor(scenario, {
    model: { id: "tradeoff", version: 1 },
    strategy: undefined,
    metricId: "endMoney",
    goal: undefined,
    objectives: [
      { id: "money", metricId: "endMoney", sense: "higher" },
      { id: "benefit", metricId: "varBenefit", sense: "higher" },
    ],
    constraints: [{ id: "cap", metricId: "endMoney", op: "lte", limit: 4 }],
    dimensions,
    candidates: [point("C", 6, 1, true), point("A", 5, 3, true), point("E", 4, 9, false), point("D", 2, 2, true), point("B", 3, 5, true)],
    budget: { candidates: 5, seeds: 1 },
    horizonSec: 1,
  });
  const artifact = runExperiment({
    spec,
    scenario,
    modelRegistry: createModelRegistry([model]),
    strategyRegistry: createStrategyRegistry([]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "pareto-hand",
  });
  expect(creates.count).toBe(5);
  expect(artifact.pareto).toEqual({ sense: "per-metric", nonDominated: ["A", "B", "C"], uncompared: ["E"] });
  expect(artifact.pareto.nonDominated).not.toContain("D");
  expect(artifact.pareto.nonDominated).not.toContain("E");
  expect(artifact.candidates.find((candidate) => candidate.id === "A")?.constraintViolations).toEqual(["cap"]);
  expect(artifact.candidates.find((candidate) => candidate.id === "C")?.constraintViolations).toEqual(["cap"]);
  expect(artifact.candidates.find((candidate) => candidate.id === "B")?.constraintViolations).toEqual([]);
  expect(artifact.candidates.find((candidate) => candidate.id === "E")?.metrics.find((metric) => metric.metricId === "varBenefit")).toEqual({
    metricId: "varBenefit",
    status: "censored",
    value: null,
  });
  expect(JSON.stringify(artifact)).not.toContain("weightedScore");
}

describe("parameter experiments", () => {
  it("checks local elasticity direction", checksLocalElasticityDirection);
  it("keeps the strategy tune signature", keepsStrategyTuneSignature);
  it("rejects unsafe parameters before a run", rejectsUnsafeParametersBeforeRun);
  it("keeps candidate order and the input scenario", keepsCandidateOrderAndScenario);
  it("skips a censored horizon for sensitivity", skipsCensoredHorizonForSensitivity);
  it("matches the hand Pareto front", matchesHandPareto);
});
