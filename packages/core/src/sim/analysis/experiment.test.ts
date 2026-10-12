import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createBreakInfinityEngine, createNumberEngine, Decimal } from "../../engine/breakInfinity";
import { createModelRegistry, defineModelFactory } from "../../scenario/registry";
import { canonicalJson, sha256Text } from "../../scenario/scenarioContract";
import type { ScenarioV1 } from "../../scenario/types";
import { zodStandardSchema } from "../../scenario/validate";
import { createObjectiveRegistry } from "../strategy/opt/registry";
import { runCandidateAndScore } from "../strategy/opt/runner";
import { validateTuneSpecV1 } from "../strategy/opt/validate";
import { createStrategyRegistry, type StrategyFactory } from "../strategy/registry";
import type { CompiledScenario, SimState } from "../types";
import {
  assertRegisteredPath,
  checkExperimentSpec,
  ExperimentRejected,
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
  experimentRunBase,
  experimentTaskDescriptor,
  runExperiment,
  setRegisteredParam,
  validateExperimentArtifact,
  validateExperimentSpec,
  type ExperimentArtifactV1,
  type ExperimentSpecV1,
} from "./experiment";
import { assignmentFitsParamSpace, localElasticity, paretoFront, paretoFrontBy } from "./sensitivity";

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
        income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: params.incomeRate }),
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

/** Income per second is the `amount` param, with no schema. */
function tinyIncomeFactory() {
  return defineModelFactory({
    id: "tiny-income",
    version: 1,
    create(params: { amount: number }) {
      return { id: "tiny-income", version: 1, income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: params.amount }), actions: () => [] };
    },
  });
}

/** A scenario for the constant-income model. The experiment starts every candidate from it. */
function incomeScenario(patch: Partial<ScenarioV1> = {}): ScenarioV1 {
  return {
    schemaVersion: 1,
    meta: { id: fixture.id },
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: fixture.modelId, version: fixture.modelVersion, params: { incomeRate: fixture.incomeBaseline } },
    initial: { wallet: { unit: "COIN", amount: "0" } },
    clock: { stepSec: fixture.stepSec, durationSec: fixture.horizonSec },
    strategy: { id: fixture.strategyId, params: { maxPicks: fixture.policyBaseline } },
    ...patch,
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

function runWith(scenario: ScenarioV1, spec: ExperimentSpecV1, creates: { count: number } = { count: 0 }): ExperimentArtifactV1 {
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
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity #bd1aa44 Re-read the section, then ran this function: elasticity is -0.5 and -2, and maxPicks elasticity is 0.
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor The income candidate and the policy candidate record different parameter JSON on the same logical seed.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #10a3f42 Re-read the section, then ran this function: incomeRate becomes 2 on one task and maxPicks becomes 2 on another.
 * @evidence ./experiment.ts#experimentLocalOat Reads the local method contract.
 * @evidenceReview ./experiment.ts#experimentLocalOat #1c1bffa The declaration is one-at-a-time-local-not-sobol.
 * @evidence ./experiment.ts#experimentTaskDescriptor Reads the task descriptor contract.
 * @evidenceReview ./experiment.ts#experimentTaskDescriptor #03898ac The declaration is task-id-params-seed-version.
 * @evidence ./experiment.ts#runExperiment Runs the sweep and local sensitivity on a fixed spec.
 * @evidenceReview ./experiment.ts#runExperiment #d010bfd The function checks the scenario hash against the spec, rejects a timeToMoney metric without a finite goal, compiles the scenario once as the candidate base, runs each planned candidate per seed through a fresh binding to the horizon while reading the reach time, averages every seed, and reports local sensitivity only for completed horizons.
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
  // A tiny positive baseline makes the parameter change overflow. The row is unavailable, not a false 0.
  expect(localElasticity({ baselineP: Number.MIN_VALUE, probeP: 1, baselineY: 1, probeY: 2 })).toMatchObject({
    status: "unavailable",
    elasticity: null,
    absoluteChange: "1",
  });
  // Pareto objectives are matched by id, so a point that lists them in another order is still dominated.
  expect(
    paretoFront([
      { id: "A", objectives: [{ id: "cost", sense: "lower", value: 1 }, { id: "benefit", sense: "higher", value: 5 }] },
      { id: "B", objectives: [{ id: "benefit", sense: "higher", value: 4 }, { id: "cost", sense: "lower", value: 2 }] },
    ]),
  ).toEqual({ sense: "per-metric", nonDominated: ["A"], uncompared: [] });
  expect(() =>
    paretoFront([
      { id: "A", objectives: [{ id: "cost", sense: "lower", value: 1 }] },
      { id: "B", objectives: [{ id: "benefit", sense: "higher", value: 4 }] },
    ]),
  ).toThrow("same objective ids");
  expect(() =>
    paretoFront([
      { id: "A", objectives: [{ id: "x", sense: "higher", value: 2 }] },
      { id: "B", objectives: [{ id: "x", sense: "lower", value: 1 }] },
    ]),
  ).toThrow("another sense");
  expect(() =>
    paretoFront([
      { id: "A", objectives: [{ id: "x", sense: "higher", value: 2 }] },
      { id: "A", objectives: [{ id: "x", sense: "higher", value: 1 }] },
    ]),
  ).toThrow("ids must be unique");
  const byNumber = (left: number, right: number) => left - right;
  expect(() =>
    paretoFrontBy(
      [
        { id: "A", objectives: [{ sense: "higher", value: 2 }] },
        { id: "B", objectives: [{ sense: "lower", value: 1 }] },
      ],
      byNumber,
    ),
  ).toThrow("objective count and senses");
  expect(() =>
    paretoFrontBy(
      [
        { id: "A", objectives: [{ sense: "higher", value: 2 }] },
        { id: "B", objectives: [{ sense: "higher", value: 1 }, { sense: "lower", value: 1 }] },
      ],
      byNumber,
    ),
  ).toThrow("objective count and senses");
  // Opposite-sign parameters near the double limit: the parameter change overflows, the ratio -2 does not, so the elasticity is 1.
  expect(localElasticity({ baselineP: 1e308, probeP: -1e308, baselineY: 1, probeY: -1 })).toMatchObject({ status: "observed", elasticity: "1" });
  // Opposite-sign values near the double limit: the difference overflows, the ratio -2 does not.
  expect(localElasticity({ baselineP: 1, probeP: 2, baselineY: 1e308, probeY: -1e308 })).toEqual({
    status: "observed",
    elasticity: "-2",
    absoluteChange: null,
    direction: "lower",
    globalSensitivity: false,
    sobol: false,
  });
  expect(localElasticity({ baselineP: 0, probeP: 1, baselineY: 10, probeY: 12 })).toEqual({
    status: "unavailable",
    elasticity: null,
    absoluteChange: "2",
    direction: "higher",
    globalSensitivity: false,
    sobol: false,
  });
  const scenario = incomeScenario();
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
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter #b313204 Re-read the section, then ran this function: a stripped typo path, overlapping model and strategy paths, a session dimension, a repeated seed, another model version, an Infinity choice value, an Infinity space bound, an Infinity limit, an Infinity goal, a schema-less typo path, -0, a -0 seed, a __type path, non-JSON params, a malformed untyped spec, and a repeated constraint id throw, and create count stays 0.
 * @evidence ./experiment.ts#experimentRegisteredSetter Reads the setter contract.
 * @evidenceReview ./experiment.ts#experimentRegisteredSetter #080a763 The declaration is registered-key-not-jsonpath.
 * @evidence ./experiment.ts#assertRegisteredPath Rejects prototype, bracket, and traversal paths, and session paths other than pattern or days.
 * @evidenceReview ./experiment.ts#assertRegisteredPath #7465c3e The function splits a trimmed dotted identifier path and rejects empty, bracketed, traversing, or banned segments, and session paths other than pattern or days.
 * @evidence ./experiment.ts#checkExperimentSpec Runs the rejections alone, before any compile or create.
 * @evidenceReview ./experiment.ts#checkExperimentSpec #5a81db2 The function runs the hash, spec, path, and parameter checks of runExperiment and returns without creating a model.
 * @evidence ./experiment.ts#setRegisteredParam Sets a nested model parameter on a copy.
 * @evidenceReview ./experiment.ts#setRegisteredParam #6f47f14 The function validates the path, copies only the objects on that path, root included, with their prototype and configurable descriptors, defines each path key and the leaf as an own data property, refuses a prototype key at each segment, creates missing own objects, and sets the leaf without changing the input or any value off the path.
 */
export function rejectsUnsafeParametersBeforeRun(): void {
  const safePath = "income.rate";
  expect(assertRegisteredPath(safePath, "model")).toEqual(["income", "rate"]);
  for (const path of ["__proto__.x", "a..b", "a[0]", "a/b", " a", "__type", "a.__type"]) {
    expect(() => assertRegisteredPath(path, "model")).toThrow();
  }
  const sessionPath = "speed";
  expect(() => assertRegisteredPath(sessionPath, "session")).toThrow();
  const root = { income: { rate: 1 } };
  expect(setRegisteredParam(root, "income.bonus", 2)).toEqual({ income: { rate: 1, bonus: 2 } });
  expect(root).toEqual({ income: { rate: 1 } });
  // Only the assigned path is copied. A Date, an undefined field, and -0 elsewhere stay exactly as given.
  const at = new Date(0);
  const exotic: Record<string, unknown> = { at, skip: undefined, neg: -0, income: { rate: 1 } };
  const assigned = setRegisteredParam(exotic, "income.rate", 2);
  expect(assigned.at).toBe(at);
  expect("skip" in assigned).toBe(true);
  expect(Object.is(assigned.neg, -0)).toBe(true);
  expect(assigned.income).toEqual({ rate: 2 });
  expect(exotic.income).toEqual({ rate: 1 });
  // An object on the path keeps its prototype, so a class instance still has its methods.
  class Curve {
    rate = 1;
    double(): number {
      return this.rate * 2;
    }
  }
  const curved = setRegisteredParam({ curve: new Curve() }, "curve.rate", 3);
  expect(curved.curve).toBeInstanceOf(Curve);
  expect((curved.curve as Curve).double()).toBe(6);
  // The root keeps its prototype too, and a frozen object on the path still takes the assigned value.
  const rootCurve = setRegisteredParam(new Curve() as unknown as Record<string, unknown>, "rate", 4);
  expect((rootCurve as unknown as Curve).double()).toBe(8);
  const frozen = Object.freeze({ curve: Object.freeze({ rate: 1, keep: true }) });
  expect(setRegisteredParam(frozen, "curve.rate", 5)).toEqual({ curve: { rate: 5, keep: true } });
  expect(frozen.curve.rate).toBe(1);
  // -0 would share every descriptor and hash with 0, so it is not a parameter value.
  expect(assignmentFitsParamSpace({ kind: "number", min: -1, max: 1 }, -0)).toBe(false);
  expect(assignmentFitsParamSpace({ kind: "choice", values: [0] }, -0)).toBe(false);
  expect(experimentRegisteredSetter).toBe("registered-key-not-jsonpath");
  const scenario = incomeScenario();
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
  const incomeDimension = {
    id: "incomeRate",
    target: "model" as const,
    path: "incomeRate",
    space: { kind: "number" as const, min: 0.1, max: 5 },
    baseline: 1,
    probes: [2],
  };
  const rejected: readonly (readonly [string, ExperimentSpecV1])[] = [
    // The zod object schema strips an unknown key, so the typo would run at the default rate.
    [
      "does not register incomeRat",
      specFor(scenario, { dimensions: [{ ...incomeDimension, id: "typo", path: "incomeRat" }] }),
    ],
    [
      "target the same model parameter",
      specFor(scenario, { dimensions: [incomeDimension, { ...incomeDimension, id: "again", probes: [0.5] }] }),
    ],
    [
      "target the same strategy parameter",
      specFor(scenario, {
        dimensions: [
          { id: "picks", target: "strategy", path: "limits", space: { kind: "int", min: 1, max: 3 }, baseline: 1 },
          { id: "picksMax", target: "strategy", path: "limits.max", space: { kind: "int", min: 1, max: 3 }, baseline: 1 },
        ],
      }),
    ],
    [
      "session dimension days is not executed",
      specFor(scenario, {
        dimensions: [{ id: "days", target: "session", path: "days", space: { kind: "int", min: 1, max: 3 }, baseline: 1, probes: [2] }],
      }),
    ],
    ["seeds must be unique", specFor(scenario, { seeds: [fixture.seed, fixture.seed] })],
    ["seeds must not be -0", specFor(scenario, { seeds: [-0] })],
    ["model version must be finite", specFor(scenario, { model: { id: fixture.modelId, version: JSON.parse("1e400") as number } })],
    ["model version must be finite and not -0", specFor(scenario, { model: { id: fixture.modelId, version: -0 } })],
    [
      "space bounds for incomeRate must be finite",
      specFor(scenario, { dimensions: [{ ...incomeDimension, space: { kind: "number", min: 0.1, max: JSON.parse("1e400") as number } }] }),
    ],
    ["does not match the scenario model", specFor(scenario, { model: { id: fixture.modelId, version: 2 } })],
    [
      "choice values for inf must be finite",
      specFor(scenario, {
        dimensions: [
          {
            id: "inf",
            target: "model",
            path: "incomeRate",
            space: { kind: "choice", values: [1, JSON.parse("1e400") as number] },
            baseline: JSON.parse("1e400") as number,
          },
        ],
      }),
    ],
    // JSON.parse turns the literal 1e400 into Infinity.
    [
      "limit must be finite",
      specFor(scenario, { constraints: [{ id: "cap", metricId: "endMoney", op: "lte", limit: JSON.parse("1e400") as number }] }),
    ],
    [
      "duplicate constraint cap",
      specFor(scenario, {
        constraints: [
          { id: "cap", metricId: "endMoney", op: "lte", limit: 4 },
          { id: "cap", metricId: "timeToMoney", op: "gte", limit: 1 },
        ],
      }),
    ],
  ];
  expect(assignmentFitsParamSpace({ kind: "choice", values: [JSON.parse("1e400") as number] }, JSON.parse("1e400") as number)).toBe(false);
  for (const [message, spec] of rejected) {
    expect(() => runWith(scenario, spec, creates)).toThrow(message);
  }
  // Params are recorded as canonical JSON, so a Date or a class instance in them is refused before any create.
  const shared = { rate: 1 };
  const named = Object.assign([1, 2], { mode: "fast" });
  class Steps extends Array<number> {}
  // A hole balanced by a non-index key keeps the key count of a plain array.
  const balanced: unknown[] = new Array(1);
  (balanced as unknown as Record<string, unknown>)["4294967295"] = "secret";
  const odds = [
    new Date(0),
    new (class Curve { rate = 1 })(),
    undefined,
    { __type: "curve" },
    { a: shared, b: shared },
    named,
    Steps.from([1, 2]),
    [1, , 3],
    balanced,
    Object.freeze({ rate: 1 }),
    Object.defineProperty({}, "rate", { value: 1, enumerable: true, writable: false, configurable: true }),
  ];
  for (const odd of odds) {
    const oddScenario = incomeScenario({ model: { id: "tiny-income", version: 1, params: { amount: 1, extra: odd } }, strategy: undefined });
    expect(() =>
      runExperiment({
        spec: specFor(oddScenario, {
          model: { id: "tiny-income", version: 1 },
          strategy: undefined,
          metricId: "endMoney",
          goal: undefined,
          dimensions: [{ id: "amount", target: "model", path: "amount", space: { kind: "number", min: 0, max: 5 }, baseline: 1 }],
          budget: { candidates: 1, seeds: 1 },
          horizonSec: 1,
        }),
        scenario: oddScenario,
        modelRegistry: createModelRegistry([tinyIncomeFactory()]),
        strategyRegistry: createStrategyRegistry([]),
        engine: createNumberEngine(),
        engineId: "number",
        engineVersion: "1",
        effectiveRunHash: "odd-params",
      }),
    ).toThrow("model params must be JSON data");
  }
  // Initial vars reach every run and the scenario hash, so a Date or a cycle in them is refused too.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const vars of [{ at: new Date(0) }, cyclic]) {
    const varsScenario = incomeScenario({ initial: { wallet: { unit: "COIN", amount: "0" }, vars } });
    expect(() => runWith(varsScenario, specFor(varsScenario), creates)).toThrow("initial state must be JSON data");
  }
  // A bigint cannot be written as canonical JSON. It is an ExperimentRejected, not a TypeError from hashing.
  const bigScenario = incomeScenario({ model: { id: fixture.modelId, version: fixture.modelVersion, params: { incomeRate: 1, big: 1n } } });
  expect(() => runWith(bigScenario, { ...specFor(scenario), scenario: { ref: "big", hash: "unknown" } }, creates)).toThrow(ExperimentRejected);
  // An empty strategy id would build no strategy while the task names one.
  const emptyStrategy = incomeScenario({ strategy: { id: "", params: { maxPicks: 1 } } });
  expect(() => runWith(emptyStrategy, specFor(emptyStrategy, { strategy: undefined }), creates)).toThrow("strategy id must not be empty");
  expect(() => runWith(scenario, specFor(scenario, { strategy: { id: "" } }), creates)).toThrow("strategy id must not be empty");
  // Explicit null params would share the record of omitted params.
  const nullScenario = incomeScenario({ model: { id: fixture.modelId, version: fixture.modelVersion, params: null } });
  expect(() => runWith(nullScenario, specFor(nullScenario), creates)).toThrow("must be an object or omitted, not null");
  // One object shared by the model and strategy params is refused as well.
  const sharedRoot = { maxPicks: 1 };
  const crossScenario = incomeScenario({
    model: { id: fixture.modelId, version: fixture.modelVersion, params: { incomeRate: 1, shape: sharedRoot } },
    strategy: { id: fixture.strategyId, params: sharedRoot },
  });
  expect(() => runWith(crossScenario, specFor(crossScenario), creates)).toThrow("strategy params must be JSON data");
  // Without a params schema, a path must already be in the scenario params, so a typo is not added as an ignored key.
  const bare = incomeScenario({ model: { id: "tiny-income", version: 1, params: { amount: 1 } }, strategy: undefined });
  const bareRun = (path: string) =>
    runExperiment({
      spec: specFor(bare, {
        model: { id: "tiny-income", version: 1 },
        strategy: undefined,
        metricId: "endMoney",
        goal: undefined,
        dimensions: [{ id: "amount", target: "model", path, space: { kind: "number", min: 0, max: 5 }, baseline: 1, probes: [2] }],
        budget: { candidates: 2, seeds: 1 },
        horizonSec: 1,
      }),
      scenario: bare,
      modelRegistry: createModelRegistry([tinyIncomeFactory()]),
      strategyRegistry: createStrategyRegistry([]),
      engine: createNumberEngine(),
      engineId: "number",
      engineVersion: "1",
      effectiveRunHash: "schema-less",
    });
  expect(() => bareRun("amout")).toThrow("has no params schema and its scenario params do not register amout");
  expect(bareRun("amount").candidates.map((candidate) => candidate.metrics[0]?.value)).toEqual(["1", "2"]);
  // A goal is checked even when no metric reads it. JSON.parse turns the literal 1e400 into Infinity.
  expect(() =>
    runWith(scenario, specFor(scenario, { metricId: "endMoney", goal: { target: JSON.parse("1e400") as number } }), creates),
  ).toThrow("goal target must be finite");
  // The same checks run alone before a caller compiles the scenario, and a valid spec passes without a create.
  const registries = { modelRegistry: createModelRegistry([incomeFactory(creates)]), strategyRegistry: createStrategyRegistry([policyFactory()]) };
  expect(() => checkExperimentSpec({ spec: rejected.find(([message]) => message === "seeds must be unique")![1], scenario, ...registries })).toThrow("seeds must be unique");
  expect(() => checkExperimentSpec({ spec: specFor(scenario), scenario, ...registries })).not.toThrow();
  // An untyped caller's malformed spec is an ExperimentRejected, read before the scenario hash.
  expect(() => checkExperimentSpec({ spec: {} as ExperimentSpecV1, scenario, ...registries })).toThrow(ExperimentRejected);
  expect(creates.count).toBe(0);
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order Reversed candidates keep the same report and leave the scenario JSON unchanged.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order #7cede33 Re-read the section, then ran this function: effective hashes match, incomeRate on the scenario stays 0, create runs 6 times, and reversed probed dimensions give the same elasticity rows.
 * @evidence ./experiment.ts#experimentCandidateOrder Reads the order contract.
 * @evidenceReview ./experiment.ts#experimentCandidateOrder #b4dbc98 The declaration is sorted-candidates-unmutated-scenario.
 */
export function keepsCandidateOrderAndScenario(): void {
  expect(experimentCandidateOrder).toBe("sorted-candidates-unmutated-scenario");
  // The top-level incomeRate is a decoy. It is not the model parameter.
  const scenario = { ...incomeScenario({ strategy: undefined }), incomeRate: 0 } as ScenarioV1;
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
  // Each experiment compiles the scenario once, then each fresh run creates a model.
  expect(creates.count).toBe(6);
  expect(first.effectiveSpecHash).toBe(second.effectiveSpecHash);
  expect(first.originalSpecHash).not.toBe(second.originalSpecHash);
  expect(first.candidates.map((candidate) => candidate.id)).toEqual(["a", "b"]);
  const rest = (artifact: ExperimentArtifactV1) => ({ ...artifact, originalSpecHash: "omitted" });
  expect(rest(first)).toEqual(rest(second));
  // Reordered probed dimensions share the effective hash, so they give the same elasticity rows in the same order.
  const withPolicy = incomeScenario();
  const probed = specFor(withPolicy).dimensions;
  const inOrder = runWith(withPolicy, specFor(withPolicy, { dimensions: probed }));
  const swapped = runWith(withPolicy, specFor(withPolicy, { dimensions: [...probed].reverse() }));
  expect(swapped.effectiveSpecHash).toBe(inOrder.effectiveSpecHash);
  expect(swapped.elasticities.map((row) => row.dimensionId)).toEqual(["incomeRate", "incomeRate", "maxPicks"]);
  expect(rest(swapped)).toEqual(rest(inOrder));
  // Assignments that add keys reach the factory in dimension id order, whatever order the candidate lists them in.
  const keyOrders: string[] = [];
  const keyed = defineModelFactory({
    id: "key-order",
    version: 1,
    // Both keys are registered and optional, so a candidate adds them to empty scenario params.
    paramsSchema: zodStandardSchema(z.object({ a: z.number().int().optional(), b: z.number().int().optional() })),
    create(params: Record<string, unknown>) {
      keyOrders.push(Object.keys(params).join(","));
      return { id: "key-order", version: 1, income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: 1 }), actions: () => [] };
    },
  });
  const keyScenario = incomeScenario({ model: { id: "key-order", version: 1, params: {} }, strategy: undefined });
  const keyDimensions = [
    { id: "a", target: "model" as const, path: "a", space: { kind: "int" as const, min: 0, max: 9 }, baseline: 1 },
    { id: "b", target: "model" as const, path: "b", space: { kind: "int" as const, min: 0, max: 9 }, baseline: 2 },
  ];
  const keyRun = (assignments: { dimensionId: string; value: number }[]) =>
    runExperiment({
      spec: specFor(keyScenario, {
        model: { id: "key-order", version: 1 },
        strategy: undefined,
        metricId: "endMoney",
        goal: undefined,
        dimensions: keyDimensions,
        candidates: [{ id: "only", assignments }],
        budget: { candidates: 1, seeds: 1 },
        horizonSec: 1,
      }),
      scenario: keyScenario,
      modelRegistry: createModelRegistry([keyed]),
      strategyRegistry: createStrategyRegistry([]),
      engine: createNumberEngine(),
      engineId: "number",
      engineVersion: "1",
      effectiveRunHash: "key-order",
    });
  const ab = keyRun([{ dimensionId: "a", value: 1 }, { dimensionId: "b", value: 2 }]);
  const ba = keyRun([{ dimensionId: "b", value: 2 }, { dimensionId: "a", value: 1 }]);
  expect(ba.effectiveSpecHash).toBe(ab.effectiveSpecHash);
  // One compile and one fresh run per experiment.
  expect(keyOrders.filter((order) => order === "a,b")).toHaveLength(2);
  expect(keyOrders).not.toContain("b,a");
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon Horizon 9 does not become the reach time of an unmet target 10.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon #befcebb Re-read the section, then ran this function: the censored value is null and elasticity is unavailable, and with an end money constraint rates 1 and 2 reach in 10 and 5 and end with 40 and 80, and the censored bound proves lte 8 and lte 9 but not lte 12.
 * @evidence ./experiment.ts#experimentCensoredHorizon Reads the censor contract.
 * @evidenceReview ./experiment.ts#experimentCensoredHorizon #81f017f The declaration is censored-time-not-horizon.
 * @evidence ./experiment.ts#experimentRunBase Removes the inherited stop condition, step budget, and trace.
 * @evidenceReview ./experiment.ts#experimentRunBase #7667367 The function drops until, maxSteps, and trace and keeps the other run options.
 */
export function skipsCensoredHorizonForSensitivity(): void {
  expect(experimentCensoredHorizon).toBe("censored-time-not-horizon");
  // The scenario stop condition, step budget, and report trace do not reach a candidate run.
  expect(experimentRunBase({ stepSec: 1, durationSec: 5, until: () => true, maxSteps: 3, trace: { everySteps: 1, keepActionsLog: true } })).toEqual({
    stepSec: 1,
    durationSec: 5,
  });
  const scenario = incomeScenario({ strategy: undefined });
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
  // The censored reach time is later than 9. That proves lte 8 and lte 9 violated, while lte 12 stays unproven.
  const deadlines = runWith(
    scenario,
    specFor(scenario, {
      horizonSec: fixture.censoredHorizonSec,
      constraints: [
        { id: "by8", metricId: "timeToMoney", op: "lte", limit: 8 },
        { id: "by9", metricId: "timeToMoney", op: "lte", limit: 9 },
        { id: "by12", metricId: "timeToMoney", op: "lte", limit: 12 },
        { id: "after3", metricId: "timeToMoney", op: "gte", limit: 3 },
      ],
      dimensions: [
        { id: "incomeRate", target: "model", path: "incomeRate", space: { kind: "number", min: 0.1, max: 5 }, baseline: 1, probes: [2] },
      ],
      strategy: undefined,
      budget: { candidates: 2, seeds: 1 },
    }),
  );
  const missed = deadlines.candidates.find((candidate) => candidate.id === "baseline");
  expect(missed?.constraintViolations).toEqual(["by8", "by9"]);
  expect(missed?.metrics[0]).toEqual({ metricId: "timeToMoney", status: "censored", value: null });
  expect(deadlines.candidates.find((candidate) => candidate.id === "oat:incomeRate:2")?.constraintViolations).toEqual([]);
  // A reach time and end money in one spec: the run continues past the goal, so end money is read at the horizon.
  const both = runWith(
    scenario,
    specFor(scenario, {
      strategy: undefined,
      constraints: [{ id: "floor", metricId: "endMoney", op: "gte", limit: fixture.horizonSec }],
      dimensions: [
        { id: "incomeRate", target: "model", path: "incomeRate", space: { kind: "number", min: 0.1, max: 5 }, baseline: 1, probes: [2] },
      ],
      budget: { candidates: 2, seeds: 1 },
    }),
  );
  const read = (id: string, metricId: string) =>
    both.candidates.find((candidate) => candidate.id === id)?.metrics.find((metric) => metric.metricId === metricId)?.value;
  expect(read("baseline", "timeToMoney")).toBe("10");
  expect(read("baseline", "endMoney")).toBe(String(fixture.horizonSec));
  expect(read("oat:incomeRate:2", "timeToMoney")).toBe("5");
  expect(read("oat:incomeRate:2", "endMoney")).toBe(String(2 * fixture.horizonSec));
  expect(both.candidates.map((candidate) => candidate.constraintViolations)).toEqual([[], []]);
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown The hand tradeoff keeps A, B, and C, drops D, and leaves E uncompared.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown #1e93b71 Re-read the section, then ran this function: nonDominated is A, B, C and E is uncompared, and end money 0, 0.75e-12, and 1.5e-12 give the front B and C.
 * @evidence ./experiment.ts#experimentParetoUnknown Reads the Pareto contract.
 * @evidenceReview ./experiment.ts#experimentParetoUnknown #4c62a0c The declaration is unknown-is-not-superior.
 */
export function matchesHandPareto(): void {
  expect(experimentParetoUnknown).toBe("unknown-is-not-superior");
  const scenario = incomeScenario({
    model: { id: "tradeoff", version: 1, params: { cost: 1, benefit: 1, reportBenefit: true } },
    strategy: undefined,
  });
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
  expect(creates.count).toBe(6);
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
  // The number engine treats amounts within 1e-12 as equal. Each pair is compared directly, so 0 is still below 1.5e-12.
  const tiny = tinyIncomeFactory();
  const tinyScenario = incomeScenario({ model: { id: "tiny-income", version: 1, params: { amount: 0 } }, strategy: undefined });
  const amountDimension = { id: "amount", target: "model" as const, path: "amount", space: { kind: "number" as const, min: 0, max: 1 }, baseline: 0 };
  const tinyFront = runExperiment({
    spec: specFor(tinyScenario, {
      model: { id: "tiny-income", version: 1 },
      strategy: undefined,
      metricId: "endMoney",
      goal: undefined,
      objectives: [{ id: "money", metricId: "endMoney", sense: "higher" }],
      dimensions: [amountDimension],
      candidates: [
        { id: "A", assignments: [{ dimensionId: "amount", value: 0 }] },
        { id: "B", assignments: [{ dimensionId: "amount", value: 0.75e-12 }] },
        { id: "C", assignments: [{ dimensionId: "amount", value: 1.5e-12 }] },
      ],
      budget: { candidates: 3, seeds: 1 },
      horizonSec: 1,
    }),
    scenario: tinyScenario,
    modelRegistry: createModelRegistry([tiny]),
    strategyRegistry: createStrategyRegistry([]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "tolerance-front",
  });
  expect(tinyFront.pareto).toEqual({ sense: "per-metric", nonDominated: ["B", "C"], uncompared: [] });
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor Candidates start from the referenced scenario and the candidate metric is the mean over every seed.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #10a3f42 Re-read the section, then ran this function: the GEM wallet starts at 100, maxPicks stays 3, the stripped note reaches create as kept, seeds 1 and 3 average to reach time 20 and end money 160, and probes 1 and "1" get distinct ids.
 * @evidence ./experiment.ts#runExperiment Runs every candidate from the compiled scenario and averages the seeds.
 * @evidenceReview ./experiment.ts#runExperiment #d010bfd The function compiles the request scenario once as the base, keeps its raw model and strategy params with a private copy per seed, and aggregates every seed row by its mean.
 */
export function startsCandidatesFromScenario(): void {
  const creates = { count: 0 };
  const received: unknown[] = [];
  // Income per second is the rate times the logical seed, so each seed reaches the target at its own time.
  // The zod object schema strips `note`. Compile passes the raw scenario params to create, and so does a candidate.
  const seeded = defineModelFactory({
    id: "seeded-income",
    version: 1,
    paramsSchema: zodStandardSchema(z.object({ incomeRate: z.number().positive(), tag: z.union([z.number(), z.string()]).optional() })),
    create(params: { incomeRate: number }) {
      creates.count += 1;
      received.push(params);
      return {
        id: "seeded-income",
        version: 1,
        income: (ctx: { unit: { code: string }; seed?: number }) => ({ unit: ctx.unit, amount: params.incomeRate * Number(ctx.seed) }),
        actions: () => [],
      };
    },
  });
  const scenario = incomeScenario({
    unit: { code: "GEM" },
    model: { id: "seeded-income", version: 1, params: { incomeRate: 1, note: "kept" } },
    initial: { wallet: { unit: "GEM", amount: "100" } },
    strategy: { id: fixture.strategyId, params: { maxPicks: 3 } },
  });
  const spec = specFor(scenario, {
    model: { id: "seeded-income", version: 1 },
    goal: { target: 130 },
    constraints: [{ id: "floor", metricId: "endMoney", op: "gte", limit: 0 }],
    dimensions: [
      { id: "incomeRate", target: "model", path: "incomeRate", space: { kind: "number", min: 0.1, max: 5 }, baseline: 1 },
    ],
    seeds: [1, 3],
    budget: { candidates: 1, seeds: 2 },
    horizonSec: 30,
  });
  const artifact = runExperiment({
    spec,
    scenario,
    modelRegistry: createModelRegistry([seeded]),
    strategyRegistry: createStrategyRegistry([policyFactory()]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "scenario-base",
  });
  // Seed 1 earns 1 per second from 100 and reaches 130 at 30. Seed 3 earns 3 and reaches it at 10.
  expect(artifact.tasks.map((task) => [task.taskId, task.value])).toEqual([
    ["baseline#1", "30"],
    ["baseline#3", "10"],
  ]);
  expect(artifact.tasks[0]).toMatchObject({
    modelParams: "{\"incomeRate\":1,\"note\":\"kept\"}",
    strategyParams: "{\"maxPicks\":3}",
    strategyId: fixture.strategyId,
  });
  expect(artifact.candidates[0]?.metrics).toEqual([
    { metricId: "timeToMoney", status: "observed", value: "20" },
    { metricId: "endMoney", status: "observed", value: "160" },
  ]);
  expect(creates.count).toBe(3);
  expect(received.every((params) => (params as { note?: string }).note === "kept")).toBe(true);
  // A factory that mutates its params on create cannot change a later seed, another candidate, or the caller's scenario.
  const mutating = defineModelFactory({
    id: "mutating-income",
    version: 1,
    create(params: { incomeRate: number; nested: { bonus: number } }) {
      const rate = params.incomeRate + params.nested.bonus;
      params.incomeRate *= 10;
      params.nested.bonus += 5;
      return { id: "mutating-income", version: 1, income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: rate }), actions: () => [] };
    },
  });
  const mutatingScenario = incomeScenario({
    model: { id: "mutating-income", version: 1, params: { incomeRate: 1, nested: { bonus: 0 } } },
    strategy: undefined,
  });
  const mutated = runExperiment({
    spec: specFor(mutatingScenario, {
      model: { id: "mutating-income", version: 1 },
      strategy: undefined,
      metricId: "endMoney",
      goal: undefined,
      dimensions: [],
      seeds: [1, 2],
      budget: { candidates: 1, seeds: 2 },
      horizonSec: 10,
    }),
    scenario: mutatingScenario,
    modelRegistry: createModelRegistry([mutating]),
    strategyRegistry: createStrategyRegistry([]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "mutating",
  });
  expect(mutated.tasks.map((task) => [task.value, task.modelParams])).toEqual([
    ["10", "{\"incomeRate\":1,\"nested\":{\"bonus\":0}}"],
    ["10", "{\"incomeRate\":1,\"nested\":{\"bonus\":0}}"],
  ]);
  expect(mutatingScenario.model.params).toEqual({ incomeRate: 1, nested: { bonus: 0 } });
  // Choice probes 1 and "1" are distinct values, so their generated ids are distinct too.
  const tagged = runExperiment({
    spec: specFor(scenario, {
      model: { id: "seeded-income", version: 1 },
      goal: { target: 130 },
      dimensions: [{ id: "tag", target: "model", path: "tag", space: { kind: "choice", values: [1, "1"] }, baseline: 1, probes: [1, "1"] }],
      seeds: [1],
      budget: { candidates: 3, seeds: 1 },
      horizonSec: 30,
    }),
    scenario,
    modelRegistry: createModelRegistry([seeded]),
    strategyRegistry: createStrategyRegistry([policyFactory()]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "probe-ids",
  });
  expect(tagged.candidates.map((candidate) => candidate.id)).toEqual(["baseline", "oat:tag:\"1\"", "oat:tag:1"]);
  expect(tagged.tasks.find((task) => task.candidateId === "oat:tag:\"1\"")?.modelParams).toBe("{\"incomeRate\":1,\"note\":\"kept\",\"tag\":\"1\"}");
}

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown An amount past the double range stays an observed engine value for constraints, Pareto, and sensitivity.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown #1e93b71 Re-read the section, then ran this function: 1e400 and 1e401 are observed, both violate the cap, only the probe is non-dominated, 1e-10 to 1e400 keeps an engine elasticity near 2.44e409, and two seeds of benefit 1e308 or of the smallest subnormal, and a subnormal wallet, average to that value, and end money 1e308 to -1e308 keeps elasticity 1, and three seeds of the largest double average to it.
 * @evidence ./experiment.ts#runExperiment Compares engine amounts for constraints, Pareto, and elasticity.
 * @evidenceReview ./experiment.ts#runExperiment #d010bfd The function keeps money as engine amounts, checks constraints with the engine order, ranks each Pareto objective by that order, and divides money changes in the engine.
 */
export function keepsLargeEngineAmounts(): void {
  const engine = createBreakInfinityEngine();
  const huge = defineModelFactory({
    id: "huge-income",
    version: 1,
    paramsSchema: zodStandardSchema(z.object({ exponent: z.number().int(), offset: z.number().int().optional() })),
    create(params: { exponent: number; offset?: number }) {
      return {
        id: "huge-income",
        version: 1,
        income: (ctx: { unit: { code: string } }) => ({
          unit: ctx.unit,
          amount: new Decimal(`1e${params.exponent + (params.offset ?? 0)}`),
        }),
        actions: () => [],
      };
    },
  });
  const scenario = incomeScenario({ model: { id: "huge-income", version: 1, params: { exponent: 400 } }, strategy: undefined });
  const spec = specFor(scenario, {
    model: { id: "huge-income", version: 1 },
    strategy: undefined,
    metricId: "endMoney",
    goal: undefined,
    objectives: [{ id: "money", metricId: "endMoney", sense: "higher" }],
    constraints: [{ id: "cap", metricId: "endMoney", op: "lte", limit: 1e300 }],
    dimensions: [
      { id: "exponent", target: "model", path: "exponent", space: { kind: "int", min: 300, max: 500 }, baseline: 400, probes: [401] },
    ],
    budget: { candidates: 2, seeds: 1 },
    horizonSec: 1,
  });
  const artifact = runExperiment({
    spec,
    scenario,
    modelRegistry: createModelRegistry([huge]),
    strategyRegistry: createStrategyRegistry([]),
    engine,
    engineId: "breakInfinity",
    engineVersion: "1",
    effectiveRunHash: "large-amounts",
  });
  const money = (id: string) => artifact.candidates.find((candidate) => candidate.id === id)?.metrics[0];
  expect(money("baseline")).toEqual({ metricId: "endMoney", status: "observed", value: engine.toString(engine.from("1e400")) });
  expect(money("oat:exponent:401")).toEqual({ metricId: "endMoney", status: "observed", value: engine.toString(engine.from("1e401")) });
  expect(artifact.candidates.map((candidate) => candidate.constraintViolations)).toEqual([["cap"], ["cap"]]);
  expect(artifact.pareto).toEqual({ sense: "per-metric", nonDominated: ["oat:exponent:401"], uncompared: [] });
  const row = artifact.elasticities[0]!;
  expect(row).toMatchObject({ status: "observed", direction: "higher" });
  // (1e401 - 1e400) / 1e400 is 9, over a parameter change of 1/400.
  expect(Number(row.elasticity)).toBeCloseTo(3600, 6);
  // 1e-10 to 1e400 is a relative change near 1e410, over a parameter change of 4.1. The elasticity stays in the engine.
  // The baseline stays above the engine order epsilon of 1e-12, so it is a positive amount.
  const tiny = incomeScenario({ model: { id: "huge-income", version: 1, params: { exponent: 100, offset: -110 } }, strategy: undefined });
  const wide = runExperiment({
    spec: specFor(tiny, {
      model: { id: "huge-income", version: 1 },
      strategy: undefined,
      metricId: "endMoney",
      goal: undefined,
      dimensions: [
        { id: "exponent", target: "model", path: "exponent", space: { kind: "int", min: 1, max: 1000 }, baseline: 100, probes: [510] },
      ],
      budget: { candidates: 2, seeds: 1 },
      horizonSec: 1,
    }),
    scenario: tiny,
    modelRegistry: createModelRegistry([huge]),
    strategyRegistry: createStrategyRegistry([]),
    engine,
    engineId: "breakInfinity",
    engineVersion: "1",
    effectiveRunHash: "wide-ratio",
  });
  const wideRow = wide.elasticities[0]!;
  expect(wideRow).toMatchObject({ status: "observed", direction: "higher" });
  expect(engine.absLog10(engine.from(wideRow.elasticity!))).toBeCloseTo(410 - Math.log10(4.1), 6);
  // Two seeds of benefit 1e308 average to 1e308: summing first would overflow to Infinity.
  // Two seeds of the smallest subnormal average to itself: dividing first would round each term to 0.
  const benefit = defineModelFactory({
    id: "edge-benefit",
    version: 1,
    create(params: { value: number }) {
      return {
        id: "edge-benefit",
        version: 1,
        income: (ctx: { unit: { code: string } }) => ({ unit: ctx.unit, amount: 0 }),
        evolve: (_ctx: unknown, state: SimState<number, string, { benefit?: number }>) => ({ ...state, vars: { ...state.vars, benefit: params.value } }),
        actions: () => [],
      };
    },
  });
  const averageOf = (value: number, metricId: "varBenefit" | "endMoney" = "varBenefit", wallet = "0", seeds = [1, 2]) => {
    const edge = incomeScenario({
      model: { id: "edge-benefit", version: 1, params: { value } },
      initial: { wallet: { unit: "COIN", amount: wallet } },
      strategy: undefined,
    });
    return runExperiment({
      spec: specFor(edge, {
        model: { id: "edge-benefit", version: 1 },
        strategy: undefined,
        metricId,
        goal: undefined,
        dimensions: [],
        seeds,
        budget: { candidates: 1, seeds: seeds.length },
        horizonSec: 1,
      }),
      scenario: edge,
      modelRegistry: createModelRegistry([benefit]),
      strategyRegistry: createStrategyRegistry([]),
      engine: createNumberEngine(),
      engineId: "number",
      engineVersion: "1",
      effectiveRunHash: "edge-benefit",
    }).candidates[0]?.metrics;
  };
  expect(averageOf(1e308)).toEqual([{ metricId: "varBenefit", status: "observed", value: String(1e308) }]);
  expect(averageOf(Number.MIN_VALUE)).toEqual([{ metricId: "varBenefit", status: "observed", value: String(Number.MIN_VALUE) }]);
  // The engine money mean also sums first: a wallet of the smallest subnormal on two seeds averages to itself.
  expect(averageOf(0, "endMoney", String(Number.MIN_VALUE))).toEqual([{ metricId: "endMoney", status: "observed", value: String(Number.MIN_VALUE) }]);
  // Three seeds of the largest double: adding thirds would round back to Infinity, so the fallback scales by the largest magnitude.
  expect(averageOf(Number.MAX_VALUE, "varBenefit", "0", [1, 2, 3])).toEqual([{ metricId: "varBenefit", status: "observed", value: String(Number.MAX_VALUE) }]);
  expect(averageOf(0, "endMoney", String(Number.MAX_VALUE), [1, 2, 3])).toEqual([{ metricId: "endMoney", status: "observed", value: String(Number.MAX_VALUE) }]);
  // End money 1e308 and -1e308 differ by more than the double range. The ratio -2 over a parameter ratio -2 is 1.
  const signed = incomeScenario({ model: { id: "tiny-income", version: 1, params: { amount: 1e308 } }, strategy: undefined });
  const flipped = runExperiment({
    spec: specFor(signed, {
      model: { id: "tiny-income", version: 1 },
      strategy: undefined,
      metricId: "endMoney",
      goal: undefined,
      dimensions: [
        { id: "amount", target: "model", path: "amount", space: { kind: "number", min: -1e308, max: 1e308 }, baseline: 1e308, probes: [-1e308] },
      ],
      budget: { candidates: 2, seeds: 1 },
      horizonSec: 1,
    }),
    scenario: signed,
    modelRegistry: createModelRegistry([tinyIncomeFactory()]),
    strategyRegistry: createStrategyRegistry([]),
    engine: createNumberEngine(),
    engineId: "number",
    engineVersion: "1",
    effectiveRunHash: "signed-money",
  });
  expect(flipped.candidates.map((candidate) => candidate.metrics[0]?.value)).toEqual([String(1e308), String(-1e308)]);
  expect(flipped.elasticities[0]).toMatchObject({ status: "observed", elasticity: "1", absoluteChange: null, direction: "lower" });
}

describe("parameter experiments", () => {
  it("checks local elasticity direction", checksLocalElasticityDirection);
  it("keeps the strategy tune signature", keepsStrategyTuneSignature);
  it("rejects unsafe parameters before a run", rejectsUnsafeParametersBeforeRun);
  it("keeps candidate order and the input scenario", keepsCandidateOrderAndScenario);
  it("skips a censored horizon for sensitivity", skipsCensoredHorizonForSensitivity);
  it("matches the hand Pareto front", matchesHandPareto);
  it("starts candidates from the scenario", startsCandidatesFromScenario);
  it("keeps large engine amounts", keepsLargeEngineAmounts);
});
