import type { AnalysisCapabilityName, AnalysisStatus, CapabilityKnowledge } from "./contracts";
import { analyzeGrowth } from "./growth";
import {
  etaAnalytic,
  etaEstimateAlgorithmVersion,
  etaEstimateSchemaId,
  etaSimulate,
  type ETATarget,
} from "./eta";
import { observationContract } from "../observation";
import { createRunFactory, type ExecutionPlan, type RunFactory } from "../runFactory";
import { runScenario } from "../simulator";
import type { CompiledScenario, RunResult } from "../types";

/**
 * Analyzer registry.
 * ModelAnalysisAdapter stays the model-capability registry.
 * This module wraps growth and ETA. It does not fit growth or divide amounts again.
 * Jev is not an analyzer. This file does not import the CLI, a network stack, or the filesystem.
 */

const GROWTH_ANALYZER_ID = "growth" as const;
const GROWTH_ANALYZER_VERSION = "1" as const;
const GROWTH_ANALYZER_ALGORITHM_VERSION = "growth-report-v1" as const;
const ETA_ANALYZER_ID = "eta" as const;
const ETA_ANALYZER_VERSION = "1" as const;
const GROWTH_OUTPUT_CONTRACT = "idlekit.growth-report.v1" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-registry-conflicts Duplicate ids, cycles, missing dependencies, and bad params fail before a body runs.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-registry-conflicts #315b573 Re-read the section: a cycle, a duplicate, a missing dependency, bad params, an incomplete definition, a fresh-run cost above one, a version with @, and a malformed resolved demand do not call the body, an implied dependency takes its parent's semantics, and a dependent of a failed dependency does not run.
 */
export const analyzerRegistryConflicts = "fail-before-run" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer A caller registers a metric and an analyzer. Core does not name that metric.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer #0eb3cb9 Re-read the section: the caller-owned metric stays outside the builtin list, and a resolved demand names the metrics checked.
 */
export const analyzerCustomRegistration = "caller-metric-and-analyzer" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation A short observation returns insufficient-data and a rerun plan. The growth body is not called.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation #3499285 Re-read the section: summary coverage does not satisfy a trace demand.
 */
export const analyzerInsufficientObservation = "insufficient-observation-rerun-plan" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget An execution analyzer receives a RunFactory and a budget. A short budget does not start the body.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget #d0e5349 Re-read the section: horizon past the budget is refused, a zero run budget does not call execute, samples are reserved across the batch, blocked groups and groups skipped for a failed dependency reserve nothing, a NaN budget throws, missing-scenario is kept, analytic ETA costs no run, and simulated ETA is checked on maxDurationSec.
 */
export const analyzerExecutionBudget = "explicit-budget-not-silent-run" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm Growth and ETA adapters return the existing algorithm version and the existing numeric value.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm #162ee6f Re-read the section: the growth report is analyzeGrowth, and ETA seconds stay on eta-estimate-v1.
 */
export const analyzerSameAlgorithm = "adapter-keeps-algorithm-version" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan The same session, strategy, horizon, and observation semantics share one fresh run. A different horizon does not.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan #c77935d Re-read the section: cadence rounds down onto the execution plan and is on provenance, a cadence without a trace is refused, a different horizon or a sharesRun false definition is a separate group, the key is JSON, group members get one shared RunResult, and blocked peers are not in sharedWith.
 */
export const analyzerObservationPlan = "demand-on-plan-and-provenance" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-plugin-isolation A plugin analyzer is refused before permission. One rejected definition does not drop builtins.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-plugin-isolation #cf67732 Re-read the section: allow-plugin is required, and a duplicate registration is isolated.
 */
export const analyzerPluginIsolation = "permission-before-load-and-isolate-failure" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-local-output JSON and Markdown render the result. The default path does not use a network, and Jev is not registered.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-local-output #ab80c47 Re-read the section: the markdown fence contains the algorithm version, and the builtin ids are eta and growth.
 */
export const analyzerLocalOutput = "json-markdown-local-not-judge" as const;

export const analyzerNotJudge = "analyzer-creates-evidence-judge-interprets" as const;

export function growthAnalyzerAlgorithmVersion(): typeof GROWTH_ANALYZER_ALGORITHM_VERSION {
  return GROWTH_ANALYZER_ALGORITHM_VERSION;
}

export type AnalyzerIdVersion = Readonly<{ id: string; version: string }>;

export type ObservationCoverageDemand = "summary" | "window" | "trace";

export type ObservationDemand = Readonly<{
  windowSec: number | null;
  sampleCadenceSec: number | null;
  coverage: ObservationCoverageDemand;
  metricIds: readonly string[];
  observationSchema: string;
}>;

export type ObservationSupply = Readonly<{
  schema: string;
  windowSec: number | null;
  sampleCadenceSec: number | null;
  coverage: ObservationCoverageDemand | "missing";
  metricIds: readonly string[];
}>;

export type AnalyzerCost = Readonly<{ freshRuns: number; samples: number }>;

export type AnalyzerBudget = Readonly<{
  maxFreshRuns: number;
  maxDurationSec: number;
  maxSamples: number;
}>;

export type RunSemantics = Readonly<{
  sessionKey: string;
  strategyKey: string;
  horizonSec: number;
  stepSec: number;
  seed: number | null;
}>;

export type AnalyzerParamsResult<P> =
  | Readonly<{ ok: true; params: P }>
  | Readonly<{ ok: false; issues: readonly string[] }>;

export type AnalyzerRerunPlan = Readonly<{
  reason: "insufficient-data" | "budget" | "execution-not-requested" | "missing-scenario";
  demand: ObservationDemand;
  semantics: RunSemantics;
  budget: AnalyzerBudget | null;
  note: string;
}>;

export type AnalyzerProvenance = Readonly<{
  demand: ObservationDemand;
  supply: ObservationSupply | null;
  semantics: RunSemantics;
  executionPlan: ExecutionPlan | null;
  groupKey: string;
  sharedWith: readonly string[];
  freshRuns: number;
  budget: AnalyzerBudget | null;
  rerun: AnalyzerRerunPlan | null;
}>;

export type AnalyzerResult = Readonly<{
  schemaVersion: 1;
  id: string;
  version: string;
  algorithmVersion: string;
  outputContract: string;
  status: AnalysisStatus;
  kind: "postprocess" | "execution";
  issues: readonly string[];
  provenance: AnalyzerProvenance;
  value: unknown;
}>;

export type AnalyzerBodyResult = Readonly<{
  status: AnalysisStatus;
  value: unknown;
  issues?: readonly string[];
  rerun?: boolean;
  /** Why a rerun is needed. Omitted is `budget` after a refused grant, otherwise `insufficient-data`. */
  rerunReason?: AnalyzerRerunPlan["reason"];
}>;

type SharedRun = RunResult<number, string, Record<string, unknown>>;

/**
 * `run` opens the group's one fresh run through the caller RunFactory and memoizes it.
 * Every member of the group gets the same RunResult. It is null when the grant was refused,
 * or when the request has no scenario or no RunFactory.
 */
export type FreshRunGrant = Readonly<{ accepted: boolean; plan: ExecutionPlan; run: () => SharedRun | null }>;

export type PostprocessContext = Readonly<{
  demand: ObservationDemand;
  supply: ObservationSupply | null;
  input: unknown;
  plan: ExecutionPlan;
}>;

export type ExecutionContext = Readonly<{
  runFactory: RunFactory | null;
  budget: AnalyzerBudget;
  plan: ExecutionPlan;
  semantics: RunSemantics;
  demand: ObservationDemand;
  scenario: CompiledScenario<number, string, Record<string, unknown>> | null;
  requestRun: (purpose: string) => FreshRunGrant;
}>;

export type AnalyzerDefinition<P = unknown> = Readonly<{
  id: string;
  version: string;
  kind: "postprocess" | "execution";
  validateParams: (input: unknown) => AnalyzerParamsResult<P>;
  requires: Readonly<{
    capabilities: readonly AnalysisCapabilityName[];
    metricIds: readonly string[];
    observationSchema: string;
  }>;
  observation: ObservationDemand;
  resolveDemand?: (params: P) => ObservationDemand;
  outputContract: string;
  algorithmVersion: string;
  /** `freshRuns` is 0 or 1: a group shares at most one fresh run. */
  cost: AnalyzerCost;
  /** The cost of one request, when it depends on params. Omitted is `cost`. */
  resolveCost?: (params: P) => AnalyzerCost;
  /** False when the body runs its own simulation, so its group never holds another analyzer. */
  sharesRun?: boolean;
  dependencies: readonly AnalyzerIdVersion[];
  postprocess?: (params: P, ctx: PostprocessContext) => AnalyzerBodyResult;
  execute?: (params: P, ctx: ExecutionContext) => AnalyzerBodyResult;
}>;

export type AnalyzerRunRequest = Readonly<{
  requests: readonly Readonly<{
    id: string;
    version: string;
    params: unknown;
    semantics?: RunSemantics;
  }>[];
  semantics: RunSemantics;
  supply?: ObservationSupply | null;
  input?: unknown;
  scenario?: CompiledScenario<number, string, Record<string, unknown>> | null;
  runFactory?: RunFactory | null;
  budget?: AnalyzerBudget | null;
  capabilities?: Partial<Record<AnalysisCapabilityName, CapabilityKnowledge>> | null;
  availableMetricIds?: readonly string[] | null;
  allowExecution?: boolean;
}>;

export type AnalyzerBatchResult = Readonly<{
  results: readonly AnalyzerResult[];
  freshRuns: number;
  groupKeys: readonly string[];
}>;

export type AnalyzerRegistry = Readonly<{
  register: (definition: AnalyzerDefinition<any>) => void;
  get: (id: string, version: string) => AnalyzerDefinition<any> | undefined;
  list: () => readonly AnalyzerIdVersion[];
  run: (request: AnalyzerRunRequest) => AnalyzerBatchResult;
}>;

export class AnalyzerRegistryError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = [message]) {
    super(message);
    this.name = "AnalyzerRegistryError";
    this.issues = issues;
  }
}

type Scenario = CompiledScenario<number, string, Record<string, unknown>>;
type GrowthParams = Readonly<{ series: "money" | "netWorth"; windowSec: number }>;
type EtaParams = Readonly<{
  mode: "simulate" | "analytic";
  target: ETATarget;
  maxDurationSec: number;
}>;

const coverageRank: Readonly<Record<ObservationSupply["coverage"], number>> = {
  missing: 0,
  summary: 1,
  window: 2,
  trace: 3,
};

export function analyzerSemantics(overrides: Partial<RunSemantics> = {}): RunSemantics {
  return {
    sessionKey: "none",
    strategyKey: "none",
    horizonSec: 1,
    stepSec: 1,
    seed: null,
    ...overrides,
  };
}

export function observationDemand(overrides: Partial<ObservationDemand> = {}): ObservationDemand {
  return {
    windowSec: null,
    sampleCadenceSec: null,
    coverage: "summary",
    metricIds: [],
    observationSchema: observationContract,
    ...overrides,
  };
}

export function analyzerKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function compareIdentity(left: AnalyzerIdVersion, right: AnalyzerIdVersion): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  if (left.version < right.version) return -1;
  if (left.version > right.version) return 1;
  return 0;
}

export function observationMeets(demand: ObservationDemand, supply: ObservationSupply | null): boolean {
  if (!supply) return false;
  if (supply.schema !== demand.observationSchema) return false;
  if (coverageRank[supply.coverage] < coverageRank[demand.coverage]) return false;
  if (demand.windowSec !== null) {
    if (supply.windowSec === null || supply.windowSec > demand.windowSec) return false;
  }
  if (demand.sampleCadenceSec !== null) {
    if (supply.sampleCadenceSec === null || supply.sampleCadenceSec > demand.sampleCadenceSec) return false;
  }
  for (const metricId of demand.metricIds) {
    if (!supply.metricIds.includes(metricId)) return false;
  }
  return true;
}

// Absorbs float division noise such as 0.3 / 0.1, so an exact multiple is not rounded one step finer.
const cadenceTolerance = 1e-9;

export function executionPlanForDemand(semantics: RunSemantics, demand: ObservationDemand): ExecutionPlan {
  const cadence = demand.sampleCadenceSec;
  // Round down: the traced cadence must not be coarser than the demand. A demand finer than one
  // step still gets every step, and the registry refuses that plan as unable to meet the demand.
  const everySteps =
    cadence === null ? 1 : Math.max(1, Math.floor(cadence / semantics.stepSec + cadenceTolerance));
  const traced = demand.coverage === "window" || demand.coverage === "trace";
  return {
    contract: "idlekit.execution-plan",
    version: 1,
    stepSec: semantics.stepSec,
    durationSec: semantics.horizonSec,
    ...(semantics.seed === null ? {} : { seed: semantics.seed }),
    strategyId: semantics.strategyKey,
    ...(traced ? { trace: { everySteps, keepActionsLog: false } } : {}),
  };
}

function planMeetsDemand(plan: ExecutionPlan, demand: ObservationDemand): boolean {
  if (demand.sampleCadenceSec === null) return true;
  // A cadence with summary coverage gets no trace, so the plan has no samples at that cadence.
  if (!plan.trace) return false;
  const actual = plan.stepSec * (plan.trace.everySteps ?? 1);
  return actual <= demand.sampleCadenceSec * (1 + cadenceTolerance);
}

export function analyzerModuleBoundaryIssues(source: string): readonly string[] {
  const rules: readonly (readonly [RegExp, string])[] = [
    [/from\s+["']@idlekit\/cli["']/, "cli"],
    [/from\s+["'][^"']*\/jev[^"']*["']/, "jev"],
    [/from\s+["']node:fs["']/, "filesystem"],
    [/from\s+["']fs["']/, "filesystem"],
    [/from\s+["']node:https?["']/, "network"],
    [/from\s+["']node:net["']/, "network"],
    [/\bfetch\s*\(/, "network"],
  ];
  return rules.filter(([pattern]) => pattern.test(source)).map(([, issue]) => issue);
}

export function assertAnalyzerPluginsPermitted(allowPlugin: boolean, pluginPaths: readonly string[]): void {
  if (pluginPaths.length > 0 && !allowPlugin) {
    throw new AnalyzerRegistryError(
      "Plugin loading is disabled by default. Pass --allow-plugin true to enable local plugin modules.",
    );
  }
}

export function registerAnalyzerIsolated(registry: AnalyzerRegistry, definition: AnalyzerDefinition<any>): string | null {
  try {
    registry.register(definition);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "analyzer registration failed";
  }
}

export function analyzerResultMarkdown(result: AnalyzerResult): string {
  return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIdentity(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.id) && isVersion(item.version);
}

/** No `@` in a version, so `id@version` splits at its last `@` and two identities never share a key. */
function isVersion(value: unknown): value is string {
  return isNonEmptyString(value) && !value.includes("@");
}

function demandIssues(label: string, value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return [`${label} must be an object`];
  const demand = value as Record<string, unknown>;
  const issues: string[] = [];
  if (demand.windowSec !== null && !isCount(demand.windowSec)) issues.push(`${label}.windowSec must be null or a number`);
  if (demand.sampleCadenceSec !== null && !isCount(demand.sampleCadenceSec)) {
    issues.push(`${label}.sampleCadenceSec must be null or a number`);
  }
  if (demand.coverage !== "summary" && demand.coverage !== "window" && demand.coverage !== "trace") {
    issues.push(`${label}.coverage must be summary, window, or trace`);
  }
  if (!isStringList(demand.metricIds)) issues.push(`${label}.metricIds must be a string list`);
  if (!isNonEmptyString(demand.observationSchema)) issues.push(`${label}.observationSchema must be a string`);
  return issues;
}

/** A group shares one fresh run, so a declared cost above one run could not be honored. */
function costIssues(value: unknown): readonly string[] {
  const cost = value as Record<string, unknown> | null | undefined;
  if (!cost || typeof cost !== "object" || (cost.freshRuns !== 0 && cost.freshRuns !== 1) || !isCount(cost.samples)) {
    return ["cost.freshRuns must be 0 or 1 and cost.samples a number >= 0"];
  }
  return [];
}

/** A plugin definition is a runtime value. Every field `run` reads is checked before the definition is stored. */
function assertDefinition(input: AnalyzerDefinition<any>): void {
  if (!input || typeof input !== "object") throw new AnalyzerRegistryError("analyzer definition must be an object");
  const definition = input as unknown as Record<string, unknown>;
  if (!isNonEmptyString(definition.id) || !isNonEmptyString(definition.version)) {
    throw new AnalyzerRegistryError("analyzer id and version are required");
  }
  if (!isVersion(definition.version)) {
    throw new AnalyzerRegistryError(`analyzer version must not contain @ (${definition.id})`);
  }
  const key = analyzerKey(definition.id, definition.version);
  if (definition.kind !== "postprocess" && definition.kind !== "execution") {
    throw new AnalyzerRegistryError(`unsupported analyzer kind for ${key}`);
  }
  if (definition.kind === "postprocess" && typeof definition.postprocess !== "function") {
    throw new AnalyzerRegistryError(`postprocess analyzer ${definition.id} has no postprocess body`);
  }
  if (definition.kind === "execution" && typeof definition.execute !== "function") {
    throw new AnalyzerRegistryError(`execution analyzer ${definition.id} has no execute body`);
  }
  const issues: string[] = [];
  if (typeof definition.validateParams !== "function") issues.push("validateParams must be a function");
  if (definition.resolveDemand !== undefined && typeof definition.resolveDemand !== "function") {
    issues.push("resolveDemand must be a function");
  }
  if (definition.resolveCost !== undefined && typeof definition.resolveCost !== "function") {
    issues.push("resolveCost must be a function");
  }
  if (definition.sharesRun !== undefined && typeof definition.sharesRun !== "boolean") {
    issues.push("sharesRun must be a boolean");
  }
  const requires = definition.requires as Record<string, unknown> | null | undefined;
  if (!requires || typeof requires !== "object") {
    issues.push("requires must be an object");
  } else {
    if (!isStringList(requires.capabilities)) issues.push("requires.capabilities must be a string list");
    if (!isStringList(requires.metricIds)) issues.push("requires.metricIds must be a string list");
    if (!isNonEmptyString(requires.observationSchema)) issues.push("requires.observationSchema must be a string");
  }
  issues.push(...demandIssues("observation", definition.observation));
  if (!isNonEmptyString(definition.outputContract)) issues.push("outputContract must be a string");
  if (!isNonEmptyString(definition.algorithmVersion)) issues.push("algorithmVersion must be a string");
  issues.push(...costIssues(definition.cost));
  if (!Array.isArray(definition.dependencies) || !definition.dependencies.every(isIdentity)) {
    issues.push("dependencies must be a list of id and version");
  }
  if (issues.length > 0) {
    throw new AnalyzerRegistryError(`incomplete analyzer ${key}: ${issues.join("; ")}`, issues);
  }
}

function sameSemantics(left: RunSemantics, right: RunSemantics): boolean {
  return (
    left.sessionKey === right.sessionKey &&
    left.strategyKey === right.strategyKey &&
    left.horizonSec === right.horizonSec &&
    left.stepSec === right.stepSec &&
    left.seed === right.seed
  );
}

function introducesCycle(map: ReadonlyMap<string, AnalyzerDefinition<any>>, definition: AnalyzerDefinition<any>): boolean {
  const visiting = new Set<string>();
  const visit = (current: AnalyzerDefinition<any>): boolean => {
    const key = analyzerKey(current.id, current.version);
    if (visiting.has(key)) return true;
    visiting.add(key);
    for (const dependency of current.dependencies) {
      const next = map.get(analyzerKey(dependency.id, dependency.version));
      if (!next) continue;
      if (visit(next)) return true;
    }
    visiting.delete(key);
    return false;
  };
  return visit(definition);
}

function resolvedDemand<P>(definition: AnalyzerDefinition<P>, params: P): ObservationDemand {
  return definition.resolveDemand ? definition.resolveDemand(params) : definition.observation;
}

function resolvedCost<P>(definition: AnalyzerDefinition<P>, params: P): AnalyzerCost {
  return definition.resolveCost ? definition.resolveCost(params) : definition.cost;
}

/** JSON of the fields, so a `|` or `,` inside a key cannot make two different groups equal. */
function groupKey(definition: AnalyzerDefinition<any>, semantics: RunSemantics, demand: ObservationDemand): string {
  return JSON.stringify([
    definition.kind,
    semantics.sessionKey,
    semantics.strategyKey,
    semantics.horizonSec,
    semantics.stepSec,
    semantics.seed,
    demand.observationSchema,
    demand.coverage,
    demand.windowSec,
    demand.sampleCadenceSec,
    [...demand.metricIds].sort(),
    definition.sharesRun === false ? analyzerKey(definition.id, definition.version) : null,
  ]);
}

function rerunPlan(
  reason: AnalyzerRerunPlan["reason"],
  demand: ObservationDemand,
  semantics: RunSemantics,
  budget: AnalyzerBudget | null,
): AnalyzerRerunPlan {
  const note =
    reason === "budget"
      ? "refusing a fresh run that exceeds the explicit budget"
      : reason === "execution-not-requested"
        ? "refusing a fresh run that was not requested"
        : reason === "missing-scenario"
          ? "refusing a fresh run without a compiled scenario"
          : "observation does not meet the analyzer demand";
  return { reason, demand, semantics, budget, note };
}

function envelope(
  definition: AnalyzerDefinition<any>,
  status: AnalysisStatus,
  value: unknown,
  issues: readonly string[],
  provenance: AnalyzerProvenance,
): AnalyzerResult {
  return {
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    algorithmVersion: definition.algorithmVersion,
    outputContract: definition.outputContract,
    status,
    kind: definition.kind,
    issues,
    provenance,
    value,
  };
}

type Prepared = Readonly<{
  definition: AnalyzerDefinition<any>;
  params: unknown;
  semantics: RunSemantics;
  demand: ObservationDemand;
  cost: AnalyzerCost;
  key: string;
  block: Block;
}>;

/** Why an item cannot run at all. Decided before any budget is reserved. */
type Block = Readonly<{ status: "unsupported" | "insufficient-data"; issue: string }> | null;

function eligibilityBlock(
  definition: AnalyzerDefinition<any>,
  demand: ObservationDemand,
  request: AnalyzerRunRequest,
): Block {
  const capability = capabilityStatus(definition, request.capabilities);
  if (capability) return { status: capability, issue: `capability ${capability}` };
  // A parameter-resolved demand names the metrics this request reads. The static list is the union.
  const needed = definition.resolveDemand ? demand.metricIds : definition.requires.metricIds;
  const available = request.availableMetricIds;
  if (available && needed.some((metricId) => !available.includes(metricId))) {
    return { status: "unsupported", issue: "required metric is not registered" };
  }
  return null;
}

export function createAnalyzerRegistry(): AnalyzerRegistry {
  const map = new Map<string, AnalyzerDefinition<any>>();
  return {
    register(definition) {
      assertDefinition(definition);
      const key = analyzerKey(definition.id, definition.version);
      if (map.has(key)) throw new AnalyzerRegistryError(`duplicate analyzer ${key}`);
      map.set(key, definition);
      if (introducesCycle(map, definition)) {
        map.delete(key);
        throw new AnalyzerRegistryError(`dependency cycle at ${key}`);
      }
    },
    get(id, version) {
      return isVersion(version) ? map.get(analyzerKey(id, version)) : undefined;
    },
    list() {
      return [...map.values()]
        .map((definition) => ({ id: definition.id, version: definition.version }))
        .sort(compareIdentity);
    },
    run(request) {
      return runRegistered(map, request);
    },
  };
}

function runRegistered(
  map: ReadonlyMap<string, AnalyzerDefinition<any>>,
  request: AnalyzerRunRequest,
): AnalyzerBatchResult {
  // NaN fails every comparison, so an unchecked budget would admit every run.
  const requestBudget = request.budget ?? null;
  if (
    requestBudget &&
    ![requestBudget.maxFreshRuns, requestBudget.maxDurationSec, requestBudget.maxSamples].every(isCount)
  ) {
    throw new AnalyzerRegistryError("budget limits must be finite numbers >= 0");
  }
  const seen = new Set<string>();
  const requested: AnalyzerDefinition<any>[] = [];
  const params = new Map<string, unknown>();
  const semanticsByKey = new Map<string, RunSemantics>();
  for (const entry of request.requests) {
    const key = analyzerKey(entry.id, entry.version);
    if (seen.has(key)) throw new AnalyzerRegistryError(`duplicate analyzer ${key}`);
    seen.add(key);
    const definition = isVersion(entry.version) ? map.get(key) : undefined;
    if (!definition) throw new AnalyzerRegistryError(`missing analyzer ${key}`);
    const parsed = definition.validateParams(entry.params);
    if (!parsed.ok) {
      throw new AnalyzerRegistryError(`bad params for ${key}`, parsed.issues);
    }
    requested.push(definition);
    params.set(key, parsed.params);
    semanticsByKey.set(key, entry.semantics ?? request.semantics);
  }

  // An unrequested dependency runs under the semantics of the analyzer that pulled it in.
  // Two parents with different semantics would need two instances of one id, so that fails here.
  const implicit = new Set<string>();
  const ordered: AnalyzerDefinition<any>[] = [];
  const visiting = new Set<string>();
  const visit = (definition: AnalyzerDefinition<any>): void => {
    const key = analyzerKey(definition.id, definition.version);
    if (ordered.some((item) => analyzerKey(item.id, item.version) === key)) return;
    if (visiting.has(key)) throw new AnalyzerRegistryError(`dependency cycle at ${key}`);
    visiting.add(key);
    const parentSemantics = semanticsByKey.get(key) ?? request.semantics;
    const dependencies = [...definition.dependencies].sort(compareIdentity);
    for (const dependency of dependencies) {
      const dependencyKey = analyzerKey(dependency.id, dependency.version);
      const next = map.get(dependencyKey);
      if (!next) throw new AnalyzerRegistryError(`missing dependency ${dependencyKey}`);
      if (!params.has(dependencyKey)) {
        const parsed = next.validateParams({});
        if (!parsed.ok) throw new AnalyzerRegistryError(`bad params for ${dependencyKey}`, parsed.issues);
        params.set(dependencyKey, parsed.params);
        semanticsByKey.set(dependencyKey, parentSemantics);
        implicit.add(dependencyKey);
      } else if (implicit.has(dependencyKey)) {
        const current = semanticsByKey.get(dependencyKey) ?? request.semantics;
        if (!sameSemantics(current, parentSemantics)) {
          throw new AnalyzerRegistryError(
            `dependency ${dependencyKey} is implied with different semantics; request it with explicit semantics`,
          );
        }
      }
      visit(next);
    }
    visiting.delete(key);
    ordered.push(definition);
  };
  for (const definition of [...requested].sort(compareIdentity)) visit(definition);

  // `ordered` lists dependencies first, so a blocked dependency is known before its dependents.
  const blockByKey = new Map<string, Block>();
  const prepared: Prepared[] = ordered.map((definition) => {
    const key = analyzerKey(definition.id, definition.version);
    const itemParams = params.get(key);
    const semantics = semanticsByKey.get(key) ?? request.semantics;
    const demand = resolvedDemand(definition, itemParams);
    // resolveDemand is plugin code whose result depends on params, so it is checked per request.
    const demandProblems = demandIssues("resolved demand", demand);
    if (demandProblems.length > 0) throw new AnalyzerRegistryError(`bad demand for ${key}`, demandProblems);
    const cost = resolvedCost(definition, itemParams);
    const costProblems = costIssues(cost);
    if (costProblems.length > 0) throw new AnalyzerRegistryError(`bad cost for ${key}`, costProblems);
    const blockedDependency = definition.dependencies
      .map((dependency) => analyzerKey(dependency.id, dependency.version))
      .find((dependencyKey) => blockByKey.get(dependencyKey));
    const dependencyBlock = blockedDependency ? blockByKey.get(blockedDependency) : null;
    const block: Block =
      eligibilityBlock(definition, demand, request) ??
      (dependencyBlock && blockedDependency
        ? { status: dependencyBlock.status, issue: `dependency ${blockedDependency} ${dependencyBlock.status}` }
        : null);
    blockByKey.set(key, block);
    return {
      definition,
      params: itemParams,
      semantics,
      demand,
      cost,
      key: groupKey(definition, semantics, demand),
      block,
    };
  });

  // Only analyzers that can run are members of a group, so a blocked peer is never in sharedWith.
  const members = new Map<string, string[]>();
  for (const item of prepared) {
    if (item.block) continue;
    const key = analyzerKey(item.definition.id, item.definition.version);
    const list = members.get(item.key) ?? [];
    list.push(key);
    members.set(item.key, list);
  }
  for (const list of members.values()) list.sort();

  // Each runnable group reserves one fresh run and its sample cost against the whole batch.
  // The decision is made when the group's first member is reached in dependency order, after its
  // dependencies finished, so a member skipped for a failed dependency reserves nothing.
  // Blocked items reserve nothing either, so neither can take a slot from a later group.
  const budget = request.budget ?? null;
  const allowExecution = request.allowExecution === true;
  const groupDecision = new Map<string, "run" | AnalyzerRerunPlan["reason"]>();
  let reservedRuns = 0;
  let reservedSamples = 0;
  const runGroups = new Set<string>();
  const groupKeys = [...new Set(prepared.map((item) => item.key))].sort();
  const decideGroup = (key: string): "run" | AnalyzerRerunPlan["reason"] => {
    const existing = groupDecision.get(key);
    if (existing) return existing;
    const decision = ((): "run" | AnalyzerRerunPlan["reason"] => {
      const runnable = prepared.filter(
        (item) => item.key === key && item.definition.kind === "execution" && item.block === null,
      );
      const sample = runnable[0];
      if (!sample || !allowExecution || !budget) return "execution-not-requested";
      if (!planMeetsDemand(executionPlanForDemand(sample.semantics, sample.demand), sample.demand)) {
        return "insufficient-data";
      }
      // Costs are 0 or 1 fresh runs (checked at register and on resolveCost): a group holds at most one.
      const runs = Math.max(...runnable.map((item) => item.cost.freshRuns));
      const sampleCost = Math.max(...runnable.map((item) => item.cost.samples));
      if (
        (runs > 0 && sample.semantics.horizonSec > budget.maxDurationSec) ||
        reservedRuns + runs > budget.maxFreshRuns ||
        reservedSamples + sampleCost > budget.maxSamples
      ) {
        return "budget";
      }
      reservedRuns += runs;
      reservedSamples += sampleCost;
      if (runs > 0) runGroups.add(key);
      return "run";
    })();
    groupDecision.set(key, decision);
    return decision;
  };

  const sharedRuns = new Map<string, SharedRun | null>();
  const openSharedRun = (item: Prepared, plan: ExecutionPlan): SharedRun | null => {
    if (sharedRuns.has(item.key)) return sharedRuns.get(item.key) ?? null;
    const scenario = request.scenario ?? null;
    const factory = request.runFactory ?? null;
    let result: SharedRun | null = null;
    if (scenario && factory) {
      const binding = factory.bind(scenario);
      try {
        // strategyKey groups runs. The strategy that runs is the one compiled into the scenario.
        const { strategyId: _strategyKey, ...runPlan } = plan;
        result = runScenario(binding.fresh({ trialId: `analyzer:${item.key}`, plan: runPlan }).scenario);
      } finally {
        binding.release();
      }
    }
    sharedRuns.set(item.key, result);
    return result;
  };

  const grants = new Map<string, FreshRunGrant>();
  let freshRuns = 0;
  const requestRun = (item: Prepared): FreshRunGrant => {
    const existing = grants.get(item.key);
    if (existing) return existing;
    const plan = executionPlanForDemand(item.semantics, item.demand);
    // A group that reserved no fresh run (cost 0) is refused, so an unbudgeted run is never opened.
    if (
      !budget ||
      !runGroups.has(item.key) ||
      freshRuns >= budget.maxFreshRuns ||
      item.semantics.horizonSec > budget.maxDurationSec
    ) {
      const refused = { accepted: false, plan, run: () => null } satisfies FreshRunGrant;
      grants.set(item.key, refused);
      return refused;
    }
    freshRuns += 1;
    const accepted = { accepted: true, plan, run: () => openSharedRun(item, plan) } satisfies FreshRunGrant;
    grants.set(item.key, accepted);
    return accepted;
  };

  const results: AnalyzerResult[] = [];
  const statusByKey = new Map<string, AnalysisStatus>();
  const record = (result: AnalyzerResult): void => {
    statusByKey.set(analyzerKey(result.id, result.version), result.status);
    results.push(result);
  };
  for (const item of prepared) {
    const identity = analyzerKey(item.definition.id, item.definition.version);
    const sharedWith = (members.get(item.key) ?? []).filter((member) => member !== identity);
    const plan = executionPlanForDemand(item.semantics, item.demand);
    const baseProvenance = {
      demand: item.demand,
      supply: request.supply ?? null,
      semantics: item.semantics,
      executionPlan: item.definition.kind === "execution" ? plan : null,
      groupKey: item.key,
      sharedWith,
      budget,
    };

    if (item.block) {
      record(
        envelope(item.definition, item.block.status, null, [item.block.issue], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: item.block.status === "insufficient-data"
            ? rerunPlan("insufficient-data", item.demand, item.semantics, budget)
            : null,
        }),
      );
      continue;
    }

    // A dependency that ran but did not finish ok leaves its dependents without a prerequisite.
    const failedDependency = item.definition.dependencies
      .map((dependency) => analyzerKey(dependency.id, dependency.version))
      .find((dependencyKey) => {
        const status = statusByKey.get(dependencyKey);
        return status !== undefined && status !== "ok";
      });
    if (failedDependency) {
      record(
        envelope(item.definition, "insufficient-data", null, [`dependency ${failedDependency} ${statusByKey.get(failedDependency)}`], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: rerunPlan("insufficient-data", item.demand, item.semantics, budget),
        }),
      );
      continue;
    }

    if (item.definition.kind === "postprocess") {
      const body = item.definition.postprocess?.(item.params, {
        demand: item.demand,
        supply: request.supply ?? null,
        input: request.input,
        plan,
      }) ?? { status: "error" as const, value: null, issues: ["missing postprocess"] };
      const insufficient = body.status === "insufficient-data" || body.rerun === true;
      record(
        envelope(item.definition, body.status, body.value, body.issues ?? [], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: insufficient
            ? rerunPlan(body.rerunReason ?? "insufficient-data", item.demand, item.semantics, budget)
            : null,
        }),
      );
      continue;
    }

    const decision = decideGroup(item.key);
    if (decision !== "run") {
      record(
        envelope(item.definition, "insufficient-data", null, [decision], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: rerunPlan(decision, item.demand, item.semantics, budget),
        }),
      );
      continue;
    }

    const body = item.definition.execute?.(item.params, {
      runFactory: request.runFactory ?? null,
      budget: budget as AnalyzerBudget,
      plan,
      semantics: item.semantics,
      demand: item.demand,
      scenario: request.scenario ?? null,
      requestRun: () => requestRun(item),
    }) ?? { status: "error" as const, value: null, issues: ["missing execute"] };
    const grant = grants.get(item.key);
    const insufficient = body.status === "insufficient-data" || body.rerun === true;
    const reason = body.rerunReason ?? (grant && !grant.accepted ? "budget" : "insufficient-data");
    record(
      envelope(item.definition, body.status, body.value, body.issues ?? [], {
        ...baseProvenance,
        executionPlan: grant?.plan ?? plan,
        freshRuns: grant?.accepted ? 1 : 0,
        rerun: insufficient ? rerunPlan(reason, item.demand, item.semantics, budget) : null,
      }),
    );
  }

  results.sort((left, right) => compareIdentity(left, right));
  return { results, freshRuns, groupKeys };
}

function capabilityStatus(
  definition: AnalyzerDefinition<any>,
  capabilities: AnalyzerRunRequest["capabilities"],
): "unsupported" | "insufficient-data" | null {
  if (!capabilities) return null;
  for (const name of definition.requires.capabilities) {
    const knowledge = capabilities[name] ?? "unknown";
    if (knowledge === "unsupported") return "unsupported";
    if (knowledge === "unknown") return "insufficient-data";
  }
  return null;
}

function validateGrowthParams(input: unknown): AnalyzerParamsResult<GrowthParams> {
  if (!input || typeof input !== "object") return { ok: false, issues: ["growth params must be an object"] };
  const series = (input as { series?: unknown }).series;
  const windowSec = (input as { windowSec?: unknown }).windowSec;
  const issues: string[] = [];
  if (series !== "money" && series !== "netWorth") issues.push("series must be money or netWorth");
  if (typeof windowSec !== "number" || !Number.isFinite(windowSec) || windowSec <= 0) {
    issues.push("windowSec must be a finite number greater than 0");
  }
  if (issues.length > 0) return { ok: false, issues };
  if (series !== "money" && series !== "netWorth") return { ok: false, issues };
  if (typeof windowSec !== "number" || !Number.isFinite(windowSec) || windowSec <= 0) return { ok: false, issues };
  return { ok: true, params: { series, windowSec } };
}

function growthDemand(params: GrowthParams): ObservationDemand {
  return {
    windowSec: params.windowSec,
    sampleCadenceSec: null,
    coverage: "trace",
    metricIds: [params.series],
    observationSchema: observationContract,
  };
}

function isGrowthInput(value: unknown): value is Readonly<{
  run: RunResult<number, string, Record<string, unknown>>;
  scenario?: Scenario;
}> {
  return !!value && typeof value === "object" && "run" in value;
}

function growthDefinition(): AnalyzerDefinition<GrowthParams> {
  return {
    id: GROWTH_ANALYZER_ID,
    version: GROWTH_ANALYZER_VERSION,
    kind: "postprocess",
    validateParams: validateGrowthParams,
    requires: {
      capabilities: ["metrics"],
      metricIds: ["money", "netWorth"],
      observationSchema: observationContract,
    },
    observation: observationDemand({ coverage: "trace", metricIds: ["money", "netWorth"] }),
    resolveDemand: growthDemand,
    outputContract: GROWTH_OUTPUT_CONTRACT,
    algorithmVersion: growthAnalyzerAlgorithmVersion(),
    cost: { freshRuns: 0, samples: 0 },
    dependencies: [],
    postprocess(params, ctx) {
      if (!observationMeets(ctx.demand, ctx.supply)) {
        return { status: "insufficient-data", value: null, issues: ["insufficient observation"], rerun: true };
      }
      if (!isGrowthInput(ctx.input)) {
        return { status: "invalid", value: null, issues: ["growth input is not a run"] };
      }
      return {
        status: "ok",
        value: analyzeGrowth({
          run: ctx.input.run,
          scenario: ctx.input.scenario,
          series: params.series,
          windowSec: params.windowSec,
        }),
      };
    },
  };
}

function validateEtaParams(input: unknown): AnalyzerParamsResult<EtaParams> {
  if (!input || typeof input !== "object") return { ok: false, issues: ["eta params must be an object"] };
  const mode = (input as { mode?: unknown }).mode;
  const maxDurationSec = (input as { maxDurationSec?: unknown }).maxDurationSec;
  const target = (input as { target?: { kind?: unknown; value?: unknown } }).target;
  const issues: string[] = [];
  if (mode !== "simulate" && mode !== "analytic") issues.push("mode must be simulate or analytic");
  if (typeof maxDurationSec !== "number" || !Number.isFinite(maxDurationSec) || maxDurationSec <= 0) {
    issues.push("maxDurationSec must be a finite number greater than 0");
  }
  if (!target || (target.kind !== "money" && target.kind !== "netWorth") || typeof target.value !== "string") {
    issues.push("target must be money or netWorth with a string value");
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    params: {
      mode: mode as EtaParams["mode"],
      maxDurationSec: maxDurationSec as number,
      target: { kind: target!.kind as ETATarget["kind"], value: target!.value as string },
    },
  };
}

function etaDemand(params: EtaParams): ObservationDemand {
  return {
    windowSec: params.maxDurationSec,
    sampleCadenceSec: null,
    coverage: "summary",
    metricIds: [params.target.kind === "money" ? "money" : "netWorth"],
    observationSchema: observationContract,
  };
}

function etaDefinition(): AnalyzerDefinition<EtaParams> {
  return {
    id: ETA_ANALYZER_ID,
    version: ETA_ANALYZER_VERSION,
    kind: "execution",
    validateParams: validateEtaParams,
    requires: {
      capabilities: ["metrics", "goals"],
      metricIds: ["money", "netWorth"],
      observationSchema: observationContract,
    },
    observation: observationDemand({ coverage: "summary", metricIds: ["money", "netWorth"] }),
    resolveDemand: etaDemand,
    outputContract: etaEstimateSchemaId(),
    algorithmVersion: etaEstimateAlgorithmVersion(),
    cost: { freshRuns: 1, samples: 1 },
    // Analytic ETA does not simulate, so it needs no fresh run.
    resolveCost: (params) => (params.mode === "analytic" ? { freshRuns: 0, samples: 0 } : { freshRuns: 1, samples: 1 }),
    // etaSimulate runs its own simulation and stops at the target, so it cannot share a group run.
    sharesRun: false,
    dependencies: [],
    execute(params, ctx) {
      // No grant is requested without a scenario, so a missing scenario does not spend a fresh run.
      if (!ctx.scenario) {
        return {
          status: "insufficient-data",
          value: null,
          issues: ["missing scenario"],
          rerun: true,
          rerunReason: "missing-scenario",
        };
      }
      if (params.mode === "analytic") {
        return { status: "ok", value: etaAnalytic({ scenario: ctx.scenario, target: params.target }) };
      }
      // The simulation runs for maxDurationSec, so that is the duration the budget and horizon must cover.
      if (params.maxDurationSec > ctx.semantics.horizonSec || params.maxDurationSec > ctx.budget.maxDurationSec) {
        return {
          status: "insufficient-data",
          value: null,
          issues: ["maxDurationSec exceeds the run horizon or the duration budget"],
          rerun: true,
          rerunReason: "budget",
        };
      }
      const grant = ctx.requestRun("eta");
      if (!grant.accepted) {
        return { status: "insufficient-data", value: null, issues: ["budget"], rerun: true, rerunReason: "budget" };
      }
      const value = etaSimulate({
        scenario: ctx.scenario,
        target: params.target,
        maxDurationSec: params.maxDurationSec,
      });
      return { status: "ok", value };
    },
  };
}

export function createBuiltinAnalyzerRegistry(): AnalyzerRegistry {
  const registry = createAnalyzerRegistry();
  registry.register(growthDefinition());
  registry.register(etaDefinition());
  return registry;
}

export function runGrowthAnalyzer(args: Readonly<{
  run: RunResult<number, string, Record<string, unknown>>;
  scenario?: Scenario;
  series: "money" | "netWorth";
  windowSec: number;
  supply: ObservationSupply;
  semantics?: RunSemantics;
}>): AnalyzerResult {
  const batch = createBuiltinAnalyzerRegistry().run({
    requests: [
      {
        id: GROWTH_ANALYZER_ID,
        version: GROWTH_ANALYZER_VERSION,
        params: { series: args.series, windowSec: args.windowSec },
      },
    ],
    semantics: args.semantics ?? analyzerSemantics(),
    supply: args.supply,
    input: { run: args.run, scenario: args.scenario },
    allowExecution: false,
  });
  const result = batch.results[0];
  if (!result) throw new AnalyzerRegistryError("growth analyzer produced no result");
  return result;
}

export function runEtaAnalyzer(args: Readonly<{
  scenario: Scenario;
  target: ETATarget;
  mode: "simulate" | "analytic";
  maxDurationSec: number;
  budget: AnalyzerBudget;
  semantics?: RunSemantics;
  runFactory?: RunFactory | null;
}>): AnalyzerResult {
  const batch = createBuiltinAnalyzerRegistry().run({
    requests: [
      {
        id: ETA_ANALYZER_ID,
        version: ETA_ANALYZER_VERSION,
        params: { mode: args.mode, target: args.target, maxDurationSec: args.maxDurationSec },
      },
    ],
    semantics: args.semantics ?? analyzerSemantics({
      horizonSec: args.maxDurationSec,
      stepSec: args.scenario.run.stepSec,
    }),
    scenario: args.scenario,
    budget: args.budget,
    allowExecution: true,
    runFactory: args.runFactory ?? createRunFactory(),
  });
  const result = batch.results[0];
  if (!result) throw new AnalyzerRegistryError("eta analyzer produced no result");
  return result;
}
