import {
  BREAK_ETERNITY_EXPERIMENTAL_MESSAGE,
  compileScenario,
  createBreakInfinityEngine,
  createNumberEngine,
  createRunFactory,
  strategyCreateParams,
  type CompiledScenario,
  type Engine,
  type ExecutionPlan,
  type ModelRegistry,
  type RunBindOptions,
  type RunFactoryDeps,
  type ScenarioV1,
  type StrategyParamsMode,
  type StrategyRegistry,
} from "@idlekit/core";
import { unknownStrategyError } from "../errors";
import { hashContent } from "../io/outputMeta";

/**
 * Resolved CLI run plan. TC-05 has not registered this DTO.
 * The object has no strategy instance, file handle, secret, timestamp, or absolute path.
 * `scenario.engine` is metadata. It does not select the runtime.
 *
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run One plan feeds evaluate stages, and each stage opens a fresh run.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #ad30c8a Re-read the section: strategy override reaches simulate and experience and replaces the scenario strategy without building it, step stays on the simulate stage unless consistent overrides are set, and the stage digest adds the stage scope, command inputs, and plugin digests in load order while ignoring the directory.
 */
export const resolvedRunContract = "idlekit.resolved-run-configuration" as const;

/**
 * Repro label for this case. The runs pass seed 1 and do not draw from this label.
 *
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run The label is 0x7107. Runs use seed 1.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #ad30c8a Re-read the section, including the evaluate default seed sentence: the label is not the RNG seed, and the three executed tests use seed 1.
 */
export const sessionCaseSeed = 0x7107;

export type StageName = "simulate" | "experience" | "ltv";

export type ValueSource = "scenario" | "command" | "stage";

export type StageApply = Readonly<{
  strategy: boolean;
  step: boolean;
  fast: boolean;
  session: boolean;
}>;

export type TrustedEngineFactory = Readonly<{
  id: string;
  trusted: true;
  create: () => Engine<unknown>;
}>;

export type ResolvedEngine = Readonly<{
  effectiveId: string;
  source: "default" | "flag" | "custom";
  scenarioEngineRole: "metadata";
  scenarioEngine?: Readonly<{ name: string; version?: string }>;
  engine: Engine<unknown>;
}>;

export type ResolvedStrategy = Readonly<{
  id?: string;
  params?: unknown;
  paramsMode: StrategyParamsMode;
  source: "scenario" | "command";
}>;

export type ResolvedRunPlan = Readonly<{
  contract: typeof resolvedRunContract;
  version: 1;
  engine: Readonly<{
    effectiveId: string;
    source: ResolvedEngine["source"];
    scenarioEngineRole: "metadata";
    scenarioEngine?: Readonly<{ name: string; version?: string }>;
  }>;
  strategy: ResolvedStrategy;
  stepSec: Readonly<{ value: number; source: ValueSource }>;
  fast?: NonNullable<CompiledScenario<number, string, Record<string, unknown>>["run"]["fast"]>;
  session?: Readonly<{ id?: string; days?: number; source: "scenario" | "command" }>;
  seed?: number;
  pluginDigests: readonly string[];
  stage: Readonly<{ name: StageName; applies: StageApply }>;
}>;

/** Command inputs outside the plan that change a stage result, such as duration or horizons. */
export type StageInputs = Readonly<Record<string, unknown>>;

export type PreparedRun = Readonly<{
  engine: ResolvedEngine;
  definition: CompiledScenario<number, string, Record<string, unknown>>;
  open: (
    stage: StageName,
    trialId: string,
    inputs?: StageInputs,
  ) => Readonly<{
    scenario: CompiledScenario<number, string, Record<string, unknown>>;
    plan: ResolvedRunPlan;
    /** Digest of this stage: the plan it applied and its command inputs. */
    hash: string;
    /** Registries and bind options that build this stage's model and strategy. Monte Carlo draws rebind with them. */
    isolation: Readonly<{ registries: RunFactoryDeps; options: RunBindOptions }>;
  }>;
}>;

type PrepareArgs = Readonly<{
  scenario: ScenarioV1;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  pluginDigest?: Readonly<Record<string, string>>;
  engineRequest?: string;
  customEngines?: readonly TrustedEngineFactory[];
  strategyOverride?: string;
  stepSec?: number;
  fast?: boolean;
  seed?: number;
  sessionId?: string;
  days?: number;
  consistentOverrides?: boolean;
  paramsMode?: StrategyParamsMode;
}>;

export function stageApply(stage: StageName, consistentOverrides = false): StageApply {
  if (stage === "experience") {
    return {
      strategy: true,
      step: consistentOverrides,
      fast: consistentOverrides,
      session: true,
    };
  }
  return { strategy: true, step: true, fast: true, session: false };
}

/**
 * Digest values in load order, without the absolute paths.
 * A later plugin replaces an earlier one with the same model or strategy id, so the order stays.
 */
export function pluginDigestValues(pluginDigest: Readonly<Record<string, string>> | undefined): readonly string[] {
  return Object.values(pluginDigest ?? {});
}

/**
 * Number stays the default. `scenario.engine` is recorded and not applied.
 * `breakInfinity` is created from its factory. The string `1e400` is not passed through `Number`.
 * `breakEternity` throws. A custom id runs only from a trusted factory the caller already holds.
 */
export function resolveEffectiveEngine(args: {
  requested?: string;
  scenarioEngine?: ScenarioV1["engine"];
  customEngines?: readonly TrustedEngineFactory[];
}): ResolvedEngine {
  const scenarioEngine = args.scenarioEngine
    ? {
        name: args.scenarioEngine.name,
        ...(args.scenarioEngine.version !== undefined ? { version: args.scenarioEngine.version } : {}),
      }
    : undefined;
  const metadata = {
    scenarioEngineRole: "metadata" as const,
    ...(scenarioEngine ? { scenarioEngine } : {}),
  };
  const requested = args.requested?.trim();
  if (!requested) {
    return { ...metadata, effectiveId: "number", source: "default", engine: createNumberEngine() };
  }
  if (requested === "number") {
    return { ...metadata, effectiveId: "number", source: "flag", engine: createNumberEngine() };
  }
  if (requested === "breakEternity") {
    throw new Error(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);
  }
  if (requested === "breakInfinity") {
    return {
      ...metadata,
      effectiveId: "breakInfinity",
      source: "flag",
      engine: createBreakInfinityEngine() as Engine<unknown>,
    };
  }
  const custom = args.customEngines?.find((factory) => factory.trusted && factory.id === requested);
  if (!custom) {
    throw new Error(
      `Unknown engine '${requested}'. Number is the default. breakInfinity can be selected explicitly. Untrusted engines are not loaded.`,
    );
  }
  return { ...metadata, effectiveId: custom.id, source: "custom", engine: custom.create() };
}

export function resolveStrategySelection(args: {
  scenario: ScenarioV1;
  strategyRegistry: StrategyRegistry;
  overrideId?: string;
  paramsMode?: StrategyParamsMode;
}): ResolvedStrategy {
  const mode = args.paramsMode ?? "legacy-raw";
  const overrideId = args.overrideId?.trim();
  if (overrideId) {
    const factory = args.strategyRegistry.get(overrideId);
    if (!factory) throw unknownStrategyError(overrideId);
    const resolved = strategyCreateParams({
      raw: factory.defaultParams ?? {},
      schema: factory.paramsSchema,
      mode,
    });
    return { id: overrideId, params: resolved.params, paramsMode: resolved.mode, source: "command" };
  }
  const selected = args.scenario.strategy;
  if (!selected) return { paramsMode: mode, source: "scenario" };
  const factory = args.strategyRegistry.get(selected.id);
  if (!factory) throw unknownStrategyError(selected.id);
  const resolved = strategyCreateParams({
    raw: selected.params ?? factory.defaultParams ?? {},
    schema: factory.paramsSchema,
    mode,
  });
  return { id: selected.id, params: resolved.params, paramsMode: resolved.mode, source: "scenario" };
}

/** Stage digest. Plugin digests keep load order. cwd, scenario path, and generatedAt are left out. */
export function effectiveRunHash(args: {
  scenario: unknown;
  engineId: string;
  strategyId?: string;
  strategyParams?: unknown;
  paramsMode: StrategyParamsMode;
  stepSec: number;
  session?: Readonly<{ id?: string; days?: number }>;
  seed?: number;
  pluginDigests: readonly string[];
  fast: boolean;
  stage?: ResolvedRunPlan["stage"];
  inputs?: StageInputs;
  cwd?: string;
  scenarioPath?: string;
  generatedAt?: string;
}): string {
  void args.cwd;
  void args.scenarioPath;
  void args.generatedAt;
  return hashContent({
    contract: resolvedRunContract,
    version: 1,
    scenario: args.scenario,
    engineId: args.engineId,
    strategyId: args.strategyId ?? null,
    strategyParams: args.strategyParams ?? null,
    paramsMode: args.paramsMode,
    stepSec: args.stepSec,
    session: args.session ? { id: args.session.id ?? null, days: args.session.days ?? null } : null,
    seed: args.seed ?? null,
    pluginDigests: [...args.pluginDigests],
    fast: args.fast,
    stage: args.stage ?? null,
    inputs: args.inputs ?? null,
  });
}

function stageRunHash(scenario: ScenarioV1, plan: ResolvedRunPlan, inputs: StageInputs | undefined): string {
  return effectiveRunHash({
    scenario,
    engineId: plan.engine.effectiveId,
    strategyId: plan.strategy.id,
    strategyParams: plan.strategy.params,
    paramsMode: plan.strategy.paramsMode,
    stepSec: plan.stepSec.value,
    session: plan.session,
    seed: plan.seed,
    pluginDigests: plan.pluginDigests,
    fast: plan.fast !== undefined,
    stage: plan.stage,
    inputs,
  });
}

/** Digest of a multi-stage run, from each stage digest. */
export function workflowRunHash(stages: Readonly<Record<string, string>>): string {
  return hashContent({ contract: resolvedRunContract, version: 1, stages });
}

function stagePlan(args: PrepareArgs & { engine: ResolvedEngine; stage: StageName }): ResolvedRunPlan {
  const applies = stageApply(args.stage, args.consistentOverrides === true);
  const strategy = resolveStrategySelection({
    scenario: args.scenario,
    strategyRegistry: args.strategyRegistry,
    overrideId: applies.strategy ? args.strategyOverride : undefined,
    paramsMode: args.paramsMode,
  });
  const stepOverride = applies.step && args.stepSec !== undefined;
  const fastOverride = applies.fast && args.fast === true;
  const sessionOverride = args.sessionId !== undefined || args.days !== undefined;
  const session = applies.session
    ? {
        ...(args.sessionId ?? args.scenario.design?.sessionPattern?.id
          ? { id: args.sessionId ?? args.scenario.design?.sessionPattern?.id }
          : {}),
        ...(args.days ?? args.scenario.design?.sessionPattern?.days
          ? { days: args.days ?? args.scenario.design?.sessionPattern?.days }
          : {}),
        source: sessionOverride ? ("command" as const) : ("scenario" as const),
      }
    : undefined;
  return {
    contract: resolvedRunContract,
    version: 1,
    engine: {
      effectiveId: args.engine.effectiveId,
      source: args.engine.source,
      scenarioEngineRole: "metadata",
      ...(args.engine.scenarioEngine ? { scenarioEngine: args.engine.scenarioEngine } : {}),
    },
    strategy,
    stepSec: {
      value: stepOverride ? args.stepSec! : args.scenario.clock.stepSec,
      source: stepOverride ? "command" : "scenario",
    },
    ...(fastOverride
      ? { fast: { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true } }
      : {}),
    ...(session ? { session } : {}),
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    pluginDigests: pluginDigestValues(args.pluginDigest),
    stage: { name: args.stage, applies },
  };
}

function executionPlanFrom(plan: ResolvedRunPlan): ExecutionPlan {
  return {
    contract: "idlekit.execution-plan",
    version: 1,
    stepSec: plan.stepSec.value,
    ...(plan.seed !== undefined ? { seed: plan.seed } : {}),
    ...(plan.strategy.id !== undefined
      ? { strategyId: plan.strategy.id, strategyParams: plan.strategy.params }
      : {}),
    ...(plan.fast !== undefined ? { fast: plan.fast } : {}),
  };
}

/** The scenario model and the plan strategy, each built from its factory. */
function stageBindOptions(scenario: ScenarioV1, plan: ResolvedRunPlan): RunBindOptions {
  return {
    model: {
      id: scenario.model.id,
      version: scenario.model.version,
      params: scenario.model.params,
    },
    ...(plan.strategy.id !== undefined
      ? { strategy: { id: plan.strategy.id, params: plan.strategy.params } }
      : {}),
  };
}

export function openResolvedStage(args: {
  definition: CompiledScenario<number, string, Record<string, unknown>>;
  plan: ResolvedRunPlan;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  scenario: ScenarioV1;
  trialId: string;
}): CompiledScenario<number, string, Record<string, unknown>> {
  const binding = createRunFactory({
    models: args.modelRegistry,
    strategies: args.strategyRegistry,
  }).bind(args.definition, stageBindOptions(args.scenario, args.plan));
  return binding.fresh({
    trialId: args.trialId,
    ...(args.plan.seed !== undefined ? { seed: args.plan.seed } : {}),
    plan: executionPlanFrom(args.plan),
  }).scenario;
}

export function prepareResolvedRun(args: PrepareArgs): PreparedRun {
  const engine = resolveEffectiveEngine({
    requested: args.engineRequest,
    scenarioEngine: args.scenario.engine,
    customEngines: args.customEngines,
  });
  // Reject an unknown strategy before any stage opens.
  const selected = resolveStrategySelection({
    scenario: args.scenario,
    strategyRegistry: args.strategyRegistry,
    overrideId: args.strategyOverride,
    paramsMode: args.paramsMode,
  });
  // An override replaces the scenario strategy, so the scenario one is not built.
  const { strategy: _replaced, ...withoutStrategy } = args.scenario;
  const definition = compileScenario<number, string, Record<string, unknown>>({
    E: engine.engine as Engine<number>,
    scenario: selected.source === "command" ? withoutStrategy : args.scenario,
    registry: args.modelRegistry,
    strategyRegistry: args.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  return {
    engine,
    definition,
    open(stage, trialId, inputs) {
      const plan = stagePlan({ ...args, engine, stage });
      return {
        plan,
        hash: stageRunHash(args.scenario, plan, inputs),
        isolation: {
          registries: { models: args.modelRegistry, strategies: args.strategyRegistry },
          options: stageBindOptions(args.scenario, plan),
        },
        scenario: openResolvedStage({
          definition,
          plan,
          modelRegistry: args.modelRegistry,
          strategyRegistry: args.strategyRegistry,
          scenario: args.scenario,
          trialId,
        }),
      };
    },
  };
}
