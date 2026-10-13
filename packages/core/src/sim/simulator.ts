import { advanceCapabilityOf, consumeExactChunk, createAdvanceLedger, finishAdvanceReport, type AdvanceReportV1 } from "./advance";
import { analyzeUX } from "./analysis/ux";
import { recordPrestigeReset } from "./constraints";
import { createBoundedLog, createEventBuffer } from "./eventBuffer";
import { observationLedger } from "./goalRead";
import { createObservationRecorder, emitCommittedResets, statsFromObservation } from "./observation";
import { stepOnce } from "./step";
import { assertSimulationClock, assertTickAdvanced, nextBoundary, stepContext, timeStepEvents } from "./timeBoundary";
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
 * @evidenceReview docs/requirements/active/simulation-time-boundaries.md#req-pr02-simulation-time-boundaries #c6da01b Re-read the section: a duration or until that is already met stops before maxSteps, the last tick stays inside the horizon, and a committed tick that does not move state.t throws through assertTickAdvanced, including a sub-ulp partial tick before any tick moved t.
 * @evidence docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match With run.advance enabled, an exact chunk records one sample per reference step on the summed clock, and any refused step runs stepOnce.
 * @evidenceReview docs/requirements/active/guarded-analytic-advance.md#req-pr16-exact-match #e92627f Re-read the section: the chunk takes the dt nextBoundary chose, and onStep adds each sample's dt to elapsedSec and records the sample with no events as the chunk takes it.
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
  const actionsLog: { t: number; elapsedSec: number; actionId: string; label?: string; bulkSize?: number }[] = [];
  const actionLog =
    sc.run.trace?.keepActionsLog && sc.run.trace.maxActions !== undefined
      ? createBoundedLog<{ t: number; elapsedSec: number; actionId: string; label?: string; bulkSize?: number }>(sc.run.trace.maxActions, "runScenario trace.maxActions")
      : undefined;
  const recorder = createObservationRecorder({
    enabled: sc.run.observation?.enabled !== false,
    startT: state.t,
    maxMilestones: sc.run.observation?.maxMilestones ?? 64,
    maxGoals: sc.run.observation?.maxGoals ?? 32,
    goals: sc.run.goals ?? [],
    observer: sc.run.observer,
    ledger: observationLedger(sc.run.observation),
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

  assertSimulationClock("runScenario", { stepSec, durationSec, maxSteps, startT: start.t });
  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("runScenario eventLog.maxEvents must be an integer >= 0");
  }

  recorder.recordStart(state);
  let stop: RunStop | undefined;
  const advance = sc.run.advance;
  const advanceLedger = advance?.enabled
    ? createAdvanceLedger(advance.tolerance !== undefined ? "approximation" : "exact", advance.tolerance ?? null)
    : undefined;
  // Read once, from the start state, with the context the gate sees on the first tick.
  let advanceCapability: AdvanceReportV1["capability"] | undefined;
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

    const tickCtx = { ...sc.ctx, ...(constraints ? { constraints } : {}) };
    if (advanceLedger) {
      advanceCapability ??= advanceCapabilityOf(sc.model, stepContext(tickCtx, decision.dt), state);
      const consumed = consumeExactChunk({
        ctx: tickCtx,
        model: sc.model,
        state,
        firstDt: decision.dt,
        stepSec,
        chunkSec: advance?.chunkSec ?? decision.dt,
        elapsedSec,
        steps,
        durationSec,
        maxSteps,
        until: sc.run.until,
        requested: advanceLedger.requested,
        strategy: sc.strategy,
        // One observation sample per reference step, recorded as the chunk takes it. The chunk adds no events,
        // so the event log is not a per-tick transcript.
        onStep: (sample) => {
          assertTickAdvanced("runScenario", sample.t0, sample.t1, sample.dt, stepSec, start.t);
          recorder.recordStep({
            t0: sample.t0,
            t1: sample.t1,
            dt: sample.dt,
            events: [],
            observedMoney: { applied: 1, dropped: 0, queued: 0, flushed: 0, blocked: 0, rewarded: sample.rewarded },
            prestigeApplied: false,
            state: sample.state,
          });
          state = sample.state;
          steps += 1;
          elapsedSec += sample.dt;
          if (traceLog && steps % everySteps === 0) {
            traceLog.push(state);
            lastTraced = state;
          } else if (sc.run.trace && traceLog === undefined && steps % everySteps === 0) trace.push(state);
        },
      });
      if (consumed.ok) {
        advanceLedger.exactSteps += consumed.steps;
        advanceLedger.chunks += 1;
        continue;
      }
      if (!advanceLedger.reasons.includes(consumed.reason)) advanceLedger.reasons.push(consumed.reason);
    }
    const stepCtx = stepContext(tickCtx, decision.dt);
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
      // Inside a session segment, wall time advances with the runner's summed tick seconds.
      ...(sc.ctx.clocks ? { wallT: sc.ctx.clocks.wallT + elapsedSec } : {}),
    });
    assertTickAdvanced("runScenario", actionStartT, step.next.t, decision.dt, stepSec, start.t);
    constraints = recordPrestigeReset(constraints, step.prestigeResetT, sc.run.onPrestigeReset);

    state = step.next;
    recorder.recordStep({
      t0: actionStartT,
      t1: state.t,
      dt: decision.dt,
      events: step.events,
      observedMoney: step.observedMoney,
      prestigeApplied: step.prestigeResetT !== undefined,
      state,
    });
    // The reset fact follows the action fact the recorder sent, as at a reset-cycle boundary. A run with observation
    // off notifies no observer, resets included, as the recorder does for the rest.
    if (sc.run.observation?.enabled !== false) emitCommittedResets(sc.run.observer, step.committedResets ?? []);
    eventBuffer.pushTimed(timeStepEvents(step.events, actionStartT, state.t));

    if (sc.run.trace?.keepActionsLog && step.actionsApplied?.length) {
      for (const row of step.actionsApplied) {
        const timedRow = { ...row, elapsedSec };
        if (actionLog) actionLog.push(timedRow);
        else actionsLog.push(timedRow);
      }
    }

    steps += 1;
    elapsedSec += decision.dt;
    if (advanceLedger) advanceLedger.fallbackSteps += 1;
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
    ...(advanceLedger
      ? {
          advance: finishAdvanceReport(
            advanceLedger,
            advanceCapability ??
              advanceCapabilityOf(sc.model, stepContext({ ...sc.ctx, ...(sc.constraints ? { constraints: sc.constraints } : {}) }, stepSec), start),
          ),
        }
      : {}),
  };
}
