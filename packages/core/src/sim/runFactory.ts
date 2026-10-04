import { modelCreateParams, strategyCreateParams, type StrategyParamsMode } from "../scenario/compile";
import type { ModelFactory, ModelRegistry } from "../scenario/registry";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import { constraintsWithAnchor, prestigeAnchorFromCheckpoint } from "./constraints";
import type { StrategyFactory, StrategyRegistry } from "./strategy/registry";
import type { Strategy } from "./strategy/types";
import type { CompiledScenario, Model, ScenarioConstraints, SimContext, SimRunOptions, SimState } from "./types";

/**
 * RNG stream for a committed step.
 * `previewStream` is the other stream. Restoring one over the other throws.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation A fresh trial derives this stream from the logical trial id. Preview is not this stream.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #9117b0d Re-read the section: this is the committed stream, derived from the logical trial id.
 */
export const executionStream = "execution" as const;

/**
 * RNG stream for preview and rollout.
 * It is not restored onto `executionStream`.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation Preview uses this stream. A committed step does not advance it.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #9117b0d Re-read the section: preview is a separate stream and is not restored onto execution.
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
  /** `validated` marks `strategyParams` as the schema's `result.value`. Omitted is `legacy-raw`. */
  strategyParamsMode?: StrategyParamsMode;
  offline?: SimRunOptions["offline"];
  eventLog?: SimRunOptions["eventLog"];
  trace?: SimRunOptions["trace"];
  fast?: SimRunOptions["fast"];
  /** Step limits copied onto the run. The prestige anchor is checkpoint state, not this object. */
  constraints?: Readonly<{
    maxActionsPerStep?: number;
    minPrestigeIntervalSec?: number;
  }>;
}>;

export type RunMode = "fresh" | "continue" | "resume";

/**
 * Runner-owned checkpoint. Not part of SimStateJSON.
 * `runner.lastPrestigeResetT` is the last committed prestige time.
 * `runner.prestigeReadyAtSec` is that time plus `minPrestigeIntervalSec` when both are known.
 * A missing runner does not invent a past timestamp.
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
    lastPrestigeResetT?: number;
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
  /** `paramsMode: "validated"` marks `params` as the schema's `result.value`. Omitted is `legacy-raw`. */
  strategy?: Readonly<{ id: string; params?: unknown; paramsMode?: StrategyParamsMode }>;
  /** The model closure keeps state. A factory is required. Sharing the instance is refused. */
  statefulModel?: boolean;
  /**
   * The strategy closure keeps state. A factory or snapshot pair is required.
   * Without this flag, a strategy with only one of the snapshot hooks is shared as stateless.
   */
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

const modelResumeMessage =
  "Resume cannot restore a stateful model closure. A checkpoint holds no model state. Keep that state in SimState vars, or continue the run.";

const supersededMessage =
  "This run shares a snapshot-backed strategy with a later run, or its binding was released. Finish one run before opening the next, or pass a StrategyFactory for overlapping runs.";

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

/** Copy for JSON with object keys sorted at every depth. Arrays keep their order. */
function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const plain = typeof (value as { toJSON?: unknown }).toJSON === "function"
    ? (value as { toJSON: () => unknown }).toJSON()
    : value;
  if (plain === null || typeof plain !== "object") return plain;
  if (Array.isArray(plain)) return plain.map(canonicalJsonValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(plain).sort()) {
    out[key] = canonicalJsonValue((plain as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * Identity of the resolved plan: canonical JSON of the plan fields, with object keys sorted.
 * It is a string key, not a hash. Equal plans give equal identities. Wall time and local paths are not inputs.
 */
export function executionPlanIdentity(plan: ExecutionPlan): string {
  assertExecutionPlan(plan);
  return JSON.stringify(canonicalJsonValue({
    contract: plan.contract,
    version: plan.version,
    stepSec: plan.stepSec,
    durationSec: plan.durationSec ?? null,
    maxSteps: plan.maxSteps ?? null,
    seed: plan.seed ?? null,
    strategyId: plan.strategyId ?? null,
    strategyParams: plan.strategyParams ?? null,
    strategyParamsMode: plan.strategyParamsMode ?? "legacy-raw",
    offline: plan.offline ?? null,
    eventLog: plan.eventLog ?? null,
    trace: plan.trace ?? null,
    fast: plan.fast ?? null,
    constraints: plan.constraints
      ? {
          maxActionsPerStep: plan.constraints.maxActionsPerStep ?? null,
          minPrestigeIntervalSec: plan.constraints.minPrestigeIntervalSec ?? null,
        }
      : null,
  }));
}

function resolvedConstraints(
  scenario: ScenarioConstraints | undefined,
  plan: ExecutionPlan | undefined,
  lastResetT: number | undefined,
): ScenarioConstraints | undefined {
  const fromPlan = plan?.constraints;
  if (!scenario && !fromPlan && lastResetT === undefined) return undefined;
  const { lastPrestigeResetT: _ignored, ...rest } = scenario ?? {};
  const merged: ScenarioConstraints = {
    ...rest,
    ...(fromPlan?.maxActionsPerStep !== undefined ? { maxActionsPerStep: fromPlan.maxActionsPerStep } : {}),
    ...(fromPlan?.minPrestigeIntervalSec !== undefined ? { minPrestigeIntervalSec: fromPlan.minPrestigeIntervalSec } : {}),
  };
  return constraintsWithAnchor(merged, lastResetT);
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

/**
 * Cursor ownership of one shared snapshot strategy, across every binding of that object.
 * `initial` is the bind snapshot of the binding whose run holds the cursor.
 */
type SharedCursor = { owner?: symbol; holder?: object; initial?: unknown };

const sharedCursors = new WeakMap<object, SharedCursor>();

/** Run token and shared strategy behind each guard, so continue works from any binding. */
const guardTokens = new WeakMap<object, Readonly<{ shared: object; token: symbol }>>();

type StrategyHold<N, U extends string, Vars> = Readonly<{
  kind: "none" | "stateless" | "snapshot" | "factory";
  shared?: Strategy<N, U, Vars>;
  initialState?: unknown;
  cursor?: SharedCursor;
  factory?: Readonly<{ factory: StrategyFactory; params: unknown }>;
}>;

function isolationError(): RunIsolationError {
  return new RunIsolationError(isolationMessage);
}

/**
 * Params `create` receives. Validated params are already the schema value, which the schema need
 * not accept again, so they are not checked twice. Factory defaults are checked in the given mode.
 */
function factoryStrategyParams(factory: StrategyFactory, params: unknown, mode: StrategyParamsMode | undefined): unknown {
  if (mode === "validated" && params !== undefined) return params;
  return strategyCreateParams({
    raw: params ?? factory.defaultParams ?? {},
    schema: factory.paramsSchema,
    mode: mode ?? "legacy-raw",
  }).params;
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
    // Same check and error as compileScenario, before any trial is built.
    const params = factoryStrategyParams(factory, requested.params, requested.paramsMode);
    return { kind: "factory", factory: { factory, params } };
  }

  const strategy = scenario.strategy;
  if (!strategy) {
    if (options?.statefulStrategy) throw isolationError();
    return { kind: "none" };
  }

  // One hook without the other cannot rebuild a cursor, so it is shared like no pair.
  const hasSnapshot = typeof strategy.snapshotState === "function";
  const hasRestore = typeof strategy.restoreState === "function";
  if (hasSnapshot && hasRestore) {
    let cursor = sharedCursors.get(strategy);
    if (!cursor) sharedCursors.set(strategy, (cursor = {}));
    // A run of another binding may hold the cursor. Start from that binding's snapshot, not the live cursor.
    return {
      kind: "snapshot",
      shared: strategy,
      cursor,
      initialState: cursor.owner !== undefined ? cursor.initial : deepClonePreservingPrototype(strategy.snapshotState?.()),
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
  return { factory, params: modelCreateParams({ raw: options.model.params, schema: factory.paramsSchema }) };
}

function planStrategy<N, U extends string, Vars>(
  plan: ExecutionPlan | undefined,
  registries: RunFactoryDeps,
): Readonly<{ factory: StrategyFactory; params: unknown }> | undefined {
  if (!plan?.strategyId) return undefined;
  assertExecutionPlan(plan);
  const factory = registries.strategies?.get(plan.strategyId);
  if (!factory) throw new Error(`ExecutionPlan strategy is not in the registry: ${plan.strategyId}`);
  // Same check and error as a bound strategy.
  return { factory, params: factoryStrategyParams(factory, plan.strategyParams, plan.strategyParamsMode) };
}

type StrategySource = Readonly<{ factory: StrategyFactory; params: unknown }>;

/** Factory and params behind each instance this host created. Continue reads it. */
const strategySources = new WeakMap<object, StrategySource>();

function createStrategy<N, U extends string, Vars>(
  factory: StrategyFactory,
  params: unknown,
): Strategy<N, U, Vars> {
  const created = factory.create(params) as Strategy<N, U, Vars>;
  if (created !== null && typeof created === "object") strategySources.set(created, { factory, params });
  return created;
}

function sameStrategySource(strategy: object, source: StrategySource): boolean {
  const known = strategySources.get(strategy);
  if (!known || known.factory !== source.factory) return false;
  if (known.params === source.params) return true;
  return JSON.stringify(canonicalJsonValue(known.params)) === JSON.stringify(canonicalJsonValue(source.params));
}

/**
 * Continue keeps the cursor of the same factory and params.
 * A snapshot pair is restored onto a new instance. Without a pair, the previous instance is reused.
 * Another factory or params is another strategy and starts new, without the previous snapshot.
 */
function continueStrategy<N, U extends string, Vars>(
  source: StrategySource,
  previous: Strategy<N, U, Vars> | undefined,
): Strategy<N, U, Vars> {
  if (!previous || !sameStrategySource(previous, source)) {
    return createStrategy<N, U, Vars>(source.factory, source.params);
  }
  const restorable = typeof previous.snapshotState === "function" && typeof previous.restoreState === "function";
  if (!restorable) return previous;
  const created = createStrategy<N, U, Vars>(source.factory, source.params);
  restoreStrategy(created, previous.snapshotState?.());
  return created;
}

function restoreStrategy<N, U extends string, Vars>(strategy: Strategy<N, U, Vars>, state: unknown): void {
  if (!strategy.restoreState) throw isolationError();
  strategy.restoreState(deepClonePreservingPrototype(state));
}

/** A run's view of a shared snapshot strategy. Its hooks throw once that run no longer owns the cursor. */
function guardStrategy<N, U extends string, Vars>(
  shared: Strategy<N, U, Vars>,
  owns: () => boolean,
): Strategy<N, U, Vars> {
  const guard = Object.create(shared) as Strategy<N, U, Vars>;
  for (const key of ["decide", "snapshotState", "restoreState"] as const) {
    const hook = shared[key] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof hook !== "function") continue;
    Object.defineProperty(guard, key, {
      enumerable: true,
      value: (...args: unknown[]) => {
        if (!owns()) throw new RunIsolationError(supersededMessage);
        return hook.apply(shared, args);
      },
    });
  }
  return guard;
}

const strategyLabel = (id: string, version: number | undefined) => (version === undefined ? id : `${id}@${version}`);

/**
 * The checkpoint entry resume restores into `strategy`, checked before anything moves.
 * Only the strategy id and state version that wrote an entry take it. A snapshot pair needs an entry,
 * and a closure marked stateful without a pair cannot be resumed.
 */
function checkpointStrategyFor<N, U extends string, Vars>(
  strategy: Strategy<N, U, Vars>,
  saved: RunCheckpoint["strategy"],
  stateful: boolean,
): RunCheckpoint["strategy"] {
  if (!saved) {
    if (typeof strategy.snapshotState === "function" && typeof strategy.restoreState === "function") {
      throw new RunIsolationError(
        `Resume checkpoint has no strategy state for the run strategy ${strategyLabel(strategy.id, strategy.stateVersion)}, which has snapshotState and restoreState. Another strategy or none wrote that checkpoint.`,
      );
    }
    if (stateful) throw isolationError();
    return undefined;
  }
  if (saved.id !== strategy.id || saved.stateVersion !== strategy.stateVersion) {
    throw new RunIsolationError(
      `Resume checkpoint strategy ${strategyLabel(saved.id, saved.stateVersion)} does not match the run strategy ${strategyLabel(strategy.id, strategy.stateVersion)}. Restoring another strategy's state is not isolation.`,
    );
  }
  if (!strategy.restoreState) throw isolationError();
  return saved;
}

/** A new factory instance for fresh and resume. Resume restores the checkpoint entry into it. */
function openFactoryStrategy<N, U extends string, Vars>(
  source: StrategySource,
  checkpoint: RunCheckpoint | undefined,
  stateful: boolean,
): Strategy<N, U, Vars> {
  const created = createStrategy<N, U, Vars>(source.factory, source.params);
  if (checkpoint) {
    const saved = checkpointStrategyFor(created, checkpoint.strategy, stateful);
    if (saved) restoreStrategy(created, saved.state);
  }
  return created;
}

/**
 * Build fresh, continued, and resumed runs from registries the caller already has.
 * This function does not read CLI flags or plugin files.
 *
 * @evidence docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation Fresh trials do not share strategy cursors, model closures, or initial vars. Continue keeps the cursor. Resume uses snapshotState.
 * @evidenceReview docs/requirements/active/run-lifecycle-isolation.md#req-pr03-run-lifecycle-isolation #9117b0d Re-read the section: fresh trials restore or rebuild strategy state, continue keeps the cursor of the same factory and params (a factory strategy without a snapshot pair keeps its instance; another factory or params, or a bound snapshot strategy after another strategy, starts fresh), a later run of any binding of a shared snapshot strategy, or release, supersedes the run that held it so its hooks, checkpoint, and continue throw, a binding opened while another binding's run holds that cursor takes that binding's snapshot, continue carries the cursor from a run of another binding, release leaves a cursor another binding's run holds, resume checks the checkpoint before any run gives up the cursor and throws when a snapshot pair has no entry or a closure marked stateful (a factory strategy without a pair, or a factory model) cannot be rebuilt, plan strategy params are checked like bound params, params marked validated reach create without a second check, and a marked closure without a factory throws.
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

      // Runs on the shared snapshot strategy hold a guard. Only the latest run of any binding owns the cursor.
      const self = {};
      const cursor: SharedCursor = strategies.cursor ?? {};
      const guardShared = (shared: Strategy<N, U, Vars>): Strategy<N, U, Vars> => {
        const token = Symbol("run");
        cursor.owner = token;
        cursor.holder = self;
        cursor.initial = strategies.initialState;
        const guard = guardStrategy(shared, () => cursor.owner === token);
        guardTokens.set(guard, { shared, token });
        return guard;
      };

      // A binding whose runs lost the cursor to another binding leaves it with that holder.
      const release = () => {
        if (strategies.kind !== "snapshot" || !strategies.shared) return;
        if (cursor.owner !== undefined && cursor.holder !== self) return;
        cursor.owner = undefined;
        restoreStrategy(strategies.shared, strategies.initialState);
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
        anchorResetT: number | undefined,
        constraintBase?: ScenarioConstraints,
      ): RunInstance<N, U, Vars> => {
        const run = applyExecutionPlan(scenario.run, plan);
        let lastResetT = anchorResetT;
        let liveConstraints = resolvedConstraints(constraintBase ?? scenario.constraints, plan, lastResetT);
        const userHook = run.onPrestigeReset;
        const scenarioBox: { current: CompiledScenario<N, U, Vars> } = {
          current: undefined as unknown as CompiledScenario<N, U, Vars>,
        };
        scenarioBox.current = {
          ...scenario,
          ctx: {
            ...scenario.ctx,
            seed,
            stepSec: run.stepSec,
            ...(liveConstraints ? { constraints: liveConstraints } : {}),
          } as SimContext<N, U, Vars>,
          model,
          initial: cloneRunState(state),
          constraints: liveConstraints,
          run: {
            ...run,
            onPrestigeReset(t: number) {
              lastResetT = t;
              liveConstraints = constraintsWithAnchor(liveConstraints, t);
              scenarioBox.current = {
                ...scenarioBox.current,
                constraints: liveConstraints,
                ctx: { ...scenarioBox.current.ctx, constraints: liveConstraints },
              };
              userHook?.(t);
            },
          },
          strategy,
        };
        const instance: RunInstance<N, U, Vars> = {
          mode,
          trialId,
          seed,
          streams: {
            execution: deriveStreamSeed(seed, trialId, executionStream),
            preview: deriveStreamSeed(seed, trialId, previewStream),
          },
          get scenario() {
            return scenarioBox.current;
          },
          rng,
          preview,
          observer: { trialId, buffer: "per-run" },
          checkpoint() {
            // Only a snapshot pair writes an entry, even one that saves undefined. A one-hook
            // strategy is shared as stateless, and resume could not restore its entry.
            const restorable =
              typeof strategy?.snapshotState === "function" && typeof strategy.restoreState === "function";
            const saved = restorable ? strategy.snapshotState!() : undefined;
            const interval = liveConstraints?.minPrestigeIntervalSec;
            const ready =
              typeof lastResetT === "number" &&
              typeof interval === "number" &&
              Number.isFinite(interval) &&
              interval > 0
                ? lastResetT + interval
                : undefined;
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
              ...(restorable && strategy
                ? {
                    strategy: {
                      id: strategy.id,
                      ...(strategy.stateVersion !== undefined ? { stateVersion: strategy.stateVersion } : {}),
                      state: deepClonePreservingPrototype(saved),
                    },
                  }
                : {}),
              ...(typeof lastResetT === "number"
                ? {
                    runner: {
                      lastPrestigeResetT: lastResetT,
                      ...(ready !== undefined ? { prestigeReadyAtSec: ready } : {}),
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
        const stateful = options?.statefulStrategy === true;
        const resumeFrom = mode === "resume" ? checkpoint : undefined;
        const fromPlan = planStrategy(plan, registries);
        if (fromPlan) {
          if (mode === "continue") return continueStrategy(fromPlan, previous);
          return openFactoryStrategy(fromPlan, resumeFrom, stateful);
        }
        if (strategies.kind === "factory" && strategies.factory) {
          if (mode === "continue") return continueStrategy(strategies.factory, previous);
          return openFactoryStrategy(strategies.factory, resumeFrom, stateful);
        }
        if (strategies.kind === "snapshot" && strategies.shared) {
          // Only the run that owns the cursor hands it on. A continue from another strategy is a
          // changed source and starts from the bind snapshot. Any new run supersedes the owner,
          // after the checks, so a refused open leaves the live run its cursor.
          const guarded = mode === "continue" && previous !== undefined ? guardTokens.get(previous) : undefined;
          const carried = guarded?.shared === strategies.shared ? guarded.token : undefined;
          if (carried !== undefined && carried !== cursor.owner) throw new RunIsolationError(supersededMessage);
          const saved = resumeFrom ? checkpointStrategyFor(strategies.shared, resumeFrom.strategy, stateful) : undefined;
          cursor.owner = undefined;
          if (mode === "fresh" || (mode === "continue" && carried === undefined)) {
            restoreStrategy(strategies.shared, strategies.initialState);
          }
          if (saved) restoreStrategy(strategies.shared, saved.state);
          return guardShared(strategies.shared);
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
            undefined,
            scenario.constraints,
          );
        },
        continue(previous, args) {
          // Read the anchor while the previous run still owns a shared strategy.
          const anchorResetT = prestigeAnchorFromCheckpoint(previous.checkpoint()).lastResetT;
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
            anchorResetT,
            previous.scenario.constraints,
          );
        },
        resume(args) {
          if (args.checkpoint.contract !== "idlekit.run-checkpoint" || args.checkpoint.version !== 1) {
            throw new Error("RunCheckpoint contract must be idlekit.run-checkpoint version 1");
          }
          // A factory model starts new, so a closure marked stateful would lose its state.
          if (options?.statefulModel) throw new RunIsolationError(modelResumeMessage);
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
            prestigeAnchorFromCheckpoint(args.checkpoint).lastResetT,
            scenario.constraints,
          );
        },
        release,
      };
  };
  return { bind };
}
