import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { stepOnce } from "./step";
import type { CompiledScenario, RunResult, SimEvent, SimState, TimedSimEvent } from "./types";

export type OfflineRunOptions<N, U extends string, Vars> = Readonly<{
  fromState?: SimState<N, U, Vars>;
  stepSec?: number;
  useStrategy?: boolean;
  maxSteps?: number;
  fast?: CompiledScenario<N, U, Vars>["run"]["fast"];
  eventLog?: CompiledScenario<N, U, Vars>["run"]["eventLog"];
  policy?: CompiledScenario<N, U, Vars>["run"]["offline"];
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
      overflow: "none" | "clamped";
      decay: Readonly<{
        kind: "none" | "linear";
        ratio: number;
      }>;
    }>;
  }
>;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function resolveOfflineSeconds(
  requestedSec: number,
  policy: CompiledScenario<any, any, any>["run"]["offline"] | undefined,
): Readonly<{
  preDecaySec: number;
  effectiveSec: number;
  overflow: "none" | "clamped";
  decayKind: "none" | "linear";
  decayRatio: number;
}> {
  const maxSec = policy?.maxSec;
  const overflowPolicy = policy?.overflowPolicy ?? "clamp";

  let preDecaySec = requestedSec;
  let overflow: "none" | "clamped" = "none";

  if (maxSec !== undefined && requestedSec > maxSec) {
    if (overflowPolicy === "reject") {
      throw new Error(`offline seconds exceed policy maxSec (${maxSec})`);
    }
    preDecaySec = maxSec;
    overflow = "clamped";
  }

  const decayKind = policy?.decay?.kind ?? "none";
  const floorRatio = clamp01(policy?.decay?.floorRatio ?? 0.25);

  let decayRatio = 1;
  if (decayKind === "linear" && maxSec !== undefined && maxSec > 0) {
    const progress = clamp01(preDecaySec / maxSec);
    // 0 sec => ratio 1, maxSec => floorRatio
    decayRatio = floorRatio + (1 - floorRatio) * (1 - progress);
  }

  return {
    preDecaySec,
    effectiveSec: preDecaySec * decayRatio,
    overflow,
    decayKind,
    decayRatio,
  };
}

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

  const resolved = resolveOfflineSeconds(seconds, opts?.policy ?? scenario.run.offline);
  const fullSteps = Math.floor(resolved.effectiveSec / stepSec);
  const remainderRaw = resolved.effectiveSec - fullSteps * stepSec;
  const remainderEpsilon = Math.max(1e-12, seconds * 1e-12);
  const remainderSec = remainderRaw > remainderEpsilon ? remainderRaw : 0;

  const plannedSteps = fullSteps + (remainderSec > 0 ? 1 : 0);
  const maxSteps = opts?.maxSteps;
  if (maxSteps !== undefined && plannedSteps > maxSteps) {
    throw new Error(`offline run exceeded maxSteps (${maxSteps}); required=${plannedSteps}`);
  }

  const statsAcc = createSimStatsAccumulator();
  const events: SimEvent<N>[] = [];
  const eventTimeline: TimedSimEvent<N>[] = [];
  const actionsLog: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];

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

  const retainTimedEvents = (batch: readonly SimEvent<N>[], t: number): void => {
    if (!eventLogEnabled || batch.length === 0) return;

    const timedBatch = batch.map((event) => ({ t, event }));
    if (maxEvents === 0) return;

    if (maxEvents === undefined) {
      eventTimeline.push(...timedBatch);
      return;
    }

    if (timedBatch.length >= maxEvents) {
      eventTimeline.splice(0, eventTimeline.length, ...timedBatch.slice(timedBatch.length - maxEvents));
      return;
    }

    const overflow = Math.max(0, eventTimeline.length + timedBatch.length - maxEvents);
    if (overflow > 0) {
      eventTimeline.splice(0, overflow);
    }
    eventTimeline.push(...timedBatch);
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
    retainTimedEvents(out.events, state.t);
    if (out.actionsApplied?.length) {
      actionsLog.push(...out.actionsApplied);
    }
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
    retainTimedEvents(out.events, state.t);
    if (out.actionsApplied?.length) {
      actionsLog.push(...out.actionsApplied);
    }
  }

  const stats = statsAcc.snapshot();
  const uxFlags = analyzeUX(stats);

  return {
    start,
    end: state,
    events,
    eventTimeline: eventTimeline.length > 0 ? eventTimeline : undefined,
    actionsLog: actionsLog.length > 0 ? actionsLog : undefined,
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
      preDecaySec: resolved.preDecaySec,
      effectiveSec: resolved.effectiveSec,
      simulatedSec: fullSteps * stepSec + remainderSec,
      stepSec,
      fullSteps,
      remainderSec,
      usedStrategy: useStrategy,
      overflow: resolved.overflow,
      decay: {
        kind: resolved.decayKind,
        ratio: resolved.decayRatio,
      },
    },
  };
}
