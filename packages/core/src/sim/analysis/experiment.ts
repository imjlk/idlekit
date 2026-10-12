import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import { compileScenario } from "../../scenario/compile";
import type { ModelRegistry } from "../../scenario/registry";
import type { ScenarioV1 } from "../../scenario/types";
import type { StandardSchema } from "../../scenario/validate";
import { canonicalJson, sha256Text } from "../../scenario/scenarioContract";
import { createRunFactory, type ExecutionPlan } from "../runFactory";
import { runScenario } from "../simulator";
import type { StrategyRegistry } from "../strategy/registry";
import type { CompiledScenario, SimState } from "../types";
import {
  assignmentFitsParamSpace,
  elasticityFromChange,
  localElasticity,
  paretoFront,
  type LocalElasticity,
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
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-registered-setter #855dbc6 Re-read the section: a prototype path, an out-of-range integer, a schema-invalid rate, a stripped path, overlapping paths, a session dimension, a repeated seed, a non-finite limit, and a repeated constraint id throw before model create.
 */
export const experimentRegisteredSetter = "registered-key-not-jsonpath" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity Constant income reaches T/p. Local elasticity is signed and is not a Sobol or global index.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-local-elasticity #253b8c6 Re-read the section: rate 2 reaches in 5 with elasticity -0.5, rate 0.5 reaches in 20 with elasticity -2, and maxPicks stays flat.
 */
export const experimentLocalOat = "one-at-a-time-local-not-sobol" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order Candidate order does not change the report, and the input scenario object is not written.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-candidate-order #7cede33 Re-read the section: reversed candidate ids keep the same effective hash, the scenario JSON is unchanged, the one compile per experiment brings create to 6, and elasticity rows follow the sorted dimension ids.
 */
export const experimentCandidateOrder = "sorted-candidates-unmutated-scenario" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon A goal missed inside the horizon stays censored. That time is not the horizon and is not differentiated.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-censored-horizon #fae95bf Re-read the section: horizon 9 with target 10 leaves the reach time null, not 9, and the reach time is read on the way while the run continues to the horizon.
 */
export const experimentCensoredHorizon = "censored-time-not-horizon" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown Pareto keeps per-metric tradeoffs. An unknown objective is uncompared, not a win.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-pareto-unknown #54618df Re-read the section: A, B, and C are non-dominated, D is dominated, E is uncompared, and money is compared in the effective engine.
 */
export const experimentParetoUnknown = "unknown-is-not-superior" as const;

/**
 * @evidence docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor Each task records its id, parameter JSON, logical seed, and engine and model versions. It does not store a function.
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #7ab1c92 Re-read the section: the income candidate changes incomeRate and the policy candidate changes maxPicks on the same seed, both from the raw scenario params, and a string probe id is JSON text.
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
 * @evidenceReview docs/requirements/active/parameter-experiments.md#req-pr14-task-descriptor #7ab1c92 Re-read the section: the wire object is experiment v1 and the method is fixed-sweep-and-one-at-a-time.
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

export type ExperimentRunRequest<N = number> = Readonly<{
  spec: ExperimentSpecV1;
  /** The scenario named by `spec.scenario.ref`. Every candidate starts from it. Only the assigned parameters change. */
  scenario: ScenarioV1;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  /** The effective engine. Amounts stay engine values until they are written as text. */
  engine: Engine<N>;
  engineId: string;
  engineVersion: string;
  effectiveRunHash: string;
}>;

type PreparedCandidate = Readonly<{
  id: string;
  modelParams: unknown;
  strategyParams: unknown;
  sessionPattern: string;
  sessionDays: number;
}>;

type CandidateBase = Readonly<{
  modelParams: unknown;
  strategyId: string | null;
  strategyParams: unknown;
}>;

type MetricReading = Readonly<{ metricId: ExperimentMetricId; status: ExperimentMetricStatus; value: string | null }>;

/** An observed money reading keeps its engine amount. Time and benefit keep a number. */
type Reading<N> = MetricReading & Readonly<{ amount?: N; num?: number }>;

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
    // assertRegisteredPath already bans these. The inline guard keeps the write visibly safe at the assignment.
    if (key === "__proto__" || key === "constructor" || key === "prototype") reject("parameter path is not a registered identifier");
    const next = Object.prototype.hasOwnProperty.call(cursor, key) ? cursor[key] : undefined;
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  const leaf = parts[parts.length - 1]!;
  if (leaf === "__proto__" || leaf === "constructor" || leaf === "prototype") reject("parameter path is not a registered identifier");
  cursor[leaf] = value;
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

/** Two dimensions on one target overlap when one path equals the other or is a dotted prefix of it. */
function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
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
  if (new Set(spec.seeds).size !== spec.seeds.length) reject("seeds must be unique logical seeds");
  if (spec.seeds.length > spec.budget.seeds) reject("seed budget exceeded");
  if (!Number.isFinite(spec.session.days) || spec.session.days <= 0) reject("session days must be positive");
  const ids = new Set<string>();
  for (const [index, dimension] of spec.dimensions.entries()) {
    if (ids.has(dimension.id)) reject(`duplicate dimension ${dimension.id}`);
    ids.add(dimension.id);
    assertRegisteredPath(dimension.path, dimension.target);
    // Each candidate runs one continuous horizon. No session schedule is executed, so a session value would not reach the run.
    if (dimension.target === "session") reject(`session dimension ${dimension.id} is not executed: each candidate runs one continuous horizon`);
    for (const other of spec.dimensions.slice(0, index)) {
      if (other.target === dimension.target && pathsOverlap(other.path, dimension.path)) {
        reject(`dimensions ${other.id} and ${dimension.id} target the same ${dimension.target} parameter`);
      }
    }
    if (!assignmentFitsParamSpace(dimension.space, dimension.baseline)) reject(`baseline for ${dimension.id} is outside its parameter space`);
    for (const probe of dimension.probes ?? []) {
      if (!assignmentFitsParamSpace(dimension.space, probe)) reject(`probe for ${dimension.id} is outside its parameter space`);
    }
  }
  // A violation lists only the constraint id, so the id must name one constraint. A JSON literal such as 1e400 parses to Infinity.
  const constraintIds = new Set<string>();
  for (const constraint of spec.constraints ?? []) {
    if (constraintIds.has(constraint.id)) reject(`duplicate constraint ${constraint.id}`);
    constraintIds.add(constraint.id);
    if (!Number.isFinite(constraint.limit)) reject(`constraint ${constraint.id} limit must be finite`);
  }
  return spec;
}

/**
 * Generated probe id. A string probe is written as JSON text, so `1` and `"1"`, or `true` and `"true"`, stay distinct.
 * A number, boolean, or null probe is written as its plain text.
 */
function probeCandidateId(dimension: ExperimentDimensionV1, probe: ExperimentScalar): string {
  return `oat:${dimension.id}:${typeof probe === "string" ? JSON.stringify(probe) : String(probe)}`;
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
          id: probeCandidateId(dimension, probe),
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

/**
 * Checks the candidate params like scenario compile does in legacy-raw mode. The schema output only confirms
 * that every assigned path is registered: a schema that strips that path would leave the run at its default
 * while the task claims the assignment. The candidate keeps the raw params, so unassigned fields stay as the
 * scenario wrote them and `create` receives the same representation as a scenario run.
 */
function checkCandidateParams(
  schema: StandardSchema<unknown> | undefined,
  params: unknown,
  assigned: readonly Readonly<{ dimension: ExperimentDimensionV1; value: ExperimentScalar }>[],
  label: string,
): void {
  if (!schema) return;
  const result = schema["~standard"].validate(params);
  if (!result.success) {
    reject(`${label} params rejected: ${result.issues.map((issue) => issue.message).join("; ")}`);
  }
  for (const { dimension } of assigned) {
    let cursor: unknown = result.value;
    for (const part of dimension.path.split(".")) {
      if (cursor === null || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) {
        reject(`${label} params schema does not register ${dimension.path} for ${dimension.id}`);
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
  }
}

function asParamRecord(params: unknown, label: string): Readonly<Record<string, unknown>> {
  if (params === undefined) return {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    reject(`${label} params of the scenario are not an object, so a path cannot be assigned`);
  }
  return params as Readonly<Record<string, unknown>>;
}

function candidateBase(spec: ExperimentSpecV1, scenario: ScenarioV1, registries: Pick<ExperimentRunRequest, "strategyRegistry">): CandidateBase {
  if (scenario.model.id !== spec.model.id || scenario.model.version !== spec.model.version) {
    reject(`model ${spec.model.id}@${spec.model.version} does not match the scenario model ${scenario.model.id}@${scenario.model.version}`);
  }
  const scenarioStrategy = scenario.strategy;
  if (spec.strategy && scenarioStrategy && scenarioStrategy.id !== spec.strategy.id) {
    reject(`strategy ${spec.strategy.id} does not match the scenario strategy ${scenarioStrategy.id}`);
  }
  const strategyId = spec.strategy?.id ?? scenarioStrategy?.id ?? null;
  if (strategyId === null) {
    if (spec.dimensions.some((dimension) => dimension.target === "strategy")) reject("strategy id is required");
    return { modelParams: scenario.model.params, strategyId: null, strategyParams: {} };
  }
  const strategyFactory = registries.strategyRegistry.get(strategyId);
  if (!strategyFactory) reject(`strategy not found: ${strategyId}`);
  return {
    modelParams: scenario.model.params,
    strategyId,
    strategyParams: scenarioStrategy?.params ?? strategyFactory.defaultParams ?? {},
  };
}

function prepareCandidate(
  spec: ExperimentSpecV1,
  base: CandidateBase,
  candidate: ExperimentCandidateV1,
  registries: Pick<ExperimentRunRequest, "modelRegistry" | "strategyRegistry">,
): PreparedCandidate {
  const dimensions = new Map(spec.dimensions.map((dimension) => [dimension.id, dimension]));
  const modelAssigned: { dimension: ExperimentDimensionV1; value: ExperimentScalar }[] = [];
  const strategyAssigned: { dimension: ExperimentDimensionV1; value: ExperimentScalar }[] = [];
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
    if (dimension.target === "model") modelAssigned.push({ dimension, value: assignment.value });
    else if (dimension.target === "strategy") strategyAssigned.push({ dimension, value: assignment.value });
    else reject(`session dimension ${dimension.id} is not executed`);
  }
  for (const dimension of spec.dimensions) {
    if (!applied.has(dimension.id)) reject(`candidate ${candidate.id} omits ${dimension.id}`);
  }
  const assign = (params: unknown, assigned: typeof modelAssigned, label: string): unknown =>
    assigned.length === 0
      ? params
      : assigned.reduce<Record<string, unknown>>(
          (acc, { dimension, value }) => setRegisteredParam(acc, dimension.path, value),
          { ...asParamRecord(params, label) },
        );
  const modelFactory = registries.modelRegistry.get(spec.model.id, spec.model.version);
  if (!modelFactory) reject(`model not found: ${spec.model.id}@${spec.model.version}`);
  const modelParams = assign(base.modelParams, modelAssigned, "model");
  checkCandidateParams(modelFactory.paramsSchema, modelParams, modelAssigned, "model");
  let strategyParams: unknown = {};
  if (base.strategyId !== null) {
    const strategyFactory = registries.strategyRegistry.get(base.strategyId);
    if (!strategyFactory) reject(`strategy not found: ${base.strategyId}`);
    strategyParams = assign(base.strategyParams, strategyAssigned, "strategy");
    checkCandidateParams(strategyFactory.paramsSchema, strategyParams, strategyAssigned, "strategy");
  }
  return { id: candidate.id, modelParams, strategyParams, sessionPattern: spec.session.pattern, sessionDays: spec.session.days };
}

function metricIds(spec: ExperimentSpecV1): ExperimentMetricId[] {
  const ids = new Set<ExperimentMetricId>([spec.metricId]);
  for (const objective of spec.objectives ?? []) ids.add(objective.metricId);
  for (const constraint of spec.constraints ?? []) ids.add(constraint.metricId);
  return [...ids];
}

function readBenefit(vars: unknown): number | null {
  if (vars === null || typeof vars !== "object") return null;
  const value = (vars as { benefit?: unknown }).benefit;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Metrics at the horizon. The reach time is the first committed state at or above the target, read on the way. */
function observeMetrics<N>(
  E: Engine<N>,
  spec: ExperimentSpecV1,
  end: SimState<N, string, Record<string, unknown>>,
  startT: number,
  reachedAt: number | undefined,
): Reading<N>[] {
  const amount = end.wallet.money.amount;
  const benefit = readBenefit(end.vars);
  return metricIds(spec).map((metricId): Reading<N> => {
    if (metricId === "timeToMoney") {
      if (reachedAt === undefined) return { metricId, status: "censored", value: null };
      const elapsed = reachedAt - startT;
      return { metricId, status: "observed", value: String(elapsed), num: elapsed };
    }
    if (metricId === "endMoney") {
      if (!E.isFinite(amount)) return { metricId, status: "censored", value: null };
      return { metricId, status: "observed", value: E.toString(amount), amount };
    }
    if (benefit === null) return { metricId, status: "censored", value: null };
    return { metricId, status: "observed", value: String(benefit), num: benefit };
  });
}

function failedMetrics<N>(spec: ExperimentSpecV1): Reading<N>[] {
  return metricIds(spec).map((metricId) => ({ metricId, status: "failed", value: null }));
}

/**
 * Arithmetic mean over every seed. One failed seed fails the candidate metric and one censored seed censors it,
 * so a mean never mixes a missing draw with observed ones. Money is averaged in the engine.
 */
function aggregate<N>(E: Engine<N>, rows: readonly { seed: number; metrics: readonly Reading<N>[] }[], metricId: ExperimentMetricId): Reading<N> {
  const picked = rows.map((row) => row.metrics.find((metric) => metric.metricId === metricId));
  if (picked.some((metric) => metric === undefined || metric.status === "failed")) {
    return { metricId, status: "failed", value: null };
  }
  if (picked.some((metric) => metric!.status !== "observed" || metric!.value === null)) {
    return { metricId, status: "censored", value: null };
  }
  const observed = picked as Reading<N>[];
  const count = observed.length;
  if (metricId === "endMoney") {
    // Divide before adding so the sum of large finite amounts cannot leave the engine range.
    const mean = observed.reduce((sum, metric) => E.add(sum, E.div(metric.amount as N, count)), E.zero());
    if (!E.isFinite(mean)) return { metricId, status: "censored", value: null };
    return { metricId, status: "observed", value: E.toString(mean), amount: mean };
  }
  const mean = observed.reduce((sum, metric) => sum + (metric.num as number), 0) / count;
  if (!Number.isFinite(mean)) return { metricId, status: "censored", value: null };
  return { metricId, status: "observed", value: String(mean), num: mean };
}

function isObserved<N>(reading: Reading<N> | undefined): reading is Reading<N> {
  return reading !== undefined && reading.status === "observed" && (reading.amount !== undefined || reading.num !== undefined);
}

function compareReadings<N>(E: Engine<N>, left: Reading<N>, right: Reading<N>): number {
  if (left.amount !== undefined && right.amount !== undefined) return E.cmp(left.amount, right.amount);
  const a = left.num as number;
  const b = right.num as number;
  return a < b ? -1 : a > b ? 1 : 0;
}

function violates<N>(E: Engine<N>, reading: Reading<N>, constraint: ExperimentConstraintV1): boolean {
  const order = reading.amount !== undefined
    ? E.cmp(reading.amount, E.from(constraint.limit))
    : (reading.num as number) < constraint.limit ? -1 : (reading.num as number) > constraint.limit ? 1 : 0;
  return constraint.op === "lte" ? order > 0 : order < 0;
}

function readingElasticity<N>(
  E: Engine<N>,
  baselineP: number,
  probeP: number,
  baseline: Reading<N> | undefined,
  probe: Reading<N> | undefined,
): LocalElasticity {
  if (!isObserved(baseline) || !isObserved(probe)) return localElasticity({ baselineP, probeP, baselineY: null, probeY: null });
  if (baseline.amount !== undefined && probe.amount !== undefined) {
    const delta = E.sub(probe.amount, baseline.amount);
    const order = E.cmp(probe.amount, baseline.amount);
    const relative = E.cmp(baseline.amount, E.zero()) > 0 ? E.toNumber(E.divN(delta, baseline.amount)) : null;
    return elasticityFromChange({
      baselineP,
      probeP,
      absoluteChange: E.toString(delta),
      direction: order > 0 ? "higher" : order < 0 ? "lower" : "flat",
      relativeChange: relative,
    });
  }
  return localElasticity({ baselineP, probeP, baselineY: baseline.num ?? null, probeY: probe.num ?? null });
}

/** Dense rank per objective under the metric's own order. Dominance reads only that order, so ranks keep the front. */
function objectiveRanks<N>(E: Engine<N>, readings: readonly (Reading<N> | undefined)[]): (number | null)[] {
  const observed = readings.filter(isObserved).sort((left, right) => compareReadings(E, left, right));
  const ranks = new Map<Reading<N>, number>();
  let rank = 0;
  observed.forEach((reading, index) => {
    if (index > 0 && compareReadings(E, observed[index - 1]!, reading) !== 0) rank += 1;
    ranks.set(reading, rank);
  });
  return readings.map((reading) => (reading !== undefined && ranks.has(reading) ? ranks.get(reading)! : null));
}

export function runExperiment<N>(request: ExperimentRunRequest<N>): ExperimentArtifactV1 {
  const scenarioHash = sha256Text(canonicalJson(request.scenario));
  if (scenarioHash !== request.spec.scenario.hash) reject("scenario hash does not match the experiment spec");
  const spec = requireSpec(request.spec);
  const metrics = metricIds(spec);
  const measuresReach = metrics.includes("timeToMoney");
  if (measuresReach) {
    if (spec.goal === undefined || !Number.isFinite(spec.goal.target)) reject("timeToMoney requires a finite goal target");
  }
  const E = request.engine;
  const base = candidateBase(spec, request.scenario, request);
  const listed = plannedCandidates(spec);
  const prepared = listed.map((candidate) => prepareCandidate(spec, base, candidate, request));
  // The plan builds the strategy, so compile does not build the scenario one.
  const { strategy: _scenarioStrategy, ...withoutStrategy } = request.scenario;
  const compiled = compileScenario<N, string, Record<string, unknown>>({
    E,
    scenario: withoutStrategy,
    registry: request.modelRegistry,
    strategyRegistry: request.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  // Every candidate runs to the spec horizon. A scenario stop condition would cut the horizon metrics short.
  const { until: _scenarioUntil, ...horizonRun } = compiled.run;
  const shared: CompiledScenario<N, string, Record<string, unknown>> = { ...compiled, run: horizonRun };
  const bindingFor = createRunFactory({
    models: request.modelRegistry,
    strategies: request.strategyRegistry,
  });
  const target = measuresReach && spec.goal !== undefined ? E.from(spec.goal.target) : undefined;
  // Stopping at the goal is safe only when no other metric reads the horizon state.
  const stopAtReach = metrics.every((metricId) => metricId === "timeToMoney");
  const tasks: ExperimentTaskV1[] = [];
  const perCandidate: { id: string; rows: { seed: number; metrics: Reading<N>[] }[] }[] = [];

  for (const candidate of prepared) {
    const binding = bindingFor.bind(shared, {
      statefulModel: true,
      model: { id: spec.model.id, version: spec.model.version, params: candidate.modelParams },
    });
    const rows: { seed: number; metrics: Reading<N>[] }[] = [];
    for (const seed of spec.seeds) {
      const taskId = `${candidate.id}#${seed}`;
      const plan: ExecutionPlan = {
        contract: "idlekit.execution-plan",
        version: 1,
        stepSec: spec.stepSec,
        durationSec: spec.horizonSec,
        seed,
        ...(base.strategyId !== null ? { strategyId: base.strategyId, strategyParams: candidate.strategyParams } : {}),
        eventLog: { enabled: false, maxEvents: 0 },
      };
      let readings: Reading<N>[];
      try {
        const opened = binding.fresh({ trialId: taskId, seed, plan });
        const scenario = opened.scenario;
        let reachedAt: number | undefined;
        const result = runScenario({
          ...scenario,
          run: {
            ...scenario.run,
            ...(target !== undefined
              ? {
                  until: (state: SimState<N, string, Record<string, unknown>>) => {
                    if (reachedAt === undefined && E.cmp(state.wallet.money.amount, target) >= 0) reachedAt = state.t;
                    return stopAtReach && reachedAt !== undefined;
                  },
                }
              : {}),
          },
        });
        readings = observeMetrics(E, spec, result.end, result.start.t, reachedAt);
      } catch {
        readings = failedMetrics(spec);
      }
      const primary = readings.find((metric) => metric.metricId === spec.metricId) ?? failedMetrics<N>(spec)[0]!;
      tasks.push({
        taskId,
        candidateId: candidate.id,
        logicalSeed: seed,
        engineId: request.engineId,
        engineVersion: request.engineVersion,
        modelId: spec.model.id,
        modelVersion: spec.model.version,
        strategyId: base.strategyId,
        modelParams: canonicalJson(candidate.modelParams ?? null),
        strategyParams: canonicalJson(candidate.strategyParams ?? null),
        sessionPattern: candidate.sessionPattern,
        sessionDays: candidate.sessionDays,
        horizonSec: spec.horizonSec,
        stepSec: spec.stepSec,
        metricId: spec.metricId,
        status: primary.status,
        value: primary.value,
      });
      rows.push({ seed, metrics: readings });
    }
    perCandidate.push({ id: candidate.id, rows });
  }

  const measured = perCandidate.map((candidate) => {
    const readings = metrics.map((metricId) => aggregate(E, candidate.rows, metricId));
    const constraintViolations = (spec.constraints ?? [])
      .filter((constraint) => {
        const reading = readings.find((metric) => metric.metricId === constraint.metricId);
        return isObserved(reading) && violates(E, reading, constraint);
      })
      .map((constraint) => constraint.id);
    return { id: candidate.id, readings, constraintViolations };
  });

  const baseline = measured.find((candidate) => candidate.id === "baseline");
  const elasticities = baseline
    ? // The normalized order, so reordered dimensions with one effective hash give one artifact.
      [...spec.dimensions].sort((left, right) => byText(left.id, right.id)).flatMap((dimension) =>
        (dimension.probes ?? []).flatMap((probe) => {
          const candidateId = probeCandidateId(dimension, probe);
          const probeCandidate = measured.find((candidate) => candidate.id === candidateId);
          if (!probeCandidate) return [];
          return metrics.map((metricId) => {
            const local = readingElasticity(
              E,
              typeof dimension.baseline === "number" ? dimension.baseline : Number.NaN,
              typeof probe === "number" ? probe : Number.NaN,
              baseline.readings.find((metric) => metric.metricId === metricId),
              probeCandidate.readings.find((metric) => metric.metricId === metricId),
            );
            return {
              dimensionId: dimension.id,
              candidateId,
              metricId,
              method: "one-at-a-time-local" as const,
              methodVersion: 1 as const,
              globalSensitivity: false as const,
              sobol: false as const,
              status: local.status,
              elasticity: local.elasticity,
              absoluteChange: local.absoluteChange,
              direction: local.direction,
            };
          });
        }),
      )
    : [];

  const objectives = spec.objectives ?? [];
  const ranks = objectives.map((objective) =>
    objectiveRanks(E, measured.map((candidate) => candidate.readings.find((metric) => metric.metricId === objective.metricId))),
  );
  const pareto =
    objectives.length === 0
      ? { sense: "per-metric" as const, nonDominated: [] as string[], uncompared: [] as string[] }
      : paretoFront(
          measured.map((candidate, index): ParetoPoint => ({
            id: candidate.id,
            objectives: objectives.map((objective, slot) => ({
              id: objective.id,
              sense: objective.sense,
              value: ranks[slot]![index]!,
            })),
          })),
        );

  const candidates = measured.map((candidate) => ({
    id: candidate.id,
    metrics: candidate.readings.map(({ metricId, status, value }) => ({ metricId, status, value })),
    constraintViolations: candidate.constraintViolations,
  }));
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
