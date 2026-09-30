import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { createEventBuffer } from "./eventBuffer";
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

  const trace: SimState<N, U, Vars>[] = sc.run.trace ? [state] : [];
  const actionsLog: { t: number; actionId: string; label?: string; bulkSize?: number }[] = [];
  const statsAcc = createSimStatsAccumulator();

  const stepSec = sc.run.stepSec;
  const durationSec = sc.run.durationSec;
  const maxSteps = sc.run.maxSteps;
  const eventLogEnabled = sc.run.eventLog?.enabled ?? true;
  const maxEvents = sc.run.eventLog?.maxEvents;
  const maxActionsPerStep = sc.constraints?.maxActionsPerStep ?? Infinity;
  const everySteps = sc.run.trace?.everySteps ?? 1;
  const eventBuffer = createEventBuffer<N>({
    enabled: eventLogEnabled,
    maxEvents,
  });

  const startT = state.t;
  let steps = 0;
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
      elapsedSec: state.t - startT,
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

    const stepCtx = stepContext(sc.ctx, decision.dt);
    const decisions = (sc.strategy?.decide(stepCtx, sc.model, state) ?? []).slice(0, maxActionsPerStep);
    const actionStartT = state.t;
    const step = stepOnce({
      ctx: stepCtx,
      model: sc.model,
      state,
      dt: decision.dt,
      decisions,
      constraints: sc.constraints,
      fast: sc.run.fast,
    });

    state = step.next;
    statsAcc.push(step.events);
    eventBuffer.pushTimed(timeStepEvents(step.events, actionStartT, state.t));

    if (sc.run.trace?.keepActionsLog && step.actionsApplied?.length) {
      actionsLog.push(...step.actionsApplied);
    }

    steps += 1;
    if (sc.run.trace && steps % everySteps === 0) {
      trace.push(state);
    }
  }

  finishTrace(sc.run.trace !== undefined, trace, state);

  const stats = statsAcc.snapshot();
  const uxFlags = analyzeUX(stats);
  const retained = eventBuffer.snapshot();

  return {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    trace: sc.run.trace ? trace : undefined,
    actionsLog: sc.run.trace?.keepActionsLog ? actionsLog : undefined,
    stats,
    uxFlags,
    eventLog: retained.eventLog,
    stop,
  };
}
