import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { stepOnce } from "./step";
import type { CompiledScenario, RunResult, SimEvent, SimState } from "./types";

export type OfflineRunOptions<N, U extends string, Vars> = Readonly<{
  fromState?: SimState<N, U, Vars>;
  stepSec?: number;
  useStrategy?: boolean;
  maxSteps?: number;
  fast?: CompiledScenario<N, U, Vars>["run"]["fast"];
  eventLog?: CompiledScenario<N, U, Vars>["run"]["eventLog"];
}>;

export type OfflineRunResult<N, U extends string, Vars> = Readonly<
  RunResult<N, U, Vars> & {
    offline: Readonly<{
      requestedSec: number;
      simulatedSec: number;
      stepSec: number;
      fullSteps: number;
      remainderSec: number;
      usedStrategy: boolean;
    }>;
  }
>;

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
  if (!Number.isFinite(stepSec) || stepSec <= 0) {
    throw new Error(`offline stepSec must be > 0 (received: ${stepSec})`);
  }

  const useStrategy = opts?.useStrategy ?? !!scenario.strategy;
  const start = opts?.fromState ?? scenario.initial;

  const eventLogEnabled = opts?.eventLog?.enabled ?? scenario.run.eventLog?.enabled ?? true;
  const maxEvents = opts?.eventLog?.maxEvents ?? scenario.run.eventLog?.maxEvents;

  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    throw new Error("offline eventLog.maxEvents must be an integer >= 0");
  }

  const fullSteps = Math.floor(seconds / stepSec);
  const remainderRaw = seconds - fullSteps * stepSec;
  const remainderEpsilon = Math.max(1e-12, seconds * 1e-12);
  const remainderSec = remainderRaw > remainderEpsilon ? remainderRaw : 0;

  const plannedSteps = fullSteps + (remainderSec > 0 ? 1 : 0);
  const maxSteps = opts?.maxSteps;
  if (maxSteps !== undefined && plannedSteps > maxSteps) {
    throw new Error(`offline run exceeded maxSteps (${maxSteps}); required=${plannedSteps}`);
  }

  const statsAcc = createSimStatsAccumulator();
  const events: SimEvent<N>[] = [];

  let totalSeenEvents = 0;
  let droppedEvents = 0;

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

  let state = start;
  const maxActionsPerStep = scenario.constraints?.maxActionsPerStep ?? Infinity;

  for (let i = 0; i < fullSteps; i++) {
    const decisions = useStrategy
      ? (scenario.strategy?.decide(scenario.ctx, scenario.model, state) ?? []).slice(0, maxActionsPerStep)
      : [];

    const out = stepOnce({
      ctx: scenario.ctx,
      model: scenario.model,
      state,
      dt: stepSec,
      decisions,
      constraints: scenario.constraints,
      fast: opts?.fast ?? scenario.run.fast,
    });

    state = out.next;
    retainEvents(out.events);
  }

  if (remainderSec > 0) {
    const decisions = useStrategy
      ? (scenario.strategy?.decide(scenario.ctx, scenario.model, state) ?? []).slice(0, maxActionsPerStep)
      : [];

    const out = stepOnce({
      ctx: scenario.ctx,
      model: scenario.model,
      state,
      dt: remainderSec,
      decisions,
      constraints: scenario.constraints,
      fast: opts?.fast ?? scenario.run.fast,
    });

    state = out.next;
    retainEvents(out.events);
  }

  const stats = statsAcc.snapshot();
  const uxFlags = analyzeUX(stats);

  return {
    start,
    end: state,
    events,
    stats,
    uxFlags,
    eventLog: {
      enabled: eventLogEnabled,
      maxEvents,
      totalSeen: totalSeenEvents,
      dropped: eventLogEnabled ? droppedEvents : totalSeenEvents,
      retained: events.length,
    },
    offline: {
      requestedSec: seconds,
      simulatedSec: fullSteps * stepSec + remainderSec,
      stepSec,
      fullSteps,
      remainderSec,
      usedStrategy: useStrategy,
    },
  };
}
