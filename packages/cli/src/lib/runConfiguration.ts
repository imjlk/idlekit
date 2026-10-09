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
import { deriveDeterministicSeed, hashContent } from "../io/outputMeta";
import { resolveSessionPatternId, resolveSessionPatternSpec } from "./experience";
import { resolveFastMode } from "./fastMode";

/**
 * Resolved CLI run plan. TC-05 has not registered this DTO.
 * The object has no strategy instance, file handle, secret, timestamp, or absolute path.
 * `scenario.engine` is metadata. It does not select the runtime.
 *
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run One plan feeds evaluate stages, and each stage opens a fresh run.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #b541e66 Re-read evaluate's shared-seed exception: fast changes applicable stage digests while the shared seed reads only common fields. Re-read the explicit fast override rule: omission inherits the scenario, false disables it within the stage scope, and disabled effective modes share one identity. Re-read the optional cooldown-anchor input; descriptive save metadata still stays out. Re-read the elapsed-clock exception: the resolved saved clock affects only the report digest, not the seed. Re-read the section: strategy override reaches simulate and experience and replaces the scenario strategy without building it, step stays on the simulate stage unless consistent overrides are set, and the stage digest adds the step and fast mode the stage runs, the session pattern and days experience runs with the always-on and 7-day defaults from resolveSessionPatternSpec, the stage name (not its scope), command inputs, and plugin digests in load order while ignoring the directory. The default seed reads the same identity without the seed, through defaultSeed and defaultRunSeed. The plugin digest values, including the local-import closure, come from loadRegistries in packages/cli/src/plugin/load.ts; this plan only keeps them in load order.
 */
export const resolvedRunContract = "idlekit.resolved-run-configuration" as const;

/**
 * Repro label for this case. The runs pass seed 1 and do not draw from this label.
 *
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run The label is 0x7107. Runs use seed 1.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #b541e66 Re-read evaluate's shared-seed exception: fast changes applicable stage digests while the shared seed reads only common fields. Re-read the explicit fast override rule: omission inherits the scenario, false disables it within the stage scope, and disabled effective modes share one identity. Re-read the optional cooldown-anchor input; descriptive save metadata still stays out. Re-read the elapsed-clock exception: the resolved saved clock affects only the report digest, not the seed. Re-read the section, including the default seed and evaluate seed sentences: the label is not the RNG seed, and the executed tests in runConfiguration.test.ts use seed 1.
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

/** A stage the default seed reads: the inputs it runs with, and the inputs of the run without flags. */
export type SeedStage = Readonly<{ stage: StageName; inputs?: StageInputs; defaults?: StageInputs }>;

export type PreparedRun = Readonly<{
  engine: ResolvedEngine;
  definition: CompiledScenario<number, string, Record<string, unknown>>;
  /**
   * Default seed from the identity of these stages, compared with the run without flags. `base` is
   * the no-flag seed input. One stage reads its whole identity. Several stages share the seed, so
   * they read only what every stage applies.
   */
  defaultSeed: (base: Readonly<Record<string, unknown>>, stages: readonly SeedStage[]) => number;
  /** The same prepared run with this seed in every stage plan. */
  withSeed: (seed: number) => PreparedRun;
  /** `outputs` change only what the stage keeps or reports, so the digest reads them and the default seed does not. */
  open: (
    stage: StageName,
    trialId: string,
    inputs?: StageInputs,
    outputs?: StageInputs,
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

type IdentityArgs = Readonly<{
  scenario: unknown;
  engineId: string;
  strategyId?: string;
  strategyParams?: unknown;
  paramsMode: StrategyParamsMode;
  stepSec: number;
  session?: Readonly<{ id?: string; days?: number }>;
  pluginDigests: readonly string[];
  /** The fast mode the stage runs, from the scenario or an override. */
  fast?: ResolvedRunPlan["fast"];
  stage?: ResolvedRunPlan["stage"];
  inputs?: StageInputs;
}>;

/**
 * What a stage runs, without its seed. Value sources and the stage scope are left out, so a flag
 * that repeats the value that runs gives the same identity.
 */
function runIdentity(args: IdentityArgs): Record<string, unknown> {
  return {
    contract: resolvedRunContract,
    version: 1,
    scenario: args.scenario,
    engineId: args.engineId,
    strategyId: args.strategyId ?? null,
    strategyParams: args.strategyParams ?? null,
    paramsMode: args.paramsMode,
    stepSec: args.stepSec,
    session: args.session ? { id: args.session.id ?? null, days: args.session.days ?? null } : null,
    pluginDigests: [...args.pluginDigests],
    fast: args.fast?.enabled ? args.fast : null,
    stage: args.stage?.name ?? null,
    inputs: args.inputs ?? null,
  };
}

/** Stage digest: the run identity and the seed. Plugin digests keep load order. cwd, scenario path, and generatedAt are left out. */
export function effectiveRunHash(
  args: IdentityArgs & {
    seed?: number;
    cwd?: string;
    scenarioPath?: string;
    generatedAt?: string;
  },
): string {
  void args.cwd;
  void args.scenarioPath;
  void args.generatedAt;
  return hashContent({ ...runIdentity(args), seed: args.seed ?? null });
}

/** The fields every stage of one prepared run applies. A seed that several stages share reads only these. */
const sharedIdentityKeys = ["scenario", "engineId", "strategyId", "strategyParams", "paramsMode", "pluginDigests"] as const;

/**
 * Default seed. `base` is the seed input of the run without flags. Each identity field that differs
 * from that run's is added under `effective`, so flags that repeat what runs keep the no-flag seed,
 * and a flag that changes what runs changes it. Without `defaults` (the run without flags does not
 * resolve) every field is added.
 */
export function defaultRunSeed(args: {
  base: Readonly<Record<string, unknown>>;
  runs: readonly Readonly<{ identity: Readonly<Record<string, unknown>>; defaults?: Readonly<Record<string, unknown>> }>[];
  keys?: readonly string[];
}): number {
  const changed: Record<string, unknown> = {};
  for (const run of args.runs) {
    for (const key of args.keys ?? Object.keys(run.identity)) {
      const value = run.identity[key];
      if (run.defaults === undefined || hashContent(value) !== hashContent(run.defaults[key])) changed[key] = value;
    }
  }
  return deriveDeterministicSeed(Object.keys(changed).length > 0 ? { ...args.base, effective: changed } : args.base);
}

function stageIdentity(
  scenario: ScenarioV1,
  scenarioFast: ResolvedRunPlan["fast"],
  plan: ResolvedRunPlan,
  inputs: StageInputs | undefined,
): IdentityArgs {
  return {
    scenario,
    engineId: plan.engine.effectiveId,
    strategyId: plan.strategy.id,
    strategyParams: plan.strategy.params,
    paramsMode: plan.strategy.paramsMode,
    stepSec: plan.stepSec.value,
    session: plan.session,
    pluginDigests: plan.pluginDigests,
    // A redundant --fast runs the scenario's fast mode, so it keeps the identity.
    fast: plan.fast ?? scenarioFast,
    stage: plan.stage,
    inputs,
  };
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
  const fastOverride = applies.fast && args.fast !== undefined;
  const sessionOverride = args.sessionId !== undefined || args.days !== undefined;
  // The pattern and days the session runs, with the runtime defaults, so flags that repeat them keep the hash.
  const session = applies.session
    ? {
        ...resolveSessionPatternSpec({
          scenario: args.scenario,
          sessionPatternId: resolveSessionPatternId(args.sessionId),
          days: args.days,
        }),
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
      ? { fast: resolveFastMode(args.fast, undefined) }
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
      ? { strategyId: plan.strategy.id, strategyParams: plan.strategy.params, strategyParamsMode: plan.strategy.paramsMode }
      : {}),
    ...(plan.fast !== undefined ? { fast: plan.fast } : {}),
  };
}

/** The scenario model and the plan strategy, each built from its factory. Validated params are not checked again. */
function stageBindOptions(scenario: ScenarioV1, plan: ResolvedRunPlan): RunBindOptions {
  return {
    model: {
      id: scenario.model.id,
      version: scenario.model.version,
      params: scenario.model.params,
    },
    ...(plan.strategy.id !== undefined
      ? { strategy: { id: plan.strategy.id, params: plan.strategy.params, paramsMode: plan.strategy.paramsMode } }
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
  // Each stage builds the plan strategy. An override replaces the scenario strategy, and validated
  // params replace its raw params, so compile does not build the scenario one.
  const { strategy: _replaced, ...withoutStrategy } = args.scenario;
  const planBuildsStrategy = selected.source === "command" || selected.paramsMode === "validated";
  const definition = compileScenario<number, string, Record<string, unknown>>({
    E: engine.engine as Engine<number>,
    scenario: planBuildsStrategy ? withoutStrategy : args.scenario,
    registry: args.modelRegistry,
    strategyRegistry: args.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  // One prepared run per seed shares the engine and the compiled definition.
  const build = (run: PrepareArgs): PreparedRun => {
    const identity = (plan: ResolvedRunPlan, inputs: StageInputs | undefined) =>
      runIdentity(stageIdentity(run.scenario, definition.run.fast, plan, inputs));
    return {
      engine,
      definition,
      defaultSeed(base, stages) {
        const { seed: _seed, ...unseeded } = run;
        // The run without flags: no override, the default engine, and the scenario strategy.
        const plain = {
          scenario: run.scenario,
          modelRegistry: run.modelRegistry,
          strategyRegistry: run.strategyRegistry,
          pluginDigest: run.pluginDigest,
          paramsMode: run.paramsMode,
          engine: resolveEffectiveEngine({ scenarioEngine: run.scenario.engine }),
        };
        return defaultRunSeed({
          base,
          runs: stages.map((entry) => ({
            identity: identity(stagePlan({ ...unseeded, engine, stage: entry.stage }), entry.inputs),
            defaults: (() => {
              try {
                return identity(stagePlan({ ...plain, stage: entry.stage }), entry.defaults);
              } catch {
                // The scenario strategy does not resolve, so no run without flags exists.
                return undefined;
              }
            })(),
          })),
          ...(stages.length > 1 ? { keys: sharedIdentityKeys } : {}),
        });
      },
      withSeed(seed) {
        return build({ ...run, seed });
      },
      open(stage, trialId, inputs, outputs) {
        const plan = stagePlan({ ...run, engine, stage });
        return {
          plan,
          hash: effectiveRunHash({
            ...stageIdentity(run.scenario, definition.run.fast, plan, outputs ? { ...inputs, ...outputs } : inputs),
            seed: plan.seed,
          }),
          isolation: {
            registries: { models: run.modelRegistry, strategies: run.strategyRegistry },
            options: stageBindOptions(run.scenario, plan),
          },
          scenario: openResolvedStage({
            definition,
            plan,
            modelRegistry: run.modelRegistry,
            strategyRegistry: run.strategyRegistry,
            scenario: run.scenario,
            trialId,
          }),
        };
      },
    };
  };
  return build(args);
}
