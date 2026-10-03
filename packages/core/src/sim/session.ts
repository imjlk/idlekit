import type { OfflineActionPolicy } from "../scenario/offlinePolicy";
import { deepClonePreservingPrototype } from "../utils/deepClone";
import { analyzeUX } from "./analysis/ux";
import { constraintsWithAnchor } from "./constraints";
import { createBoundedLog, createEventBuffer } from "./eventBuffer";
import { mergeObservations, observationFromLegacyEvents, statsFromObservation, type RunObservation } from "./observation";
import { applyOfflineSeconds, type OfflineRunResult } from "./offline";
import { offlineAbsenceForCredit, resolveOfflineSeconds } from "./offlineCredit";
import { runScenario } from "./simulator";
import type { CompiledScenario, RunResult, SimState } from "./types";

/**
 * Session schedule contract. TC-05 has not registered this DTO.
 * `state.t` stays the reward clock. Wall time is only on the session report.
 *
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Wall elapsed, reward time, and active time are separate fields. Cap and decay do not move the next block earlier.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #3c24d94 Re-read the section: a completed 12-hour absence with a 1-hour cap stays elapsed 43200 and credited 3600, a gap cut by a stop reports only the absence that earned its stepped reward, and state.t is not rewritten to wall time.
 */
export const sessionClockContract = "idlekit.session-clock" as const;

export type SessionPatternId =
  | "always-on"
  | "short-bursts"
  | "twice-daily"
  | "offline-heavy"
  | "weekend-marathon";

export type SessionOffsetBlock = Readonly<{
  day: number;
  startOffsetSec: number;
  durationSec: number;
}>;

export type SessionPatternSpec = Readonly<{
  id: SessionPatternId;
  days: number;
  /** Opt-in offsets in seconds. Absent means the preset named by `id`. */
  schedule?: readonly SessionOffsetBlock[];
}>;

export type SessionStopReason = "horizon" | "until" | "goal";

export type SessionClock = Readonly<{
  /**
   * Wall length of this segment. A gap cut by a stop ends where its stepped reward was earned.
   * An active block cut by maxSteps keeps its planned length; credited and active stay short.
   */
  elapsedSec: number;
  /** Reward seconds actually stepped. */
  creditedSec: number;
  activeSec: number;
  /** Reward seconds removed by offline cap or decay. Not a step-budget shortfall. */
  lostRewardSec: number;
}>;

export type SessionSegment<N, U extends string, Vars> =
  | Readonly<{
      kind: "active";
      day: number;
      startT: number;
      endT: number;
      durationSec: number;
      wallStartT: number;
      wallEndT: number;
      clock: SessionClock;
      run: RunResult<N, U, Vars>;
    }>
  | Readonly<{
      kind: "offline";
      day: number;
      startT: number;
      endT: number;
      durationSec: number;
      wallStartT: number;
      wallEndT: number;
      clock: SessionClock;
      run: OfflineRunResult<N, U, Vars>;
    }>;

export type SessionRunResult<N, U extends string, Vars> = Readonly<{
  pattern: SessionPatternSpec;
  start: SimState<N, U, Vars>;
  end: SimState<N, U, Vars>;
  run: RunResult<N, U, Vars>;
  segments: readonly SessionSegment<N, U, Vars>[];
  summary: Readonly<{
    days: number;
    activeBlocks: number;
    /** Active reward seconds. Equal to `activeSec`. */
    totalActiveSec: number;
    /**
     * Stepped offline reward seconds.
     * This is not the wall absence when cap or decay applies.
     */
    totalOfflineSec: number;
    elapsedSec: number;
    horizonSec: number;
    activeSec: number;
    offlineElapsedSec: number;
    offlineCreditedSec: number;
    lostRewardSec: number;
    /** `end.t - start.t`. Reward time, not wall time. */
    rewardSec: number;
    offlineActions: OfflineActionPolicy["mode"];
    /**
     * Active blocks cut short by `run.maxSteps`. That budget is per block.
     * The session continues with the next scheduled block. Offline gaps do not take it.
     * Wall time still reaches the block's planned end; the unsimulated rest is not
     * offline time and does not advance the reward clock.
     */
    budgetStops: number;
    stop: Readonly<{ reason: SessionStopReason }>;
  }>;
}>;

type ActiveBlock = SessionOffsetBlock;

function buildBlocks(pattern: SessionPatternSpec): ActiveBlock[] {
  const blocks: ActiveBlock[] = [];
  for (let day = 0; day < pattern.days; day += 1) {
    switch (pattern.id) {
      case "always-on": {
        blocks.push({ day, startOffsetSec: 0, durationSec: 86400 });
        break;
      }
      case "short-bursts": {
        const gap = (16 * 3600) / 10;
        for (let i = 0; i < 10; i += 1) {
          blocks.push({ day, startOffsetSec: Math.round(i * gap), durationSec: 60 });
        }
        break;
      }
      case "twice-daily": {
        blocks.push({ day, startOffsetSec: 0, durationSec: 1800 });
        blocks.push({ day, startOffsetSec: 12 * 3600, durationSec: 1800 });
        break;
      }
      case "offline-heavy": {
        blocks.push({ day, startOffsetSec: 0, durationSec: 300 });
        break;
      }
      case "weekend-marathon": {
        const weekday = day % 7;
        if (weekday >= 5) {
          blocks.push({ day, startOffsetSec: 0, durationSec: 7200 });
          blocks.push({ day, startOffsetSec: 12 * 3600, durationSec: 7200 });
        } else {
          blocks.push({ day, startOffsetSec: 0, durationSec: 300 });
        }
        break;
      }
    }
  }
  return blocks.sort((a, b) => a.day * 86400 + a.startOffsetSec - (b.day * 86400 + b.startOffsetSec));
}

/** Throws when an opt-in offset list is empty, negative, overlapping, or outside the horizon. */
export function assertSessionSchedule(pattern: SessionPatternSpec): SessionOffsetBlock[] {
  if (!Number.isInteger(pattern.days) || pattern.days <= 0) {
    throw new Error("session days must be a positive integer");
  }
  const schedule = pattern.schedule;
  if (!schedule || schedule.length === 0) {
    throw new Error("session schedule is empty");
  }
  const horizon = pattern.days * 86400;
  const blocks = schedule.map((block) => {
    if (!Number.isInteger(block.day) || block.day < 0) {
      throw new Error("session schedule day must be an integer >= 0");
    }
    if (!Number.isFinite(block.startOffsetSec) || block.startOffsetSec < 0) {
      throw new Error("session schedule offset must be finite and >= 0");
    }
    if (!Number.isFinite(block.durationSec) || !(block.durationSec > 0)) {
      throw new Error("session schedule duration must be finite and > 0");
    }
    const start = block.day * 86400 + block.startOffsetSec;
    const end = start + block.durationSec;
    if (end > horizon) throw new Error("session schedule block ends after the horizon");
    return { day: block.day, startOffsetSec: block.startOffsetSec, durationSec: block.durationSec };
  });
  const ordered = [...blocks].sort(
    (a, b) => a.day * 86400 + a.startOffsetSec - (b.day * 86400 + b.startOffsetSec),
  );
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1]!;
    const next = ordered[i]!;
    const prevEnd = prev.day * 86400 + prev.startOffsetSec + prev.durationSec;
    const nextStart = next.day * 86400 + next.startOffsetSec;
    if (nextStart < prevEnd) throw new Error("session schedule blocks overlap");
  }
  return ordered;
}

function blocksFor(pattern: SessionPatternSpec): ActiveBlock[] {
  if (pattern.schedule) return assertSessionSchedule(pattern);
  return buildBlocks(pattern);
}

function modelReadsClocks<N, U extends string, Vars>(scenario: CompiledScenario<N, U, Vars>): boolean {
  return (scenario.model.clocks?.respondsTo?.length ?? 0) > 0;
}

function withClocks<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  wallT: number,
  wallEndT: number,
  rewardT: number,
  activeT: number,
): CompiledScenario<N, U, Vars> {
  if (!modelReadsClocks(scenario)) return scenario;
  return {
    ...scenario,
    ctx: {
      ...scenario.ctx,
      clocks: { wallT, wallEndT, rewardT, activeT },
    },
  };
}

/**
 * One continued play. Wall time follows the schedule. `state.t` stays reward time.
 * A later call is fresh only when the caller supplies a new strategy instance.
 * An `until` or goal stop inside an offline gap ends that gap at the smallest wall absence
 * whose cap- and decay-adjusted reward reaches the stepped reward, not at the scheduled gap end.
 *
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Schedules the next block on wall time and reports elapsed, credited, and active time separately.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #3c24d94 Re-read the section: cap and decay do not pull the next active block forward, policy none does not call decide, goals stop only once every goal is reached, a stop inside an offline gap ends that gap at the smallest absence whose cap- and decay-adjusted reward reaches the stepped reward, and maxSteps is a per-block budget counted in budgetStops, after which wall time still reaches the planned block end without crediting the rest as offline time.
 */
export function simulateSessionPattern<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  pattern: SessionPatternSpec;
  seed?: number;
}): SessionRunResult<N, U, Vars> {
  const sc = args.seed === undefined ? args.scenario : { ...args.scenario, ctx: { ...args.scenario.ctx, seed: args.seed } };
  const start = sc.initial;
  const horizonSec = args.pattern.days * 86400;
  const startT = start.t;
  const segments: SessionSegment<N, U, Vars>[] = [];
  // The caller's trace budgets bound the whole session, not each block.
  const traceBudget = sc.run.trace?.maxPoints;
  const actionBudget = sc.run.trace?.maxActions;
  const trace = createBoundedLog<SimState<N, U, Vars>>(traceBudget, "session trace.maxPoints");
  const actionsLog = createBoundedLog<{ t: number; actionId: string; label?: string; bulkSize?: number }>(actionBudget, "session trace.maxActions");
  let lastTraceT: number | undefined;
  let segmentTraceDropped = 0;
  let segmentActionsDropped = 0;
  const eventBuffer = createEventBuffer<N>({
    enabled: sc.run.eventLog?.enabled ?? true,
    maxEvents: sc.run.eventLog?.maxEvents,
  });
  const segmentObservations: RunObservation[] = [];
  let state = start;
  let lastResetT: number | undefined;
  let wallT = startT;
  let activeSec = 0;
  let offlineElapsedSec = 0;
  let offlineCreditedSec = 0;
  let lostRewardSec = 0;
  let activeBlocks = 0;
  let budgetStops = 0;
  let stopReason: SessionStopReason = "horizon";
  const actionPolicy = sc.run.offline?.actions ?? { mode: "legacy-all" as const };
  const originalUntil = sc.run.until;
  const goals = sc.run.goals ?? [];
  // A goal stays reached once met. Goals stop the session only when every goal is reached.
  const reachedGoals = new Set<number>();
  const allGoalsReached = () => goals.length > 0 && reachedGoals.size === goals.length;
  const stopFn =
    originalUntil !== undefined || goals.length > 0
      ? (next: SimState<N, U, Vars>) => {
          // Goals read a copy, as the observation recorder does. Clone only while one is open.
          if (reachedGoals.size < goals.length) {
            const seen = deepClonePreservingPrototype(next);
            goals.forEach((goal, i) => {
              if (!reachedGoals.has(i) && goal.met(seen)) reachedGoals.add(i);
            });
          }
          return (originalUntil?.(next) ?? false) || allGoalsReached();
        }
      : undefined;

  const onPrestigeReset = (t: number) => {
    lastResetT = t;
    sc.run.onPrestigeReset?.(t);
  };
  // Each segment starts from the last committed reset of an earlier segment.
  const segmentScenario = (wallStart: number, wallEnd: number): CompiledScenario<N, U, Vars> => {
    const base = withClocks(sc, wallStart, wallEnd, state.t, activeSec);
    return {
      ...base,
      ...(lastResetT !== undefined ? { constraints: constraintsWithAnchor(base.constraints, lastResetT) } : {}),
      run: { ...base.run, onPrestigeReset },
    };
  };

  const retainRun = (run: RunResult<N, U, Vars>) => {
    segmentObservations.push(
      run.observation ??
        observationFromLegacyEvents({
          startT: run.start.t,
          endT: run.end.t,
          events: run.events,
        }),
    );
    eventBuffer.pushRun(run);
  };

  const classify = (run: RunResult<N, U, Vars>): SessionStopReason | undefined => {
    if (originalUntil?.(run.end)) return "until";
    if (allGoalsReached()) return "goal";
    return undefined;
  };

  const appendOffline = (wallEnd: number, day: number) => {
    if (stopReason !== "horizon" || !(wallT < wallEnd)) return;
    const requested = wallEnd - wallT;
    const wallStart = wallT;
    const offlineRun = applyOfflineSeconds({
      scenario: segmentScenario(wallStart, wallEnd),
      seconds: requested,
      options: {
        fromState: state,
        actions: actionPolicy,
        fast: sc.run.fast,
        eventLog: {
          enabled: sc.run.eventLog?.enabled ?? true,
          maxEvents: sc.run.eventLog?.maxEvents,
        },
        policy: sc.run.offline,
        ...(stopFn ? { until: stopFn } : {}),
      },
    });
    const credited = offlineRun.offline.simulatedSec;
    // A stop inside the gap ends it at the smallest absence that earns the stepped reward.
    // A gap that steps all of its effective seconds keeps the scheduled wall end.
    const absence =
      offlineRun.stop?.reason === "until"
        ? offlineAbsenceForCredit(credited, requested, sc.run.offline)
        : requested;
    const gapEnd = wallStart + absence;
    const effective =
      absence === requested ? offlineRun.offline.effectiveSec : resolveOfflineSeconds(absence, sc.run.offline).effectiveSec;
    const lost = Math.max(0, absence - effective);
    offlineElapsedSec += absence;
    offlineCreditedSec += credited;
    lostRewardSec += lost;
    retainRun(offlineRun);
    segments.push({
      kind: "offline",
      day,
      startT: state.t,
      endT: offlineRun.end.t,
      durationSec: credited,
      wallStartT: wallStart,
      wallEndT: gapEnd,
      clock: {
        elapsedSec: absence,
        creditedSec: credited,
        activeSec: 0,
        lostRewardSec: lost,
      },
      run: offlineRun,
    });
    state = offlineRun.end;
    wallT = gapEnd;
    const reason = classify(offlineRun);
    if (reason) stopReason = reason;
  };

  const blocks = blocksFor(args.pattern);
  for (const block of blocks) {
    if (stopReason !== "horizon") break;
    const scheduledStart = startT + block.day * 86400 + block.startOffsetSec;
    appendOffline(scheduledStart, block.day);
    if (stopReason !== "horizon") break;

    const wallStart = wallT;
    const plannedEnd = wallStart + block.durationSec;
    const segment = segmentScenario(wallStart, plannedEnd);
    const activeRun = runScenario({
      ...segment,
      initial: state,
      run: {
        ...segment.run,
        durationSec: block.durationSec,
        trace: { ...sc.run.trace, everySteps: 1, keepActionsLog: true },
        eventLog: {
          enabled: sc.run.eventLog?.enabled ?? true,
          maxEvents: sc.run.eventLog?.maxEvents,
        },
        ...(stopFn ? { until: stopFn } : {}),
      },
    });
    const simulated = activeRun.end.t - activeRun.start.t;
    activeSec += simulated;
    activeBlocks += 1;
    if (activeRun.stop?.reason === "budget") budgetStops += 1;
    retainRun(activeRun);
    const points = activeRun.trace ?? [];
    for (let i = points.length > 0 && points[0]!.t === lastTraceT ? 1 : 0; i < points.length; i += 1) {
      trace.push(points[i]!);
    }
    if (points.length > 0) lastTraceT = points[points.length - 1]!.t;
    segmentTraceDropped += activeRun.traceLog?.dropped ?? 0;
    for (const row of activeRun.actionsLog ?? []) actionsLog.push(row);
    segmentActionsDropped += activeRun.actionsLogMeta?.dropped ?? 0;
    // A block cut by maxSteps still ends at its planned wall time. The player was
    // present for the rest, so it is neither offline absence nor credited reward.
    const wallEnd = activeRun.stop?.reason === "budget" ? plannedEnd : wallStart + simulated;
    segments.push({
      kind: "active",
      day: block.day,
      startT: activeRun.start.t,
      endT: activeRun.end.t,
      durationSec: simulated,
      wallStartT: wallStart,
      wallEndT: wallEnd,
      clock: {
        elapsedSec: wallEnd - wallStart,
        creditedSec: simulated,
        activeSec: simulated,
        lostRewardSec: 0,
      },
      run: activeRun,
    });
    state = activeRun.end;
    wallT = wallEnd;
    const reason = classify(activeRun);
    if (reason) stopReason = reason;
  }

  if (stopReason === "horizon") {
    appendOffline(startT + horizonSec, Math.floor((wallT - startT) / 86400));
  }

  const observation = mergeObservations(segmentObservations);
  const stats = statsFromObservation(observation);
  const retained = eventBuffer.snapshot();
  const traced = trace.snapshot();
  const logged = actionsLog.snapshot();
  const run: RunResult<N, U, Vars> = {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    trace: traced.items,
    actionsLog: logged.items,
    stats,
    uxFlags: analyzeUX(stats),
    observation,
    ...(traceBudget !== undefined
      ? {
          traceLog: {
            maxPoints: traceBudget,
            totalSeen: traced.totalSeen + segmentTraceDropped,
            dropped: traced.dropped + segmentTraceDropped,
            retained: traced.retained,
          },
        }
      : {}),
    ...(actionBudget !== undefined
      ? {
          actionsLogMeta: {
            maxActions: actionBudget,
            totalSeen: logged.totalSeen + segmentActionsDropped,
            dropped: logged.dropped + segmentActionsDropped,
            retained: logged.retained,
          },
        }
      : {}),
    eventLog: retained.eventLog,
  };

  return {
    pattern: args.pattern,
    start,
    end: state,
    run,
    segments,
    summary: {
      days: args.pattern.days,
      activeBlocks,
      totalActiveSec: activeSec,
      totalOfflineSec: offlineCreditedSec,
      elapsedSec: wallT - startT,
      horizonSec,
      activeSec,
      offlineElapsedSec,
      offlineCreditedSec,
      lostRewardSec,
      rewardSec: state.t - startT,
      offlineActions: actionPolicy.mode,
      budgetStops,
      stop: { reason: stopReason },
    },
  };
}
