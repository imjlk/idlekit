import type { OfflineActionPolicy, OfflinePolicy } from "../scenario/offlinePolicy";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import { analyzeUX } from "./analysis/ux";
import { recordPrestigeReset } from "./constraints";
import { createBoundedLog, createEventBuffer } from "./eventBuffer";
import { createObservationRecorder, statsFromObservation } from "./observation";
import { resolveOfflineSeconds } from "./offlineCredit";
import { stepOnce } from "./step";
import { assertSimulationClock, nextBoundary, stepContext, timeEpsilon, timeStepEvents } from "./timeBoundary";
import type { Action, CompiledScenario, RunResult, RunStop, SimState } from "./types";

export type OfflineRunOptions<N, U extends string, Vars> = Readonly<{
  fromState?: SimState<N, U, Vars>;
  stepSec?: number;
  useStrategy?: boolean;
  maxSteps?: number;
  fast?: CompiledScenario<N, U, Vars>["run"]["fast"];
  eventLog?: CompiledScenario<N, U, Vars>["run"]["eventLog"];
  policy?: OfflinePolicy;
  /** Overrides `policy.actions` and `scenario.run.offline.actions` for this call. */
  actions?: OfflineActionPolicy;
  /**
   * Session stop. Omitted means this call ignores `scenario.run.until`.
   * That is the legacy direct contract.
   */
  until?: (state: SimState<N, U, Vars>) => boolean;
}>;

export type OfflineRunResult<N, U extends string, Vars> = Readonly<
  RunResult<N, U, Vars> & {
    offline: Readonly<{
      requestedSec: number;
      preDecaySec: number;
      effectiveSec: number;
      simulatedSec: number;
      stepSec: number;
      fullSteps: number;
      remainderSec: number;
      usedStrategy: boolean;
      actionPolicy: "legacy-all" | "none" | "allow";
      overflow: "none" | "clamped";
      decay: Readonly<{
        kind: "none" | "linear";
        ratio: number;
      }>;
    }>;
  }
>;

export function resolveOfflineActionPolicy(args: {
  policy?: OfflineActionPolicy;
  useStrategy?: boolean;
  hasStrategy: boolean;
}): Readonly<{ callStrategy: boolean; policy: OfflineActionPolicy }> {
  if (args.useStrategy === false) return { callStrategy: false, policy: { mode: "none" } };
  const policy = args.policy ?? { mode: "legacy-all" };
  if (policy.mode === "none") return { callStrategy: false, policy: { mode: "none" } };
  if (policy.mode === "allow") return { callStrategy: true, policy };
  return {
    callStrategy: args.useStrategy ?? args.hasStrategy,
    policy: { mode: "legacy-all" },
  };
}

function allowsOfflineAction(
  action: Pick<Action<unknown, string, unknown>, "kind" | "actor">,
  policy: OfflineActionPolicy,
): boolean {
  if (policy.mode !== "allow") return true;
  if (!policy.categories.includes(action.kind)) return false;
  if (policy.actors === undefined) return true;
  if (action.actor === undefined) return false;
  return policy.actors.includes(action.actor);
}

/**
 * Catch up reward time with the same partial-tick and budget rules as `runScenario`.
 * `state.t` advances by simulated reward seconds, not by the requested absence.
 * A short `maxSteps` stops with reason `budget` instead of throwing the completed time away.
 * `stepOnce` is still the only economy transition.
 * Omitting `options.until` does not read `scenario.run.until`.
 *
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries Applies the same horizon, partial tick, and step budget as the online runner.
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #89f7aa9 Re-read the section: offline uses that partial tick, and a short maxSteps returns budget instead of discarding the run.
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Steps reward time only. `requestedSec` stays the caller absence, and `useStrategy: false` or policy `none` does not call `decide`.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #3c24d94 Re-read the section: state.t moves by simulated reward seconds, and a direct call does not turn the requested absence into state.t. The gap-end rule for a stop inside an offline gap belongs to the session, not to this direct call.
 */
export function applyOfflineSeconds<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  seconds: number;
  options?: OfflineRunOptions<N, U, Vars>;
}): OfflineRunResult<N, U, Vars> {
  const { scenario, seconds } = args;
  const opts = args.options;

  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`offline seconds must be a finite number >= 0 (received: ${seconds})`);
  }

  const stepSec = opts?.stepSec ?? scenario.run.stepSec;
  const maxSteps = opts?.maxSteps;
  assertSimulationClock("offline", { stepSec, maxSteps });

  const capPolicy = opts?.policy ?? scenario.run.offline;
  const resolvedPolicy = resolveOfflineActionPolicy({
    policy: opts?.actions ?? capPolicy?.actions,
    useStrategy: opts?.useStrategy,
    hasStrategy: !!scenario.strategy,
  });
  const useStrategy = resolvedPolicy.callStrategy;
  const untilFn = opts?.until;
  const start = opts?.fromState ?? scenario.initial;

  const eventLogEnabled = opts?.eventLog?.enabled ?? scenario.run.eventLog?.enabled ?? true;
  const maxEvents = opts?.eventLog?.maxEvents ?? scenario.run.eventLog?.maxEvents;

  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("offline eventLog.maxEvents must be an integer >= 0");
  }

  const resolved = resolveOfflineSeconds(seconds, capPolicy);
  assertSimulationClock("offline", { stepSec, durationSec: resolved.effectiveSec, maxSteps });
  const fullSteps = Math.floor(resolved.effectiveSec / stepSec);
  const remainderRaw = resolved.effectiveSec - fullSteps * stepSec;
  const remainderSec = remainderRaw > timeEpsilon(resolved.effectiveSec) ? remainderRaw : 0;

  const recorder = createObservationRecorder({
    enabled: scenario.run.observation?.enabled !== false,
    startT: start.t,
    maxMilestones: scenario.run.observation?.maxMilestones ?? 64,
    maxGoals: scenario.run.observation?.maxGoals ?? 32,
    goals: scenario.run.goals ?? [],
    observer: scenario.run.observer,
  });
  const eventBuffer = createEventBuffer<N>({
    enabled: eventLogEnabled,
    maxEvents,
  });
  const actionsLog: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];
  const actionBudget = scenario.run.trace?.maxActions;
  const actionLog =
    actionBudget !== undefined
      ? createBoundedLog<{ t: number; actionId: string; label?: string; bulkSize?: number }>(actionBudget, "applyOfflineSeconds trace.maxActions")
      : undefined;

  let state = start;
  let steps = 0;
  let simulatedSec = 0;
  const maxActionsPerStep = scenario.constraints?.maxActionsPerStep ?? Infinity;
  let constraints = scenario.constraints;
  let stop: RunStop | undefined;

  while (stop === undefined) {
    const decision = nextBoundary({
      elapsedSec: simulatedSec,
      steps,
      stepSec,
      durationSec: resolved.effectiveSec,
      untilMet: untilFn?.(state) ?? false,
      hasUntil: untilFn !== undefined,
      maxSteps,
    });
    if (decision.kind === "guard") {
      throw new Error(`offline run exceeded maxSteps (${maxSteps}) without meeting stop condition`);
    }
    if (decision.kind === "stop") {
      stop = decision.stop;
      break;
    }

    const stepCtx = stepContext(
      { ...scenario.ctx, ...(constraints ? { constraints } : {}) },
      decision.dt,
    );
    // A snapshot pair may save undefined. It is still the state to restore.
    const restorable =
      resolvedPolicy.policy.mode === "allow" &&
      typeof scenario.strategy?.snapshotState === "function" &&
      typeof scenario.strategy.restoreState === "function";
    // Clone before decide. A snapshot that aliases the cursor would advance with it.
    const saved = restorable ? deepClonePreservingPrototype(scenario.strategy?.snapshotState?.()) : undefined;
    const raw = useStrategy ? (scenario.strategy?.decide(stepCtx, scenario.model, state) ?? []) : [];
    const filtered = raw.filter((decision) => allowsOfflineAction(decision.action, resolvedPolicy.policy));
    // Restore only a batch the policy rejected whole. An empty decide keeps its own state.
    // A mixed batch applies its listed part and does not restore, or that part would replay.
    if (restorable && raw.length > 0 && filtered.length === 0) {
      scenario.strategy?.restoreState?.(saved);
    }
    const decisions = filtered.slice(0, maxActionsPerStep);
    const actionStartT = state.t;
    const out = stepOnce({
      ctx: stepCtx,
      model: scenario.model,
      state,
      dt: decision.dt,
      decisions,
      constraints,
      fast: opts?.fast ?? scenario.run.fast,
    });
    constraints = recordPrestigeReset(constraints, out.prestigeResetT, scenario.run.onPrestigeReset);

    state = out.next;
    simulatedSec += decision.dt;
    steps += 1;
    recorder.recordStep({
      t0: actionStartT,
      t1: state.t,
      dt: decision.dt,
      events: out.events,
      observedMoney: out.observedMoney,
      prestigeChanged:
        out.next.prestige.count !== out.prev.prestige.count ||
        String(out.next.prestige.points) !== String(out.prev.prestige.points),
      state,
    });
    eventBuffer.pushTimed(timeStepEvents(out.events, actionStartT, state.t));
    if (out.actionsApplied?.length) {
      if (actionLog) {
        for (const row of out.actionsApplied) actionLog.push(row);
      } else {
        actionsLog.push(...out.actionsApplied);
      }
    }
  }

  const observation = recorder.finish();
  const stats = statsFromObservation(observation);
  const uxFlags = analyzeUX(stats);
  const retained = eventBuffer.snapshot();
  const loggedActions = actionLog?.snapshot();

  return {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    actionsLog: loggedActions ? loggedActions.items : actionsLog.length > 0 ? actionsLog : undefined,
    observation,
    ...(loggedActions
      ? {
          actionsLogMeta: {
            maxActions: actionBudget,
            totalSeen: loggedActions.totalSeen,
            dropped: loggedActions.dropped,
            retained: loggedActions.retained,
          },
        }
      : {}),
    stats,
    uxFlags,
    eventLog: retained.eventLog,
    stop,
    offline: {
      requestedSec: seconds,
      preDecaySec: resolved.preDecaySec,
      effectiveSec: resolved.effectiveSec,
      simulatedSec,
      stepSec,
      fullSteps,
      remainderSec,
      usedStrategy: useStrategy,
      actionPolicy: resolvedPolicy.policy.mode,
      overflow: resolved.overflow,
      decay: {
        kind: resolved.decayKind,
        ratio: resolved.decayRatio,
      },
    },
  };
}
