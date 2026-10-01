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
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-registry-conflicts #4836de8 Re-read the section: a cycle, a duplicate, a missing dependency, and bad params do not call the body.
 */
export const analyzerRegistryConflicts = "fail-before-run" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer A caller registers a metric and an analyzer. Core does not name that metric.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-custom-analyzer #1c2e001 Re-read the section: the caller-owned metric stays outside the builtin list.
 */
export const analyzerCustomRegistration = "caller-metric-and-analyzer" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation A short observation returns insufficient-data and a rerun plan. The growth body is not called.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-insufficient-observation #3499285 Re-read the section: summary coverage does not satisfy a trace demand.
 */
export const analyzerInsufficientObservation = "insufficient-observation-rerun-plan" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget An execution analyzer receives a RunFactory and a budget. A short budget does not start the body.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-execution-budget #db73042 Re-read the section: horizon past the budget is refused, and a zero run budget does not call execute.
 */
export const analyzerExecutionBudget = "explicit-budget-not-silent-run" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm Growth and ETA adapters return the existing algorithm version and the existing numeric value.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-same-algorithm #162ee6f Re-read the section: the growth report is analyzeGrowth, and ETA seconds stay on eta-estimate-v1.
 */
export const analyzerSameAlgorithm = "adapter-keeps-algorithm-version" as const;

/**
 * @evidence docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan The same session, strategy, horizon, and observation semantics share one fresh run. A different horizon does not.
 * @evidenceReview docs/requirements/active/analyzer-registry.md#req-dx02-observation-plan #02c57a5 Re-read the section: cadence is on the execution plan and on provenance, and a different horizon is a second group.
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
}>;

export type FreshRunGrant = Readonly<{ accepted: boolean; plan: ExecutionPlan }>;

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
  cost: AnalyzerCost;
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

export function executionPlanForDemand(semantics: RunSemantics, demand: ObservationDemand): ExecutionPlan {
  const cadence = demand.sampleCadenceSec;
  const everySteps = cadence === null ? 1 : Math.max(1, Math.round(cadence / semantics.stepSec));
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

function assertDefinition(definition: AnalyzerDefinition<any>): void {
  if (definition.id.trim().length === 0 || definition.version.trim().length === 0) {
    throw new AnalyzerRegistryError("analyzer id and version are required");
  }
  if (definition.kind !== "postprocess" && definition.kind !== "execution") {
    throw new AnalyzerRegistryError(`unsupported analyzer kind for ${analyzerKey(definition.id, definition.version)}`);
  }
  if (definition.kind === "postprocess" && !definition.postprocess) {
    throw new AnalyzerRegistryError(`postprocess analyzer ${definition.id} has no postprocess body`);
  }
  if (definition.kind === "execution" && !definition.execute) {
    throw new AnalyzerRegistryError(`execution analyzer ${definition.id} has no execute body`);
  }
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

function groupKey(kind: AnalyzerDefinition["kind"], semantics: RunSemantics, demand: ObservationDemand): string {
  return [
    kind,
    semantics.sessionKey,
    semantics.strategyKey,
    String(semantics.horizonSec),
    String(semantics.stepSec),
    semantics.seed ?? "",
    demand.observationSchema,
    demand.coverage,
    String(demand.windowSec),
    String(demand.sampleCadenceSec),
    [...demand.metricIds].sort().join(","),
  ].join("|");
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
  key: string;
}>;

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
      return map.get(analyzerKey(id, version));
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
  const seen = new Set<string>();
  const requested: AnalyzerDefinition<any>[] = [];
  const params = new Map<string, unknown>();
  const semanticsByKey = new Map<string, RunSemantics>();
  for (const entry of request.requests) {
    const key = analyzerKey(entry.id, entry.version);
    if (seen.has(key)) throw new AnalyzerRegistryError(`duplicate analyzer ${key}`);
    seen.add(key);
    const definition = map.get(key);
    if (!definition) throw new AnalyzerRegistryError(`missing analyzer ${key}`);
    const parsed = definition.validateParams(entry.params);
    if (!parsed.ok) {
      throw new AnalyzerRegistryError(`bad params for ${key}`, parsed.issues);
    }
    requested.push(definition);
    params.set(key, parsed.params);
    semanticsByKey.set(key, entry.semantics ?? request.semantics);
  }

  const ordered: AnalyzerDefinition<any>[] = [];
  const visiting = new Set<string>();
  const visit = (definition: AnalyzerDefinition<any>): void => {
    const key = analyzerKey(definition.id, definition.version);
    if (ordered.some((item) => analyzerKey(item.id, item.version) === key)) return;
    if (visiting.has(key)) throw new AnalyzerRegistryError(`dependency cycle at ${key}`);
    visiting.add(key);
    const dependencies = [...definition.dependencies].sort(compareIdentity);
    for (const dependency of dependencies) {
      const dependencyKey = analyzerKey(dependency.id, dependency.version);
      const next = map.get(dependencyKey);
      if (!next) throw new AnalyzerRegistryError(`missing dependency ${dependencyKey}`);
      if (!params.has(dependencyKey)) {
        const parsed = next.validateParams({});
        if (!parsed.ok) throw new AnalyzerRegistryError(`bad params for ${dependencyKey}`, parsed.issues);
        params.set(dependencyKey, parsed.params);
        semanticsByKey.set(dependencyKey, request.semantics);
      }
      visit(next);
    }
    visiting.delete(key);
    ordered.push(definition);
  };
  for (const definition of [...requested].sort(compareIdentity)) visit(definition);

  const prepared: Prepared[] = ordered.map((definition) => {
    const key = analyzerKey(definition.id, definition.version);
    const itemParams = params.get(key);
    const semantics = semanticsByKey.get(key) ?? request.semantics;
    const demand = resolvedDemand(definition, itemParams);
    return {
      definition,
      params: itemParams,
      semantics,
      demand,
      key: groupKey(definition.kind, semantics, demand),
    };
  });

  const members = new Map<string, string[]>();
  for (const item of prepared) {
    const key = analyzerKey(item.definition.id, item.definition.version);
    const list = members.get(item.key) ?? [];
    list.push(key);
    members.set(item.key, list);
  }
  for (const list of members.values()) list.sort();

  const budget = request.budget ?? null;
  const allowExecution = request.allowExecution === true;
  const groupDecision = new Map<string, "run" | AnalyzerRerunPlan["reason"]>();
  let reserved = 0;
  const groupKeys = [...new Set(prepared.map((item) => item.key))].sort();
  for (const key of groupKeys) {
    const sample = prepared.find((item) => item.key === key);
    if (!sample || sample.definition.kind !== "execution") continue;
    if (!allowExecution || !budget) {
      groupDecision.set(key, "execution-not-requested");
      continue;
    }
    if (
      sample.semantics.horizonSec > budget.maxDurationSec ||
      sample.definition.cost.samples > budget.maxSamples ||
      sample.definition.cost.freshRuns > budget.maxFreshRuns
    ) {
      groupDecision.set(key, "budget");
      continue;
    }
    if (sample.definition.cost.freshRuns > 0 && reserved + 1 > budget.maxFreshRuns) {
      groupDecision.set(key, "budget");
      continue;
    }
    if (sample.definition.cost.freshRuns > 0) reserved += 1;
    groupDecision.set(key, "run");
  }

  const grants = new Map<string, FreshRunGrant>();
  let freshRuns = 0;
  const requestRun = (item: Prepared): FreshRunGrant => {
    const existing = grants.get(item.key);
    if (existing) return existing;
    const plan = executionPlanForDemand(item.semantics, item.demand);
    if (!budget || freshRuns >= budget.maxFreshRuns || item.semantics.horizonSec > budget.maxDurationSec) {
      const refused = { accepted: false, plan } satisfies FreshRunGrant;
      grants.set(item.key, refused);
      return refused;
    }
    freshRuns += 1;
    const accepted = { accepted: true, plan } satisfies FreshRunGrant;
    grants.set(item.key, accepted);
    return accepted;
  };

  const results: AnalyzerResult[] = [];
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

    const capabilityBlock = capabilityStatus(item.definition, request.capabilities);
    if (capabilityBlock) {
      results.push(
        envelope(item.definition, capabilityBlock, null, [`capability ${capabilityBlock}`], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: capabilityBlock === "insufficient-data"
            ? rerunPlan("insufficient-data", item.demand, item.semantics, budget)
            : null,
        }),
      );
      continue;
    }
    if (
      request.availableMetricIds &&
      item.definition.requires.metricIds.some((metricId) => !request.availableMetricIds?.includes(metricId))
    ) {
      results.push(
        envelope(item.definition, "unsupported", null, ["required metric is not registered"], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: null,
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
      results.push(
        envelope(item.definition, body.status, body.value, body.issues ?? [], {
          ...baseProvenance,
          freshRuns: 0,
          rerun: insufficient ? rerunPlan("insufficient-data", item.demand, item.semantics, budget) : null,
        }),
      );
      continue;
    }

    const decision = groupDecision.get(item.key) ?? "execution-not-requested";
    if (decision !== "run") {
      results.push(
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
    results.push(
      envelope(item.definition, body.status, body.value, body.issues ?? [], {
        ...baseProvenance,
        executionPlan: grant?.plan ?? plan,
        freshRuns: grant?.accepted ? 1 : 0,
        rerun: insufficient
          ? rerunPlan(body.status === "insufficient-data" ? "budget" : "insufficient-data", item.demand, item.semantics, budget)
          : null,
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
    dependencies: [],
    execute(params, ctx) {
      const grant = ctx.requestRun("eta");
      if (!grant.accepted) {
        return { status: "insufficient-data", value: null, issues: ["budget"], rerun: true };
      }
      if (!ctx.scenario) {
        return { status: "insufficient-data", value: null, issues: ["missing scenario"], rerun: true };
      }
      const value =
        params.mode === "analytic"
          ? etaAnalytic({ scenario: ctx.scenario, target: params.target })
          : etaSimulate({
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
