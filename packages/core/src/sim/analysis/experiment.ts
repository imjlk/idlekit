import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import type { ModelRegistry } from "../../scenario/registry";
import type { StandardSchema } from "../../scenario/validate";
import { canonicalJson, sha256Text } from "../../scenario/scenarioContract";
import { createRunFactory, type ExecutionPlan } from "../runFactory";
import { runScenario } from "../simulator";
import type { StrategyRegistry } from "../strategy/registry";
import type { CompiledScenario, Model, SimState } from "../types";
import {
  assignmentFitsParamSpace,
  localElasticity,
  paretoFront,
  type ParetoPoint,
} from "./sensitivity";

/**
 * Experiment spec v1.
 * Separate from ScenarioV1 and from strategy-only TuneSpecV1.
 * The first method is a fixed candidate sweep plus one-at-a-time local sensitivity.
 */

const EXPERIMENT_ALGORITHM_VERSION = "experiment-oat-v1" as const;
const EXPERIMENT_ESTIMATOR_VERSION = "one-at-a-time-local-v1" as const;
const EXPERIMENT_SCHEMA_ID = "https://idlekit.dev/schemas/experiment.v1.schema.json" as const;
const EXPERIMENT_METHOD = "fixed-sweep-and-one-at-a-time" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature TuneSpec stays strategy-only. The experiment spec is a separate object.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature #365035c Re-read the section: strategy tune still scores seeds 7 and 11 as 9, and the experiment spec is not a TuneSpec.
 */
export const experimentSeparateSpec = "experiment-spec-not-tunespec" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter Assignment uses a registered identifier path and the model or strategy schema. JSONPath, prototype, and eval paths are refused before a run.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter #a9ad2ba Re-read the section: a prototype path, an out-of-range integer, and a schema-invalid rate throw before model create.
 */
export const experimentRegisteredSetter = "registered-key-not-jsonpath" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity Constant income reaches T/p. Local elasticity is signed and is not a Sobol or global index.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity #253b8c6 Re-read the section: rate 2 reaches in 5 with elasticity -0.5, rate 0.5 reaches in 20 with elasticity -2, and maxPicks stays flat.
 */
export const experimentLocalOat = "one-at-a-time-local-not-sobol" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order Candidate order does not change the report, and the input scenario object is not written.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order #b77cabc Re-read the section: reversed candidate ids keep the same effective hash and the scenario JSON is unchanged.
 */
export const experimentCandidateOrder = "sorted-candidates-unmutated-scenario" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon A goal missed inside the horizon stays censored. That time is not the horizon and is not differentiated.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon #988285f Re-read the section: horizon 9 with target 10 leaves the reach time null, not 9.
 */
export const experimentCensoredHorizon = "censored-time-not-horizon" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown Pareto keeps per-metric tradeoffs. An unknown objective is uncompared, not a win.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown #b316c8c Re-read the section: A, B, and C are non-dominated, D is dominated, and E is uncompared.
 */
export const experimentParetoUnknown = "unknown-is-not-superior" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor Each task records its id, parameter JSON, logical seed, and engine and model versions. It does not store a function.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #9da008d Re-read the section: the income candidate changes incomeRate and the policy candidate changes maxPicks on the same seed.
 */
export const experimentTaskDescriptor = "task-id-params-seed-version" as const;

const WARNINGS = [
  "one-at-a-time local sensitivity is not global sensitivity and is not a Sobol index",
  "a censored reach time is not the horizon and is not differentiated",
  "an unknown or censored objective is not a superior Pareto result",
  "constraint violations are listed per metric and are not a weighted score",
] as const;

export function experimentSchemaId(): typeof EXPERIMENT_SCHEMA_ID {
  return EXPERIMENT_SCHEMA_ID;
}

export function experimentAlgorithmVersion(): typeof EXPERIMENT_ALGORITHM_VERSION {
  return EXPERIMENT_ALGORITHM_VERSION;
}

export function experimentEstimatorVersion(): typeof EXPERIMENT_ESTIMATOR_VERSION {
  return EXPERIMENT_ESTIMATOR_VERSION;
}

export class ExperimentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentRejected";
  }
}

export type ExperimentScalar = string | number | boolean | null;

export type ExperimentParamSpace =
  | Readonly<{ kind: "bool" }>
  | Readonly<{ kind: "int"; min: number; max: number }>
  | Readonly<{ kind: "number"; min: number; max: number; scale?: "linear" | "log" }>
  | Readonly<{ kind: "choice"; values: readonly ExperimentScalar[] }>;

export type ExperimentDimensionV1 = Readonly<{
  id: string;
  target: "model" | "strategy" | "session";
  path: string;
  space: ExperimentParamSpace;
  baseline: ExperimentScalar;
  probes?: readonly ExperimentScalar[];
}>;

export type ExperimentAssignmentV1 = Readonly<{
  dimensionId: string;
  value: ExperimentScalar;
}>;

export type ExperimentCandidateV1 = Readonly<{
  id: string;
  assignments: readonly ExperimentAssignmentV1[];
}>;

export type ExperimentMetricId = "timeToMoney" | "endMoney" | "varBenefit";

export type ExperimentObjectiveV1 = Readonly<{
  id: string;
  metricId: ExperimentMetricId;
  sense: "lower" | "higher";
}>;

export type ExperimentConstraintV1 = Readonly<{
  id: string;
  metricId: ExperimentMetricId;
  op: "lte" | "gte";
  limit: number;
}>;

export type ExperimentSpecV1 = Readonly<{
  schemaVersion: 1;
  scenario: Readonly<{ ref: string; hash: string }>;
  model: Readonly<{ id: string; version: number }>;
  strategy?: Readonly<{ id: string }>;
  metricId: ExperimentMetricId;
  goal?: Readonly<{ target: number }>;
  objectives?: readonly ExperimentObjectiveV1[];
  constraints?: readonly ExperimentConstraintV1[];
  dimensions: readonly ExperimentDimensionV1[];
  candidates?: readonly ExperimentCandidateV1[];
  budget: Readonly<{ candidates: number; seeds: number }>;
  seeds: readonly number[];
  horizonSec: number;
  stepSec: number;
  session: Readonly<{ pattern: string; days: number }>;
}>;

export type ExperimentMetricStatus = "observed" | "censored" | "failed" | "rejected";

export type ExperimentTaskV1 = Readonly<{
  taskId: string;
  candidateId: string;
  logicalSeed: number;
  engineId: string;
  engineVersion: string;
  modelId: string;
  modelVersion: number;
  strategyId: string | null;
  modelParams: string;
  strategyParams: string;
  sessionPattern: string;
  sessionDays: number;
  horizonSec: number;
  stepSec: number;
  metricId: ExperimentMetricId;
  status: ExperimentMetricStatus;
  value: string | null;
}>;

export type ExperimentArtifactV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.experiment.v1";
  estimatorVersion: typeof EXPERIMENT_ESTIMATOR_VERSION;
  algorithmVersion: typeof EXPERIMENT_ALGORITHM_VERSION;
  method: typeof EXPERIMENT_METHOD;
  globalSensitivity: false;
  sobol: false;
  scenario: Readonly<{ ref: string; hash: string }>;
  originalSpecHash: string;
  effectiveSpecHash: string;
  effectiveRunHash: string;
  budget: Readonly<{ candidates: number; seeds: number; usedCandidates: number; usedSeeds: number }>;
  tasks: readonly ExperimentTaskV1[];
  candidates: readonly Readonly<{
    id: string;
    metrics: readonly Readonly<{ metricId: ExperimentMetricId; status: ExperimentMetricStatus; value: string | null }>[];
    constraintViolations: readonly string[];
  }>[];
  elasticities: readonly Readonly<{
    dimensionId: string;
    candidateId: string;
    metricId: ExperimentMetricId;
    method: "one-at-a-time-local";
    methodVersion: 1;
    globalSensitivity: false;
    sobol: false;
    status: "observed" | "unavailable";
    elasticity: string | null;
    absoluteChange: string | null;
    direction: "higher" | "lower" | "flat" | "unavailable";
  }>[];
  pareto: Readonly<{
    sense: "per-metric";
    nonDominated: readonly string[];
    uncompared: readonly string[];
  }>;
  warnings: readonly string[];
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateExperimentArtifactValidator: ((input: unknown) => IValidation<ExperimentArtifactV1>) | undefined;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor The generated validator accepts this artifact.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #9da008d Re-read the section: the wire object is experiment v1 and the method is fixed-sweep-and-one-at-a-time.
 */
export const validateExperimentArtifact = (input: unknown): IValidation<ExperimentArtifactV1> =>
  (validateExperimentArtifactValidator ??= typia.createValidate<ExperimentArtifactV1>())(input);

function buildExperimentJsonSchema() {
  return typia.json.schema<ExperimentArtifactV1, "3.1">();
}

let experimentJsonSchemaUnit: ReturnType<typeof buildExperimentJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-tune-signature #365035c Re-read the section: schema version is 3.1 and the contract id is idlekit.experiment.v1.
 */
export function experimentJsonSchema(): ReturnType<typeof buildExperimentJsonSchema> {
  experimentJsonSchemaUnit ??= buildExperimentJsonSchema();
  return experimentJsonSchemaUnit;
}

let validateExperimentSpecValidator: ((input: unknown) => IValidation<ExperimentSpecV1>) | undefined;

export const validateExperimentSpec = (input: unknown): IValidation<ExperimentSpecV1> =>
  (validateExperimentSpecValidator ??= typia.createValidate<ExperimentSpecV1>())(input);

export type ExperimentRunRequest = Readonly<{
  spec: ExperimentSpecV1;
  scenario: unknown;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  engine: Engine<number>;
  engineId: string;
  engineVersion: string;
  effectiveRunHash: string;
}>;

type PreparedCandidate = Readonly<{
  id: string;
  modelParams: Record<string, unknown>;
  strategyParams: Record<string, unknown>;
  sessionPattern: string;
  sessionDays: number;
}>;

type MetricReading = Readonly<{ metricId: ExperimentMetricId; status: ExperimentMetricStatus; value: string | null }>;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BANNED_SEGMENT = new Set(["__proto__", "prototype", "constructor", "eval"]);

function reject(message: string): never {
  throw new ExperimentRejected(`Experiment ${message}`);
}

export function assertRegisteredPath(path: string, target: ExperimentDimensionV1["target"]): readonly string[] {
  if (typeof path !== "string" || path.length === 0 || path !== path.trim()) reject("parameter path is empty");
  if (/[\$\[\]\(\)]/.test(path) || path.includes("..") || path.includes("/") || path.includes("\\") || path.includes(" ")) {
    reject("parameter path is not a registered identifier");
  }
  const parts = path.split(".");
  if (parts.length === 0 || parts.some((part) => !IDENTIFIER.test(part) || BANNED_SEGMENT.has(part))) {
    reject("parameter path is not a registered identifier");
  }
  if (target === "session" && (parts.length !== 1 || (parts[0] !== "pattern" && parts[0] !== "days"))) {
    reject("session path must be pattern or days");
  }
  return parts;
}

export function setRegisteredParam(root: Readonly<Record<string, unknown>>, path: string, value: ExperimentScalar): Record<string, unknown> {
  const parts = assertRegisteredPath(path, "model");
  const clone = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
  let cursor = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = cursor[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[parts[parts.length - 1]!] = value;
  return clone;
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSpec(spec: ExperimentSpecV1): ExperimentSpecV1 {
  return {
    ...spec,
    dimensions: [...spec.dimensions].sort((left, right) => byText(left.id, right.id)),
    ...(spec.candidates
      ? {
          candidates: [...spec.candidates]
            .map((candidate) => ({
              ...candidate,
              assignments: [...candidate.assignments].sort((left, right) => byText(left.dimensionId, right.dimensionId)),
            }))
            .sort((left, right) => byText(left.id, right.id)),
        }
      : {}),
  };
}

function requireSpec(input: ExperimentSpecV1): ExperimentSpecV1 {
  const parsed = validateExperimentSpec(input);
  if (!parsed.success) {
    reject(`spec rejected: ${parsed.errors.map((error) => error.path).join(", ")}`);
  }
  const spec = parsed.data;
  if (!Number.isFinite(spec.horizonSec) || spec.horizonSec <= 0) reject("horizon must be a positive finite number");
  if (!Number.isFinite(spec.stepSec) || spec.stepSec <= 0) reject("step must be a positive finite number");
  if (!Number.isInteger(spec.budget.candidates) || spec.budget.candidates < 1) reject("candidate budget must be a positive integer");
  if (!Number.isInteger(spec.budget.seeds) || spec.budget.seeds < 1) reject("seed budget must be a positive integer");
  if (spec.seeds.length === 0 || spec.seeds.some((seed) => !Number.isFinite(seed))) reject("seeds must be finite");
  if (spec.seeds.length > spec.budget.seeds) reject("seed budget exceeded");
  if (!Number.isFinite(spec.session.days) || spec.session.days <= 0) reject("session days must be positive");
  const ids = new Set<string>();
  for (const dimension of spec.dimensions) {
    if (ids.has(dimension.id)) reject(`duplicate dimension ${dimension.id}`);
    ids.add(dimension.id);
    assertRegisteredPath(dimension.path, dimension.target);
    if (!assignmentFitsParamSpace(dimension.space, dimension.baseline)) reject(`baseline for ${dimension.id} is outside its parameter space`);
    for (const probe of dimension.probes ?? []) {
      if (!assignmentFitsParamSpace(dimension.space, probe)) reject(`probe for ${dimension.id} is outside its parameter space`);
    }
  }
  return spec;
}

function plannedCandidates(spec: ExperimentSpecV1): ExperimentCandidateV1[] {
  const explicit = spec.candidates ?? [];
  const probes = spec.dimensions.some((dimension) => (dimension.probes?.length ?? 0) > 0);
  const generated: ExperimentCandidateV1[] = [];
  if (explicit.length === 0 || probes) {
    const baselineAssignments = spec.dimensions.map((dimension) => ({ dimensionId: dimension.id, value: dimension.baseline }));
    generated.push({ id: "baseline", assignments: baselineAssignments });
    for (const dimension of [...spec.dimensions].sort((left, right) => byText(left.id, right.id))) {
      for (const probe of dimension.probes ?? []) {
        generated.push({
          id: `oat:${dimension.id}:${String(probe)}`,
          assignments: spec.dimensions.map((item) => ({
            dimensionId: item.id,
            value: item.id === dimension.id ? probe : item.baseline,
          })),
        });
      }
    }
  }
  const merged = [...explicit, ...generated].sort((left, right) => byText(left.id, right.id));
  if (merged.length === 0) reject("experiment requires at least one candidate");
  if (merged.length > spec.budget.candidates) reject("candidate budget exceeded");
  const seen = new Set<string>();
  for (const candidate of merged) {
    if (candidate.id.length === 0 || seen.has(candidate.id)) reject(`duplicate candidate ${candidate.id}`);
    seen.add(candidate.id);
  }
  return merged;
}

function enforceSchema(schema: StandardSchema<unknown> | undefined, params: unknown, label: string): unknown {
  if (!schema) return params;
  const result = schema["~standard"].validate(params);
  if (!result.success) {
    reject(`${label} params rejected: ${result.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.value;
}

function prepareCandidate(spec: ExperimentSpecV1, candidate: ExperimentCandidateV1, registries: Pick<ExperimentRunRequest, "modelRegistry" | "strategyRegistry">): PreparedCandidate {
  const dimensions = new Map(spec.dimensions.map((dimension) => [dimension.id, dimension]));
  let modelParams: Record<string, unknown> = {};
  let strategyParams: Record<string, unknown> = {};
  let sessionPattern = spec.session.pattern;
  let sessionDays = spec.session.days;
  const applied = new Set<string>();
  for (const assignment of candidate.assignments) {
    const dimension = dimensions.get(assignment.dimensionId);
    if (!dimension) reject(`unknown dimension ${assignment.dimensionId}`);
    if (applied.has(dimension.id)) reject(`duplicate assignment ${dimension.id}`);
    applied.add(dimension.id);
    assertRegisteredPath(dimension.path, dimension.target);
    if (!assignmentFitsParamSpace(dimension.space, assignment.value)) {
      reject(`value for ${dimension.id} is outside its parameter space`);
    }
    if (dimension.target === "model") modelParams = setRegisteredParam(modelParams, dimension.path, assignment.value);
    else if (dimension.target === "strategy") strategyParams = setRegisteredParam(strategyParams, dimension.path, assignment.value);
    else if (dimension.path === "pattern") {
      if (typeof assignment.value !== "string") reject("session pattern must be a string");
      sessionPattern = assignment.value;
    } else {
      if (typeof assignment.value !== "number") reject("session days must be a number");
      sessionDays = assignment.value;
    }
  }
  for (const dimension of spec.dimensions) {
    if (!applied.has(dimension.id)) reject(`candidate ${candidate.id} omits ${dimension.id}`);
  }
  const modelFactory = registries.modelRegistry.get(spec.model.id, spec.model.version);
  if (!modelFactory) reject(`model not found: ${spec.model.id}@${spec.model.version}`);
  modelParams = enforceSchema(modelFactory.paramsSchema, modelParams, "model") as Record<string, unknown>;
  if (spec.strategy || spec.dimensions.some((dimension) => dimension.target === "strategy")) {
    if (!spec.strategy) reject("strategy id is required");
    const strategyFactory = registries.strategyRegistry.get(spec.strategy.id);
    if (!strategyFactory) reject(`strategy not found: ${spec.strategy.id}`);
    strategyParams = enforceSchema(strategyFactory.paramsSchema, strategyParams, "strategy") as Record<string, unknown>;
  }
  return { id: candidate.id, modelParams, strategyParams, sessionPattern, sessionDays };
}

function metricIds(spec: ExperimentSpecV1): ExperimentMetricId[] {
  const ids = new Set<ExperimentMetricId>([spec.metricId]);
  for (const objective of spec.objectives ?? []) ids.add(objective.metricId);
  for (const constraint of spec.constraints ?? []) ids.add(constraint.metricId);
  return [...ids];
}

function shellScenario(engine: Engine<number>, stepSec: number): CompiledScenario<number, "COIN", Record<string, unknown>> {
  const unit = { code: "COIN" as const };
  const zero = engine.zero();
  const model: Model<number, "COIN", Record<string, unknown>> = {
    id: "experiment-shell",
    version: 0,
    income: () => ({ unit, amount: zero }),
    actions: () => [],
  };
  return {
    ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec },
    model,
    initial: {
      t: 0,
      wallet: { money: { unit, amount: zero }, bucket: zero },
      maxMoneyEver: { unit, amount: zero },
      prestige: { count: 0, points: zero, multiplier: engine.from(1) },
      vars: {},
    },
    run: { stepSec, durationSec: 1, eventLog: { enabled: false, maxEvents: 0 } },
  };
}

function readMoney(amount: unknown): number | null {
  const value = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(value) ? value : null;
}

function readBenefit(vars: unknown): number | null {
  if (vars === null || typeof vars !== "object") return null;
  const value = (vars as { benefit?: unknown }).benefit;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function observeMetrics(
  spec: ExperimentSpecV1,
  end: SimState<number, "COIN", Record<string, unknown>>,
  startT: number,
): MetricReading[] {
  const money = readMoney(end.wallet.money.amount);
  const elapsed = end.t - startT;
  const benefit = readBenefit(end.vars);
  const target = spec.goal?.target;
  return metricIds(spec).map((metricId) => {
    if (metricId === "timeToMoney") {
      if (target === undefined || money === null || money < target) return { metricId, status: "censored", value: null };
      return { metricId, status: "observed", value: String(elapsed) };
    }
    if (metricId === "endMoney") {
      if (money === null) return { metricId, status: "censored", value: null };
      return { metricId, status: "observed", value: String(money) };
    }
    if (benefit === null) return { metricId, status: "censored", value: null };
    return { metricId, status: "observed", value: String(benefit) };
  });
}

function failedMetrics(spec: ExperimentSpecV1): MetricReading[] {
  return metricIds(spec).map((metricId) => ({ metricId, status: "failed", value: null }));
}

function aggregate(spec: ExperimentSpecV1, rows: readonly { seed: number; metrics: readonly MetricReading[] }[], metricId: ExperimentMetricId): MetricReading {
  const picked = rows.map((row) => ({ seed: row.seed, metric: row.metrics.find((metric) => metric.metricId === metricId) }));
  if (picked.some((row) => row.metric === undefined || row.metric.status === "failed")) {
    return { metricId, status: "failed", value: null };
  }
  if (picked.some((row) => row.metric!.status !== "observed" || row.metric!.value === null)) {
    return { metricId, status: "censored", value: null };
  }
  const lowest = [...picked].sort((left, right) => left.seed - right.seed)[0]!;
  return { metricId, status: "observed", value: lowest.metric!.value };
}

function numericValue(reading: MetricReading | undefined): number | null {
  if (!reading || reading.status !== "observed" || reading.value === null) return null;
  const value = Number(reading.value);
  return Number.isFinite(value) ? value : null;
}

function violates(value: number, constraint: ExperimentConstraintV1): boolean {
  return constraint.op === "lte" ? value > constraint.limit : value < constraint.limit;
}

export function runExperiment(request: ExperimentRunRequest): ExperimentArtifactV1 {
  const scenarioHash = sha256Text(canonicalJson(request.scenario));
  if (scenarioHash !== request.spec.scenario.hash) reject("scenario hash does not match the experiment spec");
  const spec = requireSpec(request.spec);
  if (metricIds(spec).includes("timeToMoney")) {
    if (spec.goal === undefined || !Number.isFinite(spec.goal.target)) reject("timeToMoney requires a finite goal target");
  }
  const listed = plannedCandidates(spec);
  const prepared = listed.map((candidate) => prepareCandidate(spec, candidate, request));
  const shell = shellScenario(request.engine, spec.stepSec);
  const bindingFor = createRunFactory({
    models: request.modelRegistry,
    strategies: request.strategyRegistry,
  });
  const tasks: ExperimentTaskV1[] = [];
  const perCandidate: { id: string; rows: { seed: number; metrics: MetricReading[] }[]; prepared: PreparedCandidate }[] = [];

  for (const candidate of prepared) {
    const binding = bindingFor.bind(shell, {
      statefulModel: true,
      model: { id: spec.model.id, version: spec.model.version, params: candidate.modelParams },
    });
    const rows: { seed: number; metrics: MetricReading[] }[] = [];
    for (const seed of spec.seeds) {
      const taskId = `${candidate.id}#${seed}`;
      const plan: ExecutionPlan = {
        contract: "idlekit.execution-plan",
        version: 1,
        stepSec: spec.stepSec,
        durationSec: spec.horizonSec,
        seed,
        ...(spec.strategy ? { strategyId: spec.strategy.id, strategyParams: candidate.strategyParams } : {}),
        eventLog: { enabled: false, maxEvents: 0 },
      };
      let metrics: MetricReading[];
      try {
        const opened = binding.fresh({ trialId: taskId, seed, plan });
        const compiled = opened.scenario;
        const target = spec.goal?.target;
        const result = runScenario({
          ...compiled,
          run: {
            ...compiled.run,
            ...(metricIds(spec).includes("timeToMoney") && target !== undefined
              ? { until: (state: SimState<number, "COIN", Record<string, unknown>>) => (readMoney(state.wallet.money.amount) ?? -1) >= target }
              : {}),
          },
        });
        metrics = observeMetrics(spec, result.end, result.start.t);
      } catch {
        metrics = failedMetrics(spec);
      }
      const primary = metrics.find((metric) => metric.metricId === spec.metricId) ?? failedMetrics(spec)[0]!;
      tasks.push({
        taskId,
        candidateId: candidate.id,
        logicalSeed: seed,
        engineId: request.engineId,
        engineVersion: request.engineVersion,
        modelId: spec.model.id,
        modelVersion: spec.model.version,
        strategyId: spec.strategy?.id ?? null,
        modelParams: canonicalJson(candidate.modelParams),
        strategyParams: canonicalJson(candidate.strategyParams),
        sessionPattern: candidate.sessionPattern,
        sessionDays: candidate.sessionDays,
        horizonSec: spec.horizonSec,
        stepSec: spec.stepSec,
        metricId: spec.metricId,
        status: primary.status,
        value: primary.value,
      });
      rows.push({ seed, metrics });
    }
    perCandidate.push({ id: candidate.id, rows, prepared: candidate });
  }

  const candidates = perCandidate.map((candidate) => {
    const metrics = metricIds(spec).map((metricId) => aggregate(spec, candidate.rows, metricId));
    const constraintViolations = (spec.constraints ?? [])
      .filter((constraint) => {
        const reading = metrics.find((metric) => metric.metricId === constraint.metricId);
        const value = numericValue(reading);
        return value !== null && violates(value, constraint);
      })
      .map((constraint) => constraint.id);
    return { id: candidate.id, metrics, constraintViolations };
  });

  const baseline = candidates.find((candidate) => candidate.id === "baseline");
  const elasticities = baseline
    ? spec.dimensions.flatMap((dimension) =>
        (dimension.probes ?? []).flatMap((probe) => {
          const candidateId = `oat:${dimension.id}:${String(probe)}`;
          const probeCandidate = candidates.find((candidate) => candidate.id === candidateId);
          if (!probeCandidate) return [];
          return metricIds(spec).map((metricId) => {
            const measured = localElasticity({
              baselineP: typeof dimension.baseline === "number" ? dimension.baseline : Number.NaN,
              probeP: typeof probe === "number" ? probe : Number.NaN,
              baselineY: numericValue(baseline.metrics.find((metric) => metric.metricId === metricId)),
              probeY: numericValue(probeCandidate.metrics.find((metric) => metric.metricId === metricId)),
            });
            return {
              dimensionId: dimension.id,
              candidateId,
              metricId,
              method: "one-at-a-time-local" as const,
              methodVersion: 1 as const,
              globalSensitivity: false as const,
              sobol: false as const,
              status: measured.status,
              elasticity: measured.elasticity,
              absoluteChange: measured.absoluteChange,
              direction: measured.direction,
            };
          });
        }),
      )
    : [];

  const objectives = spec.objectives ?? [];
  const pareto =
    objectives.length === 0
      ? { sense: "per-metric" as const, nonDominated: [] as string[], uncompared: [] as string[] }
      : paretoFront(
          candidates.map((candidate): ParetoPoint => ({
            id: candidate.id,
            objectives: objectives.map((objective) => ({
              id: objective.id,
              sense: objective.sense,
              value: numericValue(candidate.metrics.find((metric) => metric.metricId === objective.metricId)),
            })),
          })),
        );

  tasks.sort((left, right) => byText(left.candidateId, right.candidateId) || left.logicalSeed - right.logicalSeed);
  const artifact: ExperimentArtifactV1 = {
    schemaVersion: 1,
    contract: "idlekit.experiment.v1",
    estimatorVersion: EXPERIMENT_ESTIMATOR_VERSION,
    algorithmVersion: EXPERIMENT_ALGORITHM_VERSION,
    method: EXPERIMENT_METHOD,
    globalSensitivity: false,
    sobol: false,
    scenario: spec.scenario,
    originalSpecHash: sha256Text(canonicalJson(request.spec)),
    effectiveSpecHash: sha256Text(canonicalJson(normalizeSpec(spec))),
    effectiveRunHash: request.effectiveRunHash,
    budget: {
      candidates: spec.budget.candidates,
      seeds: spec.budget.seeds,
      usedCandidates: prepared.length,
      usedSeeds: spec.seeds.length,
    },
    tasks,
    candidates: [...candidates].sort((left, right) => byText(left.id, right.id)),
    elasticities,
    pareto,
    warnings: WARNINGS,
  };
  const checked = validateExperimentArtifact(artifact);
  if (!checked.success) reject("artifact failed its own structural validator");
  return artifact;
}
