import { analyzeUX } from "./analysis/ux";
import { recordPrestigeReset } from "./constraints";
import { createBoundedLog, createEventBuffer } from "./eventBuffer";
import { createObservationRecorder, statsFromObservation } from "./observation";
import { stepOnce } from "./step";
import { assertSimulationClock, nextBoundary, stepContext, timeStepEvents } from "./timeBoundary";
import type { CompiledScenario, RunResult, RunStop, SimState } from "./types";

function finishTrace<N, U extends string, Vars>(
  enabled: boolean,
  trace: SimState<N, U, Vars>[],
  state: SimState<N, U, Vars>,
): void {
  if (!enabled) return;
  const last = trace[trace.length - 1];
  if (last !== state) trace.push(state);
}

/**
 * Run until duration, until, or the step budget.
 * The last tick uses the time still inside duration. `stepOnce` is the only economy transition.
 * The caller's `ctx` is not written. Strategy preview sees that tick's dt.
 *
 * @evidence docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries Stops on the economic horizon, including a shorter last tick, and checks that horizon before maxSteps.
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #89f7aa9 Re-read the section: a duration or until that is already met stops before maxSteps, and the last tick stays inside the horizon.
 */
export function runScenario<N, U extends string, Vars>(
  sc: CompiledScenario<N, U, Vars>,
): RunResult<N, U, Vars> {
  let state = sc.initial;
  const start = sc.initial;

  const trace: SimState<N, U, Vars>[] = sc.run.trace && sc.run.trace.maxPoints === undefined ? [state] : [];
  const traceLog = sc.run.trace && sc.run.trace.maxPoints !== undefined ? createBoundedLog<SimState<N, U, Vars>>(sc.run.trace.maxPoints, "runScenario trace.maxPoints") : undefined;
  if (traceLog) traceLog.push(state);
  // The last state offered to traceLog. A budget of 0 retains none, so the buffer cannot say.
  let lastTraced = state;
  const actionsLog: { t: number; actionId: string; label?: string; bulkSize?: number }[] = [];
  const actionLog =
    sc.run.trace?.keepActionsLog && sc.run.trace.maxActions !== undefined
      ? createBoundedLog<{ t: number; actionId: string; label?: string; bulkSize?: number }>(sc.run.trace.maxActions, "runScenario trace.maxActions")
      : undefined;
  const recorder = createObservationRecorder({
    enabled: sc.run.observation?.enabled !== false,
    startT: state.t,
    maxMilestones: sc.run.observation?.maxMilestones ?? 64,
    maxGoals: sc.run.observation?.maxGoals ?? 32,
    goals: sc.run.goals ?? [],
    observer: sc.run.observer,
  });

  const stepSec = sc.run.stepSec;
  const durationSec = sc.run.durationSec;
  const maxSteps = sc.run.maxSteps;
  const eventLogEnabled = sc.run.eventLog?.enabled ?? true;
  const maxEvents = sc.run.eventLog?.maxEvents;
  const maxActionsPerStep = sc.constraints?.maxActionsPerStep ?? Infinity;
  let constraints = sc.constraints;
  const everySteps = sc.run.trace?.everySteps ?? 1;
  const eventBuffer = createEventBuffer<N>({
    enabled: eventLogEnabled,
    maxEvents,
  });

  let steps = 0;
  let elapsedSec = 0;
  if (durationSec === undefined && !sc.run.until && maxSteps === undefined) {
    throw new Error("runScenario requires at least one stop condition: durationSec, until, or maxSteps");
  }

  assertSimulationClock("runScenario", { stepSec, durationSec, maxSteps });
  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("runScenario eventLog.maxEvents must be an integer >= 0");
  }

  let stop: RunStop | undefined;
  while (stop === undefined) {
    const decision = nextBoundary({
      elapsedSec,
      steps,
      stepSec,
      durationSec,
      untilMet: sc.run.until?.(state) ?? false,
      hasUntil: sc.run.until !== undefined,
      maxSteps,
    });
    if (decision.kind === "guard") {
      throw new Error(`runScenario exceeded maxSteps (${maxSteps}) without meeting stop condition`);
    }
    if (decision.kind === "stop") {
      stop = decision.stop;
      break;
    }

    const stepCtx = stepContext(
      { ...sc.ctx, ...(constraints ? { constraints } : {}) },
      decision.dt,
    );
    const decisions = (sc.strategy?.decide(stepCtx, sc.model, state) ?? []).slice(0, maxActionsPerStep);
    const actionStartT = state.t;
    const step = stepOnce({
      ctx: stepCtx,
      model: sc.model,
      state,
      dt: decision.dt,
      decisions,
      constraints,
      fast: sc.run.fast,
    });
    constraints = recordPrestigeReset(constraints, step.prestigeResetT, sc.run.onPrestigeReset);

    state = step.next;
    recorder.recordStep({
      t0: actionStartT,
      t1: state.t,
      dt: decision.dt,
      events: step.events,
      observedMoney: step.observedMoney,
      prestigeChanged:
        step.next.prestige.count !== step.prev.prestige.count ||
        String(step.next.prestige.points) !== String(step.prev.prestige.points),
      state,
    });
    eventBuffer.pushTimed(timeStepEvents(step.events, actionStartT, state.t));

    if (sc.run.trace?.keepActionsLog && step.actionsApplied?.length) {
      if (actionLog) {
        for (const row of step.actionsApplied) actionLog.push(row);
      } else {
        actionsLog.push(...step.actionsApplied);
      }
    }

    steps += 1;
    elapsedSec += decision.dt;
    if (traceLog && steps % everySteps === 0) {
      traceLog.push(state);
      lastTraced = state;
    } else if (sc.run.trace && traceLog === undefined && steps % everySteps === 0) trace.push(state);
  }

  if (traceLog) {
    if (lastTraced !== state) traceLog.push(state);
  } else {
    finishTrace(sc.run.trace !== undefined, trace, state);
  }

  const observation = recorder.finish();
  const stats = statsFromObservation(observation);
  const uxFlags = analyzeUX(stats);
  const retained = eventBuffer.snapshot();
  const traced = traceLog?.snapshot();
  const loggedActions = actionLog?.snapshot();

  return {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    trace: sc.run.trace ? (traced ? traced.items : trace) : undefined,
    actionsLog: sc.run.trace?.keepActionsLog ? (loggedActions ? loggedActions.items : actionsLog) : undefined,
    stats,
    uxFlags,
    observation,
    ...(traced
      ? {
          traceLog: {
            maxPoints: sc.run.trace?.maxPoints,
            totalSeen: traced.totalSeen,
            dropped: traced.dropped,
            retained: traced.retained,
          },
        }
      : {}),
    ...(loggedActions
      ? {
          actionsLogMeta: {
            maxActions: sc.run.trace?.maxActions,
            totalSeen: loggedActions.totalSeen,
            dropped: loggedActions.dropped,
            retained: loggedActions.retained,
          },
        }
      : {}),
    eventLog: retained.eventLog,
    stop,
  };
}
