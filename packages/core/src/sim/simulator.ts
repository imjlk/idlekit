import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { stepOnce } from "./step";
import type { CompiledScenario, RunResult, SimEvent, SimState } from "./types";

export function runScenario<N, U extends string, Vars>(
  sc: CompiledScenario<N, U, Vars>,
): RunResult<N, U, Vars> {
  let state = sc.initial;
  const start = sc.initial;

  const events: SimEvent<N>[] = [];
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

  const startT = state.t;
  let steps = 0;
  let totalSeenEvents = 0;
  let droppedEvents = 0;

  if (durationSec === undefined && !sc.run.until && maxSteps === undefined) {
    throw new Error("runScenario requires at least one stop condition: durationSec, until, or maxSteps");
  }

  if (maxSteps !== undefined && maxSteps < 0) {
    throw new Error("runScenario maxSteps must be >= 0");
  }
  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("runScenario eventLog.maxEvents must be an integer >= 0");
  }

  const retainEvents = (batch: readonly SimEvent<N>[]): void => {
    statsAcc.push(batch);
    totalSeenEvents += batch.length;
    if (!eventLogEnabled || batch.length === 0) return;

    if (maxEvents === 0) {
      droppedEvents += batch.length;
      return;
    }

    if (maxEvents === undefined) {
      events.push(...batch);
      return;
    }

    if (batch.length >= maxEvents) {
      droppedEvents += events.length + (batch.length - maxEvents);
      events.splice(0, events.length, ...batch.slice(batch.length - maxEvents));
      return;
    }

    const overflow = Math.max(0, events.length + batch.length - maxEvents);
    if (overflow > 0) {
      events.splice(0, overflow);
      droppedEvents += overflow;
    }
    events.push(...batch);
  };

  while (true) {
    if (maxSteps !== undefined && steps >= maxSteps) {
      throw new Error(`runScenario exceeded maxSteps (${maxSteps}) without meeting stop condition`);
    }
    if (durationSec !== undefined && state.t - startT >= durationSec) break;
    if (sc.run.until?.(state)) break;

    const decisions = (sc.strategy?.decide(sc.ctx, sc.model, state) ?? []).slice(0, maxActionsPerStep);
    const step = stepOnce({
      ctx: sc.ctx,
      model: sc.model,
      state,
      dt: stepSec,
      decisions,
      constraints: sc.constraints,
      fast: sc.run.fast,
    });

    state = step.next;
    retainEvents(step.events);

    if (sc.run.trace?.keepActionsLog && step.actionsApplied?.length) {
      actionsLog.push(...step.actionsApplied);
    }

    steps += 1;
    if (sc.run.trace && steps % everySteps === 0) {
      trace.push(state);
    }
  }

  const stats = statsAcc.snapshot();
  const uxFlags = analyzeUX(stats);

  return {
    start,
    end: state,
    events,
    trace: sc.run.trace ? trace : undefined,
    actionsLog: sc.run.trace?.keepActionsLog ? actionsLog : undefined,
    stats,
    uxFlags,
    eventLog: {
      enabled: eventLogEnabled,
      maxEvents,
      totalSeen: totalSeenEvents,
      dropped: eventLogEnabled ? droppedEvents : totalSeenEvents,
      retained: events.length,
    },
  };
}
