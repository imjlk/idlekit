import type { ModelFactory, ModelRegistry } from "../scenario/registry";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import type { StrategyFactory, StrategyRegistry } from "./strategy/registry";
import type { Strategy } from "./strategy/types";
import type { CompiledScenario, Model, SimContext, SimRunOptions, SimState } from "./types";

/**
 * RNG stream for a committed step.
 * `previewStream` is the other stream. Restoring one over the other throws.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation A fresh trial derives this stream from the logical trial id. Preview is not this stream.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #f73792f Re-read the section: this is the committed stream, derived from the logical trial id.
 */
export const executionStream = "execution" as const;

/**
 * RNG stream for preview and rollout.
 * It is not restored onto `executionStream`.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation Preview uses this stream. A committed step does not advance it.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #f73792f Re-read the section: preview is a separate stream and is not restored onto execution.
 */
export const previewStream = "preview" as const;

export type RngStreamName = typeof executionStream | typeof previewStream;

export type RngSnapshot = Readonly<{
  stream: RngStreamName;
  seed: number;
  state: number;
}>;

export type StreamRng = Readonly<{
  stream: RngStreamName;
  next: () => number;
  snapshot: () => RngSnapshot;
  restore: (snapshot: RngSnapshot) => void;
}>;

/**
 * Shareable run input. Cursor, RNG, and event buffers are not part of it.
 * `version` is the contract a later generator can register. TC-05 has not registered it.
 */
export type ExecutionPlan = Readonly<{
  contract: "idlekit.execution-plan";
  version: 1;
  stepSec: number;
  durationSec?: number;
  maxSteps?: number;
  seed?: number;
  strategyId?: string;
  strategyParams?: unknown;
  offline?: SimRunOptions["offline"];
  eventLog?: SimRunOptions["eventLog"];
  trace?: SimRunOptions["trace"];
  fast?: SimRunOptions["fast"];
}>;

export type RunMode = "fresh" | "continue" | "resume";

/**
 * Runner-owned checkpoint. Not part of SimStateJSON.
 * `runner.prestigeReadyAtSec` is the slot for a later cooldown.
 * Old saves omit this object, and readers must not require it.
 * Strategy bytes are `Strategy.snapshotState`, not a second serializer.
 */
export type RunCheckpoint = Readonly<{
  contract: "idlekit.run-checkpoint";
  version: 1;
  trialId: string;
  seed: number;
  mode: RunMode;
  streams: Readonly<{
    execution: RngSnapshot;
    preview: RngSnapshot;
  }>;
  strategy?: Readonly<{
    id: string;
    stateVersion?: number;
    state: unknown;
  }>;
  runner?: Readonly<{
    prestigeReadyAtSec?: number;
  }>;
}>;

export type RunObserverSlot = Readonly<{
  trialId: string;
  buffer: "per-run";
}>;

export type RunInstance<N, U extends string, Vars> = Readonly<{
  mode: RunMode;
  trialId: string;
  seed: number;
  streams: Readonly<{ execution: number; preview: number }>;
  scenario: CompiledScenario<N, U, Vars>;
  rng: StreamRng;
  preview: StreamRng;
  observer: RunObserverSlot;
  checkpoint: () => RunCheckpoint;
}>;

export type RunBindOptions = Readonly<{
  model?: Readonly<{ id: string; version: number; params?: unknown }>;
  strategy?: Readonly<{ id: string; params?: unknown }>;
  /** The model closure keeps state. A factory is required. Sharing the instance is refused. */
  statefulModel?: boolean;
  /** The strategy closure keeps state. A factory or snapshot pair is required. */
  statefulStrategy?: boolean;
}>;

export type FreshRunArgs = Readonly<{
  trialId: string;
  seed?: number;
  plan?: ExecutionPlan;
}>;

export type ContinueRunArgs<N, U extends string, Vars> = Readonly<{
  state: SimState<N, U, Vars>;
  plan?: ExecutionPlan;
}>;

export type ResumeRunArgs<N, U extends string, Vars> = Readonly<{
  checkpoint: RunCheckpoint;
  state: SimState<N, U, Vars>;
  plan?: ExecutionPlan;
}>;

export type RunBinding<N, U extends string, Vars> = Readonly<{
  fresh: (args: FreshRunArgs) => RunInstance<N, U, Vars>;
  continue: (previous: RunInstance<N, U, Vars>, args: ContinueRunArgs<N, U, Vars>) => RunInstance<N, U, Vars>;
  resume: (args: ResumeRunArgs<N, U, Vars>) => RunInstance<N, U, Vars>;
  /** Put a snapshot-backed strategy back to the cursor captured at bind. */
  release: () => void;
}>;

export type RunFactory = Readonly<{
  bind: <N, U extends string, Vars>(
    scenario: CompiledScenario<N, U, Vars>,
    options?: RunBindOptions,
  ) => RunBinding<N, U, Vars>;
}>;

export type RunFactoryDeps = Readonly<{
  models?: ModelRegistry;
  strategies?: StrategyRegistry;
}>;

export class RunIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunIsolationError";
  }
}

const isolationMessage =
  "Run isolation is unavailable. Deep-cloning a function closure is not isolation. Pass a ModelFactory or StrategyFactory, or implement snapshotState and restoreState.";

/** Copy state, including `vars`, without sharing the caller's objects. Prototypes stay intact. */
export function cloneRunState<N, U extends string, Vars>(state: SimState<N, U, Vars>): SimState<N, U, Vars> {
  return deepClonePreservingPrototype(state);
}

export function deriveStreamSeed(baseSeed: number, trialId: string, stream: RngStreamName): number {
  if (!Number.isFinite(baseSeed)) {
    throw new Error(`stream seed base must be finite (received: ${baseSeed})`);
  }
  if (trialId.length === 0) throw new Error("trial id must be non-empty");
  if (stream !== executionStream && stream !== previewStream) {
    throw new Error(`unknown rng stream: ${String(stream)}`);
  }
  let hash = 2166136261;
  const text = `${baseSeed >>> 0}\0${trialId}\0${stream}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createStreamRng(stream: RngStreamName, seed: number): StreamRng {
  if (!Number.isFinite(seed)) throw new Error(`rng seed must be finite (received: ${seed})`);
  let state = seed >>> 0;
  const start = state;
  return {
    stream,
    next() {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    snapshot: () => ({ stream, seed: start, state: state >>> 0 }),
    restore(snapshot) {
      if (snapshot.stream !== stream) {
        throw new Error(`rng stream mismatch: expected ${stream}, received ${snapshot.stream}`);
      }
      state = snapshot.state >>> 0;
    },
  };
}

/** Identity of the resolved plan. Wall time and local paths are not inputs. */
export function executionPlanIdentity(plan: ExecutionPlan): string {
  assertExecutionPlan(plan);
  return JSON.stringify({
    contract: plan.contract,
    version: plan.version,
    stepSec: plan.stepSec,
    durationSec: plan.durationSec ?? null,
    maxSteps: plan.maxSteps ?? null,
    seed: plan.seed ?? null,
    strategyId: plan.strategyId ?? null,
    strategyParams: plan.strategyParams ?? null,
    offline: plan.offline ?? null,
    eventLog: plan.eventLog ?? null,
    trace: plan.trace ?? null,
    fast: plan.fast ?? null,
  });
}

function assertExecutionPlan(plan: ExecutionPlan): void {
  if (plan.contract !== "idlekit.execution-plan" || plan.version !== 1) {
    throw new Error("ExecutionPlan contract must be idlekit.execution-plan version 1");
  }
}

function applyExecutionPlan(run: SimRunOptions, plan: ExecutionPlan | undefined): SimRunOptions {
  if (!plan) return run;
  assertExecutionPlan(plan);
  return {
    ...run,
    stepSec: plan.stepSec,
    ...(plan.durationSec !== undefined ? { durationSec: plan.durationSec } : {}),
    ...(plan.maxSteps !== undefined ? { maxSteps: plan.maxSteps } : {}),
    ...(plan.offline !== undefined ? { offline: plan.offline } : {}),
    ...(plan.eventLog !== undefined ? { eventLog: plan.eventLog } : {}),
    ...(plan.trace !== undefined ? { trace: plan.trace } : {}),
    ...(plan.fast !== undefined ? { fast: plan.fast } : {}),
  };
}

function assertTrialId(trialId: string): void {
  if (typeof trialId !== "string" || trialId.length === 0) throw new Error("trial id must be non-empty");
}

type StrategyHold<N, U extends string, Vars> = Readonly<{
  kind: "none" | "stateless" | "snapshot" | "factory";
  shared?: Strategy<N, U, Vars>;
  initialState?: unknown;
  factory?: Readonly<{ factory: StrategyFactory; params: unknown }>;
}>;

function isolationError(): RunIsolationError {
  return new RunIsolationError(isolationMessage);
}

function strategyHold<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  options: RunBindOptions | undefined,
  registries: RunFactoryDeps,
): StrategyHold<N, U, Vars> {
  const requested = options?.strategy;
  if (requested) {
    const factory = registries.strategies?.get(requested.id);
    if (!factory) throw new Error(`Unknown strategy: ${requested.id}`);
    return {
      kind: "factory",
      factory: { factory, params: requested.params ?? factory.defaultParams ?? {} },
    };
  }

  const strategy = scenario.strategy;
  if (!strategy) {
    if (options?.statefulStrategy) throw isolationError();
    return { kind: "none" };
  }

  const hasSnapshot = typeof strategy.snapshotState === "function";
  const hasRestore = typeof strategy.restoreState === "function";
  if (hasSnapshot !== hasRestore) throw isolationError();
  if (hasSnapshot && hasRestore) {
    return {
      kind: "snapshot",
      shared: strategy,
      initialState: deepClonePreservingPrototype(strategy.snapshotState?.()),
    };
  }
  if (options?.statefulStrategy) throw isolationError();
  return { kind: "stateless", shared: strategy };
}

function modelFactoryOf(
  options: RunBindOptions | undefined,
  registries: RunFactoryDeps,
): Readonly<{ factory: ModelFactory; params: unknown }> | undefined {
  if (!options?.model) {
    if (options?.statefulModel) throw isolationError();
    return undefined;
  }
  const factory = registries.models?.get(options.model.id, options.model.version);
  if (!factory) throw new Error(`Model not found: ${options.model.id}@${options.model.version}`);
  return { factory, params: options.model.params };
}

function planStrategy<N, U extends string, Vars>(
  plan: ExecutionPlan | undefined,
  registries: RunFactoryDeps,
): Readonly<{ factory: StrategyFactory; params: unknown }> | undefined {
  if (!plan?.strategyId) return undefined;
  assertExecutionPlan(plan);
  const factory = registries.strategies?.get(plan.strategyId);
  if (!factory) throw new Error(`ExecutionPlan strategy is not in the registry: ${plan.strategyId}`);
  return { factory, params: plan.strategyParams ?? factory.defaultParams ?? {} };
}

function createStrategy<N, U extends string, Vars>(
  factory: StrategyFactory,
  params: unknown,
): Strategy<N, U, Vars> {
  return factory.create(params) as Strategy<N, U, Vars>;
}

function restoreStrategy<N, U extends string, Vars>(strategy: Strategy<N, U, Vars>, state: unknown): void {
  if (!strategy.restoreState) throw isolationError();
  strategy.restoreState(deepClonePreservingPrototype(state));
}

/**
 * Build fresh, continued, and resumed runs from registries the caller already has.
 * This function does not read CLI flags or plugin files.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation Fresh trials do not share strategy cursors, model closures, or initial vars. Continue keeps the cursor. Resume uses snapshotState.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #f73792f Re-read the section: fresh trials restore or rebuild strategy state, continue keeps the cursor, and a marked closure without a factory throws.
 */
export function createRunFactory(deps?: RunFactoryDeps): RunFactory {
  const registries = deps ?? {};
  const bind = <N, U extends string, Vars>(
    scenario: CompiledScenario<N, U, Vars>,
    options?: RunBindOptions,
  ): RunBinding<N, U, Vars> => {
      const models = modelFactoryOf(options, registries);
      const strategies = strategyHold(scenario, options, registries);
      const definitionInitial = cloneRunState(scenario.initial);

      const release = () => {
        if (strategies.kind === "snapshot" && strategies.shared) {
          restoreStrategy(strategies.shared, strategies.initialState);
        }
      };

      const open = (
        mode: RunMode,
        trialId: string,
        seed: number,
        state: SimState<N, U, Vars>,
        plan: ExecutionPlan | undefined,
        strategy: Strategy<N, U, Vars> | undefined,
        model: Model<N, U, Vars>,
        rng: StreamRng,
        preview: StreamRng,
      ): RunInstance<N, U, Vars> => {
        const run = applyExecutionPlan(scenario.run, plan);
        const instance: RunInstance<N, U, Vars> = {
          mode,
          trialId,
          seed,
          streams: {
            execution: deriveStreamSeed(seed, trialId, executionStream),
            preview: deriveStreamSeed(seed, trialId, previewStream),
          },
          scenario: {
            ...scenario,
            ctx: {
              ...scenario.ctx,
              seed,
              stepSec: run.stepSec,
            } as SimContext<N, U, Vars>,
            model,
            initial: cloneRunState(state),
            run: { ...run },
            strategy,
          },
          rng,
          preview,
          observer: { trialId, buffer: "per-run" },
          checkpoint() {
            const saved = strategy?.snapshotState?.();
            return {
              contract: "idlekit.run-checkpoint",
              version: 1,
              trialId,
              seed,
              mode,
              streams: {
                execution: rng.snapshot(),
                preview: preview.snapshot(),
              },
              ...(saved !== undefined && strategy
                ? {
                    strategy: {
                      id: strategy.id,
                      ...(strategy.stateVersion !== undefined ? { stateVersion: strategy.stateVersion } : {}),
                      state: deepClonePreservingPrototype(saved),
                    },
                  }
                : {}),
            };
          },
        };
        return instance;
      };

      const modelFor = (mode: RunMode, previous: RunInstance<N, U, Vars> | undefined): Model<N, U, Vars> => {
        if (mode === "continue" && previous) return previous.scenario.model;
        if (models) return models.factory.create(models.params) as Model<N, U, Vars>;
        return scenario.model;
      };

      const strategyFor = (
        mode: RunMode,
        plan: ExecutionPlan | undefined,
        previous: Strategy<N, U, Vars> | undefined,
        checkpoint: RunCheckpoint | undefined,
      ): Strategy<N, U, Vars> | undefined => {
        const fromPlan = planStrategy(plan, registries);
        if (fromPlan) {
          const created = createStrategy<N, U, Vars>(fromPlan.factory, fromPlan.params);
          if (mode === "resume" && checkpoint?.strategy) restoreStrategy(created, checkpoint.strategy.state);
          if (mode === "continue" && previous?.snapshotState) {
            restoreStrategy(created, previous.snapshotState());
          }
          return created;
        }
        if (strategies.kind === "factory" && strategies.factory) {
          const created = createStrategy<N, U, Vars>(strategies.factory.factory, strategies.factory.params);
          if (mode === "fresh") return created;
          if (mode === "resume") {
            if (checkpoint?.strategy) restoreStrategy(created, checkpoint.strategy.state);
            return created;
          }
          if (previous?.snapshotState) restoreStrategy(created, previous.snapshotState());
          return created;
        }
        if (strategies.kind === "snapshot" && strategies.shared) {
          if (mode === "fresh") restoreStrategy(strategies.shared, strategies.initialState);
          if (mode === "resume") {
            if (!checkpoint?.strategy) throw new Error("resume checkpoint is missing strategy state");
            restoreStrategy(strategies.shared, checkpoint.strategy.state);
          }
          return strategies.shared;
        }
        if (mode === "resume" && checkpoint?.strategy) throw isolationError();
        return strategies.shared;
      };

      return {
        fresh(args) {
          assertTrialId(args.trialId);
          const seed = args.seed ?? args.plan?.seed ?? scenario.ctx.seed ?? 0;
          if (!Number.isFinite(seed)) throw new Error(`run seed must be finite (received: ${seed})`);
          const executionSeed = deriveStreamSeed(seed, args.trialId, executionStream);
          const previewSeed = deriveStreamSeed(seed, args.trialId, previewStream);
          return open(
            "fresh",
            args.trialId,
            seed,
            definitionInitial,
            args.plan,
            strategyFor("fresh", args.plan, undefined, undefined),
            modelFor("fresh", undefined),
            createStreamRng(executionStream, executionSeed),
            createStreamRng(previewStream, previewSeed),
          );
        },
        continue(previous, args) {
          return open(
            "continue",
            previous.trialId,
            previous.seed,
            args.state,
            args.plan,
            strategyFor("continue", args.plan, previous.scenario.strategy, undefined),
            modelFor("continue", previous),
            previous.rng,
            previous.preview,
          );
        },
        resume(args) {
          if (args.checkpoint.contract !== "idlekit.run-checkpoint" || args.checkpoint.version !== 1) {
            throw new Error("RunCheckpoint contract must be idlekit.run-checkpoint version 1");
          }
          const execution = createStreamRng(executionStream, args.checkpoint.streams.execution.seed);
          execution.restore(args.checkpoint.streams.execution);
          const preview = createStreamRng(previewStream, args.checkpoint.streams.preview.seed);
          preview.restore(args.checkpoint.streams.preview);
          return open(
            "resume",
            args.checkpoint.trialId,
            args.checkpoint.seed,
            args.state,
            args.plan,
            strategyFor("resume", args.plan, undefined, args.checkpoint),
            modelFor("resume", undefined),
            execution,
            preview,
          );
        },
        release,
      };
  };
  return { bind };
}
