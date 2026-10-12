import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import { recordPrestigeReset } from "../constraints";
import { emitActionFacts, emitCommittedResets } from "../observation";
import { runScenario } from "../simulator";
import { applyDecisions, type CommittedResetFact } from "../step";
import {
  runElapsedSec,
  type Action,
  type CompiledScenario,
  type Model,
  type ScenarioConstraints,
  type SimContext,
  type SimState,
} from "../types";
import { deepClonePreservingPrototype } from "../../utils/deepClone";
import { withoutResetActions } from "./resetActions";

/**
 * Reset-cycle execution v1.
 * `analyzePrestigeCycle` stays the legacy interval scan.
 * This artifact does not copy that scan's stability or break-even fields.
 */

const RESET_CYCLE_ALGORITHM_VERSION = "reset-cycle-v1" as const;
/**
 * Rounding slack for the horizon check, in units of the magnitudes being added. Summed runner seconds carry a few
 * ULPs of error, such as 0.1 three times against a 0.3 horizon. A real overshoot, even 5e-7 seconds past 1000, is
 * far larger.
 */
const HORIZON_ULPS = 64;
/** The largest share of an interval the horizon slack may cover. A visible overshoot is never rounding. */
const HORIZON_SHARE = 1e-6;
const RESET_CYCLE_SCHEMA_ID = "https://idlekit.dev/schemas/reset.cycle.v1.schema.json" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset Each cycle commits a reset through the action payment path.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: three cycles leave three resets, and the reset does not mint income.
 */
export const resetCycleExecution = "committed-reset-transition" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-refused-reset A refused cost, condition, or cooldown pays no reward.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-refused-reset #5bbd1e4 Re-read the section: cannot-apply, insufficient funds, and cooldown are recorded, and the point stock stays put.
 */
export const resetCycleSameContract = "prestige-and-custom-reset" as const;

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-reward-delta Reward gained by the reset does not include the stock already held.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-reward-delta #ed22025 Re-read the section: opening points of 100 stay out of the delta.
 */
export const resetCycleRewardDelta = "reward-delta-excludes-opening-stock" as const;

export function resetCycleSchemaId(): typeof RESET_CYCLE_SCHEMA_ID {
  return RESET_CYCLE_SCHEMA_ID;
}

export function resetCycleAlgorithmVersion(): typeof RESET_CYCLE_ALGORITHM_VERSION {
  return RESET_CYCLE_ALGORITHM_VERSION;
}

export class ResetCycleRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetCycleRejected";
  }
}

export type ResetCycleStatus = "ok" | "incomplete" | "censored" | "unsupported";

export type ResetSkipReason =
  | "cannot-apply"
  | "insufficient-funds"
  | "cooldown"
  | "budget"
  | "rejected"
  | "missing-adapter";

export type ResetCycleRowV1 = Readonly<{
  index: number;
  startSec: number;
  endSec: number;
  resetAtSec: number | null;
  durationSec: number;
  rewardDelta: string;
  accumulatedReward: string;
  resetSkippedReason?: ResetSkipReason;
  carried: Readonly<{
    points: string;
    multiplier: string;
    count: number;
    reward: string;
  }>;
}>;

export type ResetCycleArtifactV1 = Readonly<{
  schemaVersion: 1;
  algorithmVersion: typeof RESET_CYCLE_ALGORITHM_VERSION;
  status: ResetCycleStatus;
  policy: "fixed-interval" | "explicit";
  appliedResets: number;
  originSec: number;
  globalElapsedSec: number;
  assumptions: readonly string[];
  warnings: readonly string[];
  cycles: readonly ResetCycleRowV1[];
}>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let resetCycleValidator: ((input: unknown) => IValidation<ResetCycleArtifactV1>) | undefined;

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset The generated validator accepts this artifact and rejects a missing status.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: the wire object is reset cycle v1.
 */
export const validateResetCycleArtifact = (input: unknown): IValidation<ResetCycleArtifactV1> =>
  (resetCycleValidator ??= typia.createValidate<ResetCycleArtifactV1>())(input);

function buildResetCycleJsonSchema() {
  return typia.json.schema<ResetCycleArtifactV1, "3.1">();
}

let resetCycleJsonSchemaUnit: ReturnType<typeof buildResetCycleJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: schema version is 3.1.
 */
export function resetCycleJsonSchema(): ReturnType<typeof buildResetCycleJsonSchema> {
  resetCycleJsonSchemaUnit ??= buildResetCycleJsonSchema();
  return resetCycleJsonSchemaUnit;
}

/**
 * What a reset is allowed to keep, and how its reward is measured.
 * `pointsFrom` is a declared gain. `resetState` writes the next state.
 * `multiplierFrom` maps the post-reset point total and is not applied a second time.
 */
export type ResetAdapter<N, U extends string, Vars> = Readonly<{
  id: string;
  kind: "prestige" | "custom";
  preserved: readonly ("points" | "multiplier" | "count" | "vars")[];
  action: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Action<N, U, Vars> | undefined;
  reward: (ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => N;
}>;

export type ResetCyclePolicy =
  | Readonly<{ kind: "fixed-interval"; intervalSec: number; cycles: number }>
  | Readonly<{ kind: "explicit"; steps: readonly Readonly<{ durationSec: number }>[] }>;

export type ResetCycleRng = Readonly<{
  /** Names the generator. A checkpoint records it, and a resume with another generator is rejected. */
  id: string;
  /** The version of the snapshot format. A checkpoint records it, and a resume with another version is rejected. */
  stateVersion: number;
  snapshot: () => unknown;
  restore: (state: unknown) => void;
}>;

export type ResetCycleCheckpoint<N, U extends string, Vars> = Readonly<{
  contract: "idlekit.reset-cycle-checkpoint";
  version: 1;
  state: SimState<N, U, Vars>;
  constraints?: ScenarioConstraints;
  nextIndex: number;
  originSec: number;
  /** Simulated seconds since the origin, summed from each runner result. Absent on older checkpoints. */
  elapsedSec?: number;
  accumulatedReward: N;
  strategyState?: unknown;
  /** The explicit reset adapter whose reward accumulatedReward sums. A resume checks it. */
  adapterId?: string;
  adapterKind?: "prestige" | "custom";
  /** Seconds already played of a cycle a budget cut. A resume plays only the rest of that cycle. */
  pendingSec?: number;
  /** The planned duration of that cut cycle. A resume must plan the same duration for it. */
  pendingDurationSec?: number;
  /** The t at which that cut cycle started. The resumed row keeps it, so its span matches its duration. */
  pendingStartSec?: number;
  /** The model the state belongs to. A resume checks it. */
  modelId?: string;
  modelVersion?: number;
  /** The id and state version of the strategy that wrote strategyState. A resume checks them. */
  strategyId?: string;
  strategyStateVersion?: number;
  rngState?: unknown;
  /** The id and state version of the generator that wrote rngState. A resume checks them. */
  rngId?: string;
  rngStateVersion?: number;
}>;

export type ResetCycleExecution<N, U extends string, Vars> = Readonly<{
  artifact: ResetCycleArtifactV1;
  state: SimState<N, U, Vars>;
  constraints?: ScenarioConstraints;
  checkpoint: ResetCycleCheckpoint<N, U, Vars>;
}>;

function assertPositiveInt(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ResetCycleRejected(`reset cycle ${label} must be a positive integer`);
  }
}

function assertNonNegativeInt(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ResetCycleRejected(`reset cycle ${label} must be an integer >= 0`);
  }
}

/** The runner treats a duration at or below this as already complete, so such an interval would play no time. */
const RUNNER_MIN_DURATION_SEC = 1e-12;

function assertPositiveTime(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw new ResetCycleRejected(`reset cycle ${label} must be a finite number > 0`);
  }
  if (value <= RUNNER_MIN_DURATION_SEC) {
    throw new ResetCycleRejected(`reset cycle ${label} must be greater than the runner's ${RUNNER_MIN_DURATION_SEC} second resolution`);
  }
}

/** Adapters this module built from the model. A caller's adapter may reuse their ids, so identity decides. */
const builtinActionAdapters = new WeakSet<object>();
const builtinSpecAdapters = new WeakSet<object>();

function actionAdapter<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  kind: "prestige" | "custom",
): ResetAdapter<N, U, Vars> {
  const adapter: ResetAdapter<N, U, Vars> = {
    id: kind === "prestige" ? "prestige.action" : "custom.action",
    kind,
    preserved: ["points", "multiplier", "count"],
    action(ctx, state) {
      return model.actions(ctx, state).find((candidate) => candidate.kind === kind);
    },
    reward(_ctx, state) {
      return state.prestige.points;
    },
  };
  builtinActionAdapters.add(adapter);
  return adapter;
}

function specAdapter<N, U extends string, Vars>(model: Model<N, U, Vars>): ResetAdapter<N, U, Vars> | undefined {
  const spec = model.prestige;
  if (!spec) return undefined;
  const adapter: ResetAdapter<N, U, Vars> = {
    id: "prestige.spec",
    kind: "prestige",
    preserved: ["points", "multiplier", "count"],
    action(ctx, state) {
      return {
        id: "prestige.spec",
        kind: "prestige",
        canApply: () => true,
        cost: () => null,
        apply: (applyCtx, applyState) => {
          const gained = spec.pointsFrom(applyCtx, applyState);
          return spec.resetState(applyCtx, applyState, gained);
        },
      };
    },
    reward(_ctx, state) {
      return state.prestige.points;
    },
  };
  builtinSpecAdapters.add(adapter);
  return adapter;
}

/**
 * Prestige action wins when both an action and a spec exist.
 * The spec functions are not called on that path, so the bonus is not applied twice.
 * A model with neither needs the caller to pass an adapter.
 *
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset The default adapter uses the prestige action, or the spec when no action exists.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: an action and a spec are not both applied.
 */
export function resetAdapterFor<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  explicit?: ResetAdapter<N, U, Vars>,
  state: SimState<N, U, Vars> = scenario.initial,
  ctx: SimContext<N, U, Vars> = scenario.ctx,
): ResetAdapter<N, U, Vars> | undefined {
  if (explicit) return explicit;
  // Read the state and context where the reset would happen. A model can list its prestige action only later,
  // or only under the live constraints.
  const discovered = scenario.model.actions(ctx, state);
  if (discovered.some((candidate) => candidate.kind === "prestige")) {
    return actionAdapter(scenario.model, "prestige");
  }
  return specAdapter(scenario.model);
}

function skipReason(fact: CommittedResetFact | undefined, eventReason: string | undefined): ResetSkipReason {
  if (eventReason === "cannotApply") return "cannot-apply";
  if (eventReason === "insufficientFunds") return "insufficient-funds";
  if (eventReason === "cooldown") return "cooldown";
  if (!fact) return "rejected";
  return "rejected";
}

function carried<N, U extends string, Vars>(
  E: Engine<N>,
  state: SimState<N, U, Vars>,
  reward: N,
): ResetCycleRowV1["carried"] {
  return {
    points: E.toString(state.prestige.points),
    multiplier: E.toString(state.prestige.multiplier),
    count: state.prestige.count,
    reward: E.toString(reward),
  };
}

/**
 * Run a fixed interval or an explicit list of reset durations.
 * Each completed cycle ends in one committed reset. A refused reset is kept and not forced.
 *
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset The executor chains cycle end into the next cycle start.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: carried points and multiplier are the next cycle's start, and a split resume matches one run.
 */
export function executeResetCycles<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  policy: ResetCyclePolicy;
  adapter?: ResetAdapter<N, U, Vars>;
  maxCycles?: number;
  horizonSec?: number;
  budgetSteps?: number;
  resume?: ResetCycleCheckpoint<N, U, Vars>;
  rng?: ResetCycleRng;
}): ResetCycleExecution<N, U, Vars> {
  const { scenario } = args;
  const { E } = scenario.ctx;
  if (args.policy.kind === "fixed-interval") {
    assertPositiveInt("cycles", args.policy.cycles);
    assertPositiveTime("intervalSec", args.policy.intervalSec);
  } else {
    assertPositiveInt("steps", args.policy.steps.length);
    for (const step of args.policy.steps) assertPositiveTime("intervalSec", step.durationSec);
  }
  // maxCycles is a cap, like horizonSec and budgetSteps, so 0 censors the run before any reset.
  if (args.maxCycles !== undefined) assertNonNegativeInt("maxCycles", args.maxCycles);
  if (args.horizonSec !== undefined && (typeof args.horizonSec !== "number" || !Number.isFinite(args.horizonSec) || args.horizonSec < 0)) {
    throw new ResetCycleRejected("reset cycle horizonSec must be a finite number >= 0");
  }
  if (
    args.budgetSteps !== undefined &&
    (typeof args.budgetSteps !== "number" || !Number.isInteger(args.budgetSteps) || args.budgetSteps < 0)
  ) {
    throw new ResetCycleRejected("reset cycle budgetSteps must be an integer >= 0");
  }

  // A checkpoint from another contract or version is not read as this one.
  if (
    args.resume &&
    (args.resume.contract !== "idlekit.reset-cycle-checkpoint" || args.resume.version !== 1)
  ) {
    throw new ResetCycleRejected("reset cycle resume needs an idlekit.reset-cycle-checkpoint version 1");
  }
  // A state belongs to the model that produced it. Another model would read it under different rules.
  if (
    args.resume &&
    (args.resume.modelId !== undefined || args.resume.modelVersion !== undefined) &&
    (args.resume.modelId !== scenario.model.id || args.resume.modelVersion !== scenario.model.version)
  ) {
    throw new ResetCycleRejected(
      `reset cycle checkpoint belongs to model ${String(args.resume.modelId)}@${String(args.resume.modelVersion)}, not ${scenario.model.id}@${scenario.model.version}`,
    );
  }
  // accumulatedReward sums one adapter's reward. Another adapter would add a different metric to it.
  if (
    args.resume &&
    (args.resume.adapterId !== args.adapter?.id || args.resume.adapterKind !== args.adapter?.kind)
  ) {
    throw new ResetCycleRejected(
      `reset cycle checkpoint accumulates adapter ${String(args.resume.adapterId)}, not ${String(args.adapter?.id)}`,
    );
  }
  const originSec = args.resume?.originSec ?? args.resume?.state.t ?? scenario.initial.t;
  // A guard can stop before the runner validates the clock, so the clock fields are checked here.
  const clockFields = [originSec, args.resume?.state.t ?? scenario.initial.t, args.resume?.elapsedSec ?? 0];
  if (clockFields.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new ResetCycleRejected("reset cycle clock fields must be finite numbers");
  }
  // Resume from copies, so in-place edits during the run cannot rewrite the checkpoint.
  let state = args.resume ? deepClonePreservingPrototype(args.resume.state) : scenario.initial;
  let constraints = args.resume?.constraints
    ? deepClonePreservingPrototype(args.resume.constraints)
    : scenario.constraints;
  // An RNG snapshot is opaque, so it is only checkpointed and restored under a named, versioned generator.
  // The id must be nonempty and the version finite, or the recorded identity could not match itself on resume.
  if (
    args.rng &&
    (typeof args.rng.id !== "string" ||
      args.rng.id.length === 0 ||
      typeof args.rng.stateVersion !== "number" ||
      !Number.isFinite(args.rng.stateVersion))
  ) {
    throw new ResetCycleRejected("reset cycle rng needs an id and a stateVersion");
  }
  let accumulated = args.resume?.accumulatedReward ?? E.zero();
  let nextIndex = args.resume?.nextIndex ?? 0;
  // Every checkpoint field is checked before any restore hook runs, so a rejected resume leaves the caller's strategy
  // and RNG where they were.
  if (typeof nextIndex !== "number" || !Number.isInteger(nextIndex) || nextIndex < 0) {
    throw new ResetCycleRejected("reset cycle checkpoint nextIndex must be an integer >= 0");
  }
  // Elapsed seconds are summed from runner results. Absolute t can round away from simulated time.
  let elapsed = args.resume?.elapsedSec ?? state.t - originSec;
  // Elapsed seconds count forward from the origin. A negative count would let a resume pass the horizon.
  if (elapsed < 0) throw new ResetCycleRejected("reset cycle checkpoint elapsedSec must be >= 0");
  if (!E.isFinite(accumulated)) throw new ResetCycleRejected("reset cycle checkpoint accumulatedReward is not finite");
  // Seconds a budget already played of the next cycle. That cycle keeps its index and plays only the rest.
  let pending = args.resume?.pendingSec ?? 0;
  if (typeof pending !== "number" || !Number.isFinite(pending) || pending < 0) {
    throw new ResetCycleRejected("reset cycle checkpoint pendingSec must be a finite number >= 0");
  }
  // A resumed cut cycle starts where it started before the cut. Older checkpoints place it pendingSec before t.
  const resumedStart = args.resume?.pendingStartSec;
  if (pending > 0 && resumedStart !== undefined && (typeof resumedStart !== "number" || !Number.isFinite(resumedStart))) {
    throw new ResetCycleRejected("reset cycle checkpoint pendingStartSec must be a finite number");
  }
  const resumedDuration = args.resume?.pendingDurationSec;
  if (
    pending > 0 &&
    resumedDuration !== undefined &&
    (typeof resumedDuration !== "number" || !Number.isFinite(resumedDuration) || !(resumedDuration > 0))
  ) {
    throw new ResetCycleRejected("reset cycle checkpoint pendingDurationSec must be a finite number > 0");
  }
  // A cut cycle has played less than its planned duration, or it would have reset before the cut.
  if (pending > 0 && resumedDuration !== undefined && pending >= resumedDuration) {
    throw new ResetCycleRejected("reset cycle checkpoint pendingSec must be less than pendingDurationSec");
  }
  // A checkpoint that runs no cycle is written again with the same cut-cycle metadata.
  let pendingDuration: number | undefined = pending > 0 ? resumedDuration : undefined;
  let pendingStart: number | undefined = pending > 0 ? (resumedStart ?? state.t - pending) : undefined;
  // A saved snapshot needs something to restore it into. Dropping it would resume on a different stream.
  if (args.resume && "strategyState" in args.resume) {
    if (!scenario.strategy?.restoreState) {
      throw new ResetCycleRejected("reset cycle checkpoint has strategyState, but the strategy has no restoreState");
    }
    // An opaque snapshot belongs to the strategy, and the state version, that wrote it.
    if (
      args.resume.strategyId !== scenario.strategy.id ||
      args.resume.strategyStateVersion !== scenario.strategy.stateVersion
    ) {
      throw new ResetCycleRejected(
        `reset cycle checkpoint strategyState was written by ${String(args.resume.strategyId)}@${String(args.resume.strategyStateVersion)}, not ${String(scenario.strategy.id)}@${String(scenario.strategy.stateVersion)}`,
      );
    }
  } else if (args.resume && scenario.strategy?.snapshotState && scenario.strategy.restoreState) {
    // A restorable strategy resumed without its snapshot would start from its initial state.
    throw new ResetCycleRejected("reset cycle checkpoint has no strategyState for a strategy that restores one");
  }
  if (args.resume && "rngState" in args.resume) {
    if (!args.rng) throw new ResetCycleRejected("reset cycle checkpoint has rngState, but no rng was passed");
    // An opaque RNG snapshot belongs to the generator, and the state version, that wrote it. A snapshot without them
    // is ambiguous and is rejected.
    if (args.resume.rngId !== args.rng.id || args.resume.rngStateVersion !== args.rng.stateVersion) {
      throw new ResetCycleRejected(
        `reset cycle checkpoint rngState was written by ${String(args.resume.rngId)}@${String(args.resume.rngStateVersion)}, not ${String(args.rng.id)}@${String(args.rng.stateVersion)}`,
      );
    }
  }
  // Restore from copies, so a restore that keeps or edits its argument cannot change the checkpoint.
  // Presence is the key, not the value: an undefined snapshot is still restored.
  if (args.resume && "strategyState" in args.resume) {
    scenario.strategy?.restoreState?.call(scenario.strategy, deepClonePreservingPrototype(args.resume.strategyState));
  }
  if (args.resume && "rngState" in args.resume) {
    args.rng?.restore(deepClonePreservingPrototype(args.resume.rngState));
  }
  // The context the runner and the boundary action see: the scenario context with the live constraints.
  const liveCtx = (): SimContext<N, U, Vars> => ({ ...scenario.ctx, ...(constraints ? { constraints } : {}) });
  const startAdapter = resetAdapterFor(scenario, args.adapter, state, liveCtx());

  const warnings: string[] = ["legacy interval scan fields are not reset evidence"];
  if (scenario.strategy?.snapshotState && !scenario.strategy.restoreState) {
    warnings.push("strategy state is not checkpointed: snapshotState has no restoreState");
  }
  const requested = args.policy.kind === "fixed-interval" ? args.policy.cycles : args.policy.steps.length;
  const rows: ResetCycleRowV1[] = [];
  let guard: "ok" | "incomplete" | "censored" | "unsupported" = "ok";
  let remainingBudget = args.budgetSteps;
  const rewardOf = (adapter: ResetAdapter<N, U, Vars> | undefined, current: SimState<N, U, Vars>): N =>
    adapter ? adapter.reward(liveCtx(), current) : current.prestige.points;

  while (rows.length < requested && guard === "ok") {
    if (args.maxCycles !== undefined && rows.length >= args.maxCycles) {
      guard = "censored";
      warnings.push("max-cycles");
      break;
    }
    const duration =
      args.policy.kind === "fixed-interval" ? args.policy.intervalSec : args.policy.steps[rows.length]!.durationSec;
    // horizonSec is elapsed time from the study origin, not an absolute t.
    // The slack covers the rounding of this addition only: a few ULPs of the magnitudes involved, so a zero horizon
    // admits no positive interval and a long horizon admits no real overshoot.
    // It also stays below a millionth of the interval, so at a large horizon, where the ULP-based bound grows to
    // seconds, a real overshoot of the interval is still censored.
    const slack =
      args.horizonSec === undefined
        ? 0
        : Math.min(
            HORIZON_ULPS * Number.EPSILON * Math.max(Math.abs(elapsed) + Math.abs(duration), Math.abs(args.horizonSec)),
            duration * HORIZON_SHARE,
          );
    // A cut cycle resumes under the duration it was planned with. Another duration would change where it resets.
    if (pending > 0 && args.resume?.pendingDurationSec !== undefined && duration !== args.resume.pendingDurationSec) {
      throw new ResetCycleRejected(
        `reset cycle checkpoint cut a ${args.resume.pendingDurationSec}-second cycle, not a ${duration}-second one`,
      );
    }
    // An older checkpoint without pendingDurationSec is checked against the planned duration here.
    if (pending > 0 && pending >= duration) {
      throw new ResetCycleRejected(`reset cycle checkpoint played ${pending} seconds of a ${duration}-second cycle`);
    }
    const remainingSec = duration - pending;
    if (args.horizonSec !== undefined && elapsed + remainingSec > args.horizonSec + slack) {
      guard = "censored";
      warnings.push("horizon");
      break;
    }

    const startSec = pending > 0 && pendingStart !== undefined ? pendingStart : state.t;
    const intervalAdapter = args.adapter ?? resetAdapterFor(scenario, undefined, state, liveCtx()) ?? startAdapter;
    const { maxSteps: _ignoredMax, until: _ignoredUntil, trace: _ignoredTrace, ...runRest } = scenario.run;
    const run = runScenario({
      ...scenario,
      model: withoutResetActions(scenario.model, intervalAdapter),
      initial: state,
      ...(constraints ? { constraints } : {}),
      run: {
        ...runRest,
        durationSec: remainingSec,
        ...(remainingBudget !== undefined ? { maxSteps: remainingBudget } : {}),
      },
    });
    if (remainingBudget !== undefined) remainingBudget = Math.max(0, remainingBudget - (run.stop?.steps ?? 0));
    // The runner's elapsed seconds, not an end.t difference that rounds at a large t.
    const playedNow = runElapsedSec(run);
    elapsed += playedNow;
    // The whole cycle's seconds, including what an earlier budget-cut call played.
    const played = pending + playedNow;
    pending = 0;
    state = run.end;
    // nextBoundary checks the duration before the budget, so a budget stop never completed the interval.
    const shortBudget = run.stop?.reason === "budget";
    if (shortBudget) {
      rows.push({
        index: nextIndex,
        startSec,
        endSec: state.t,
        resetAtSec: null,
        durationSec: played,
        rewardDelta: E.toString(E.zero()),
        accumulatedReward: E.toString(accumulated),
        resetSkippedReason: "budget",
        carried: carried(E, state, rewardOf(intervalAdapter, state)),
      });
      // The cycle is not finished. A resume continues it under the same index for the remaining seconds.
      pending = played;
      pendingDuration = duration;
      pendingStart = startSec;
      guard = "censored";
      warnings.push("budget");
      break;
    }

    // Resolve the adapter where the reset happens. A prestige action can appear only after this interval.
    // The boundary action sees the live constraints, as it would inside runScenario, and so does discovery.
    const boundaryCtx = liveCtx();
    const adapter = args.adapter ?? resetAdapterFor(scenario, undefined, state, boundaryCtx);
    if (!adapter) {
      rows.push({
        index: nextIndex,
        startSec,
        endSec: state.t,
        resetAtSec: null,
        durationSec: played,
        rewardDelta: E.toString(E.zero()),
        accumulatedReward: E.toString(accumulated),
        resetSkippedReason: "missing-adapter",
        carried: carried(E, state, state.prestige.points),
      });
      nextIndex += 1;
      guard = "unsupported";
      warnings.push("explicit adapter required");
      break;
    }
    const specNote = "prestige spec was not applied because a prestige action commits the reset";
    if (builtinActionAdapters.has(adapter) && adapter.kind === "prestige" && scenario.model.prestige && !warnings.includes(specNote)) {
      warnings.push(specNote);
    }

    const beforeReward = adapter.reward(boundaryCtx, state);
    if (!E.isFinite(beforeReward)) throw new ResetCycleRejected(`reset adapter ${adapter.id} reward is not finite`);
    const action = adapter.action(boundaryCtx, state);
    // A reset is a prestige or custom action. Another kind would be paid and applied without a reset fact.
    if (action && action.kind !== "prestige" && action.kind !== "custom") {
      throw new ResetCycleRejected(`reset adapter ${adapter.id} returned a ${action.kind} action, not a reset`);
    }
    const kinds = new Set<"prestige" | "custom">();
    if (action) kinds.add(action.kind as "prestige" | "custom");
    const applied = applyDecisions({
      ctx: boundaryCtx,
      model: scenario.model,
      state,
      decisions: action ? [{ action }] : [],
      constraints,
      resetKinds: kinds,
      // The boundary happens at the executor's summed elapsed seconds, not at a rounded reward timestamp.
      // It stays within the segment's wall end, as wallNow keeps a step's reset there.
      ...(boundaryCtx.clocks
        ? {
            wallT: Number.isFinite(boundaryCtx.clocks.wallEndT)
              ? Math.min(boundaryCtx.clocks.wallT + elapsed, boundaryCtx.clocks.wallEndT)
              : boundaryCtx.clocks.wallT + elapsed,
          }
        : {}),
      // The adapter built this action for the current state. A spec or custom adapter action is not in model.actions.
      resolveAgainstModel: false,
    });
    // The boundary decision is an action fact too, applied or refused, as it would be inside runScenario, and its
    // events reach the scenario emitter as a step's events do. They are announced only once the boundary is valid,
    // so a rejected reset leaves no applied action behind with observers.
    const observing = scenario.run.observation?.enabled !== false;
    const boundaryT = state.t;
    const announce = () => {
      if (observing) emitActionFacts(scenario.run.observer, boundaryT, applied.events);
      if (applied.events.length > 0) boundaryCtx.emit?.(applied.events);
    };
    const skipped = applied.events.find((event) => event.type === "action.skipped");
    const fact = applied.committedResets[0];
    if (!fact || skipped) {
      announce();
      const reason = skipReason(fact, skipped && skipped.type === "action.skipped" ? skipped.reason : undefined);
      rows.push({
        index: nextIndex,
        startSec,
        endSec: state.t,
        resetAtSec: null,
        durationSec: played,
        rewardDelta: E.toString(E.zero()),
        accumulatedReward: E.toString(accumulated),
        // An adapter is present here. An action it cannot offer now is a refusal, not a missing adapter.
        resetSkippedReason: action ? reason : "cannot-apply",
        carried: carried(E, state, beforeReward),
      });
      nextIndex += 1;
      guard = "incomplete";
      break;
    }

    // The boundary does not advance time. A reset that moved t would split the clock from the elapsed seconds.
    if (applied.state.t !== state.t) {
      throw new ResetCycleRejected(`reset action ${String(action?.id)} changed t from ${state.t} to ${applied.state.t}`);
    }
    state = applied.state;
    // The carried prestige fields are written to the row and the checkpoint, so they must stay finite.
    if (
      !Number.isFinite(state.prestige.count) ||
      !E.isFinite(state.prestige.points) ||
      !E.isFinite(state.prestige.multiplier)
    ) {
      throw new ResetCycleRejected(`reset action ${String(action?.id)} left nonfinite prestige fields`);
    }
    // stepOnce keeps maxMoneyEver at or above the wallet. The boundary action does not pass through it.
    if (E.cmp(state.wallet.money.amount, state.maxMoneyEver.amount) > 0) {
      state = { ...state, maxMoneyEver: state.wallet.money };
    }
    const afterReward = adapter.reward(boundaryCtx, state);
    const delta = E.sub(afterReward, beforeReward);
    if (!E.isFinite(afterReward) || !E.isFinite(delta)) {
      throw new ResetCycleRejected(`reset adapter ${adapter.id} reward is not finite after the reset`);
    }
    // Finite deltas can still sum past the engine's range. The total is stored and resumed, so it must stay finite.
    const total = E.add(accumulated, delta);
    if (!E.isFinite(total)) {
      throw new ResetCycleRejected(`reset adapter ${adapter.id} accumulated reward is not finite`);
    }
    accumulated = total;
    announce();
    if (action?.kind === "prestige") {
      constraints = recordPrestigeReset(constraints, fact.t, scenario.run.onPrestigeReset);
    }
    const rewardFact: CommittedResetFact = { ...fact, rewardDelta: E.toString(delta) };
    if (observing) emitCommittedResets(scenario.run.observer, [rewardFact]);
    // Only the spec adapter built here applied the spec. A caller's adapter with the same id did not.
    if (builtinSpecAdapters.has(adapter) && scenario.model.prestige) {
      const declared = scenario.model.prestige.multiplierFrom(boundaryCtx, state.prestige.points);
      const multiplierNote = "multiplierFrom was not applied; resetState owns the multiplier";
      if (E.cmp(declared, state.prestige.multiplier) !== 0 && !warnings.includes(multiplierNote)) {
        warnings.push(multiplierNote);
      }
    }
    rows.push({
      index: nextIndex,
      startSec,
      endSec: state.t,
      resetAtSec: fact.t,
      durationSec: played,
      rewardDelta: E.toString(delta),
      accumulatedReward: E.toString(accumulated),
      carried: carried(E, state, afterReward),
    });
    nextIndex += 1;
  }

  const appliedResets = rows.filter((row) => row.resetAtSec !== null).length;
  const artifact: ResetCycleArtifactV1 = {
    schemaVersion: 1,
    algorithmVersion: RESET_CYCLE_ALGORITHM_VERSION,
    status: guard,
    policy: args.policy.kind,
    appliedResets,
    originSec,
    globalElapsedSec: elapsed,
    assumptions: [
      ...(guard === "unsupported" ? ["no prestige action or prestige spec was found at the reset boundary"] : []),
      "reward delta is the adapter metric after the reset minus the metric before it",
      "cycle-local duration is the simulated seconds of the interval",
      "global elapsed is the simulated seconds summed since the study origin",
      "the reset action does not receive an income tick",
    ],
    warnings,
    cycles: rows,
  };
  return {
    artifact,
    state,
    ...(constraints ? { constraints } : {}),
    checkpoint: {
      ...checkpointOf(scenario, args.rng, state, constraints, nextIndex, originSec, accumulated, elapsed),
      ...(args.adapter ? { adapterId: args.adapter.id, adapterKind: args.adapter.kind } : {}),
      ...(pending > 0 ? { pendingSec: pending, pendingDurationSec: pendingDuration, pendingStartSec: pendingStart } : {}),
    },
  };
}

function checkpointOf<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  rng: ResetCycleRng | undefined,
  state: SimState<N, U, Vars>,
  constraints: ScenarioConstraints | undefined,
  nextIndex: number,
  originSec: number,
  accumulatedReward: N,
  elapsedSec: number,
): ResetCycleCheckpoint<N, U, Vars> {
  // Copy live snapshot objects, so later strategy or RNG use cannot rewrite a returned checkpoint.
  // A strategy snapshot is kept only when the strategy can restore it.
  const restorable = !!(scenario.strategy?.snapshotState && scenario.strategy.restoreState);
  const strategyState = restorable ? deepClonePreservingPrototype(scenario.strategy?.snapshotState?.()) : undefined;
  const rngState = deepClonePreservingPrototype(rng?.snapshot());
  return {
    contract: "idlekit.reset-cycle-checkpoint",
    version: 1,
    modelId: scenario.model.id,
    modelVersion: scenario.model.version,
    state: deepClonePreservingPrototype(state),
    ...(constraints ? { constraints: deepClonePreservingPrototype(constraints) } : {}),
    nextIndex,
    originSec,
    elapsedSec,
    accumulatedReward,
    ...(restorable
      ? {
          strategyState,
          ...(scenario.strategy?.id !== undefined ? { strategyId: scenario.strategy.id } : {}),
          ...(scenario.strategy?.stateVersion !== undefined ? { strategyStateVersion: scenario.strategy.stateVersion } : {}),
        }
      : {}),
    ...(rng
      ? {
          rngState,
          rngId: rng.id,
          rngStateVersion: rng.stateVersion,
        }
      : {}),
  };
}
