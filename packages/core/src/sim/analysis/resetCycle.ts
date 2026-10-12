import typia, { type IValidation } from "typia";
import type { Engine } from "../../engine/types";
import { recordPrestigeReset } from "../constraints";
import { emitCommittedResets } from "../observation";
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
/** Relative slack for summed fractional intervals, such as 0.1 three times against a 0.3 horizon. */
const HORIZON_TOLERANCE = 1e-9;
/** The slack is also capped by this share of the next interval, so a long horizon cannot admit a whole extra interval. */
const INTERVAL_TOLERANCE = 1e-6;
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
  rngState?: unknown;
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

function assertPositiveTime(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw new ResetCycleRejected(`reset cycle ${label} must be a finite number > 0`);
  }
}

function actionAdapter<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  kind: "prestige" | "custom",
): ResetAdapter<N, U, Vars> {
  return {
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
}

function specAdapter<N, U extends string, Vars>(model: Model<N, U, Vars>): ResetAdapter<N, U, Vars> | undefined {
  const spec = model.prestige;
  if (!spec) return undefined;
  return {
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
  const originSec = args.resume?.originSec ?? args.resume?.state.t ?? scenario.initial.t;
  // Resume from copies, so in-place edits during the run cannot rewrite the checkpoint.
  let state = args.resume ? deepClonePreservingPrototype(args.resume.state) : scenario.initial;
  let constraints = args.resume?.constraints
    ? deepClonePreservingPrototype(args.resume.constraints)
    : scenario.constraints;
  let accumulated = args.resume?.accumulatedReward ?? E.zero();
  let nextIndex = args.resume?.nextIndex ?? 0;
  // Restore from a copy, so a restore that keeps or edits its argument cannot change the checkpoint.
  // Presence is the key, not the value: an undefined snapshot is still restored.
  // A saved snapshot needs something to restore it into. Dropping it would resume on a different stream.
  if (args.resume && "strategyState" in args.resume) {
    const restore = scenario.strategy?.restoreState;
    if (!restore) {
      throw new ResetCycleRejected("reset cycle checkpoint has strategyState, but the strategy has no restoreState");
    }
    restore.call(scenario.strategy, deepClonePreservingPrototype(args.resume.strategyState));
  }
  if (args.resume && "rngState" in args.resume) {
    if (!args.rng) throw new ResetCycleRejected("reset cycle checkpoint has rngState, but no rng was passed");
    args.rng.restore(deepClonePreservingPrototype(args.resume.rngState));
  }
  // The context the runner and the boundary action see: the scenario context with the live constraints.
  const liveCtx = (): SimContext<N, U, Vars> => ({ ...scenario.ctx, ...(constraints ? { constraints } : {}) });
  const startAdapter = resetAdapterFor(scenario, args.adapter, state, liveCtx());
  // Elapsed seconds are summed from runner results. Absolute t can round away from simulated time.
  let elapsed = args.resume?.elapsedSec ?? state.t - originSec;

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
    // The slack is relative only, so a zero horizon admits no positive interval, and it is capped by a share of
    // the interval, so a horizon of 1e9 seconds does not admit a 0.5-second interval past it.
    const slack =
      args.horizonSec === undefined ? 0 : Math.min(args.horizonSec * HORIZON_TOLERANCE, duration * INTERVAL_TOLERANCE);
    if (args.horizonSec !== undefined && elapsed + duration > args.horizonSec + slack) {
      guard = "censored";
      warnings.push("horizon");
      break;
    }

    const startSec = state.t;
    const intervalAdapter = args.adapter ?? resetAdapterFor(scenario, undefined, state, liveCtx()) ?? startAdapter;
    const { maxSteps: _ignoredMax, until: _ignoredUntil, trace: _ignoredTrace, ...runRest } = scenario.run;
    const run = runScenario({
      ...scenario,
      model: withoutResetActions(scenario.model, intervalAdapter),
      initial: state,
      ...(constraints ? { constraints } : {}),
      run: {
        ...runRest,
        durationSec: duration,
        ...(remainingBudget !== undefined ? { maxSteps: remainingBudget } : {}),
      },
    });
    if (remainingBudget !== undefined) remainingBudget = Math.max(0, remainingBudget - (run.stop?.steps ?? 0));
    // The runner's elapsed seconds, not an end.t difference that rounds at a large t.
    const played = runElapsedSec(run);
    elapsed += played;
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
      nextIndex += 1;
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
    if (adapter.id === "prestige.action" && scenario.model.prestige && !warnings.includes(specNote)) {
      warnings.push(specNote);
    }

    const beforeReward = adapter.reward(boundaryCtx, state);
    const action = adapter.action(boundaryCtx, state);
    const kinds = new Set<"prestige" | "custom">();
    if (action && (action.kind === "prestige" || action.kind === "custom")) kinds.add(action.kind);
    const applied = applyDecisions({
      ctx: boundaryCtx,
      model: scenario.model,
      state,
      decisions: action ? [{ action }] : [],
      constraints,
      resetKinds: kinds,
      // The adapter built this action for the current state. A spec or custom adapter action is not in model.actions.
      resolveAgainstModel: false,
    });
    const skipped = applied.events.find((event) => event.type === "action.skipped");
    const fact = applied.committedResets[0];
    if (!fact || skipped) {
      const reason = skipReason(fact, skipped && skipped.type === "action.skipped" ? skipped.reason : undefined);
      rows.push({
        index: nextIndex,
        startSec,
        endSec: state.t,
        resetAtSec: null,
        durationSec: played,
        rewardDelta: E.toString(E.zero()),
        accumulatedReward: E.toString(accumulated),
        resetSkippedReason: action ? reason : "missing-adapter",
        carried: carried(E, state, beforeReward),
      });
      nextIndex += 1;
      guard = "incomplete";
      break;
    }

    state = applied.state;
    // stepOnce keeps maxMoneyEver at or above the wallet. The boundary action does not pass through it.
    if (E.cmp(state.wallet.money.amount, state.maxMoneyEver.amount) > 0) {
      state = { ...state, maxMoneyEver: state.wallet.money };
    }
    const afterReward = adapter.reward(boundaryCtx, state);
    const delta = E.sub(afterReward, beforeReward);
    accumulated = E.add(accumulated, delta);
    if (action?.kind === "prestige") {
      constraints = recordPrestigeReset(constraints, fact.t, scenario.run.onPrestigeReset);
    }
    const rewardFact: CommittedResetFact = { ...fact, rewardDelta: E.toString(delta) };
    emitCommittedResets(scenario.run.observer, [rewardFact]);
    if (adapter.id === "prestige.spec" && scenario.model.prestige) {
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
    checkpoint: checkpointOf(scenario, args.rng, state, constraints, nextIndex, originSec, accumulated, elapsed),
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
    state: deepClonePreservingPrototype(state),
    ...(constraints ? { constraints: deepClonePreservingPrototype(constraints) } : {}),
    nextIndex,
    originSec,
    elapsedSec,
    accumulatedReward,
    ...(restorable ? { strategyState } : {}),
    ...(rng ? { rngState } : {}),
  };
}
