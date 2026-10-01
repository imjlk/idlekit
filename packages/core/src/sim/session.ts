import type { OfflineActionPolicy } from "../scenario/offlinePolicy";
import { analyzeUX } from "./analysis/ux";
import { createEventBuffer } from "./eventBuffer";
import { mergeObservations, observationFromLegacyEvents, statsFromObservation, type RunObservation } from "./observation";
import { applyOfflineSeconds, type OfflineRunResult } from "./offline";
import { runScenario } from "./simulator";
import type { CompiledScenario, RunResult, SimState } from "./types";

/**
 * Session schedule contract. TC-05 has not registered this DTO.
 * `state.t` stays the reward clock. Wall time is only on the session report.
 *
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Wall elapsed, reward time, and active time are separate fields. Cap and decay do not move the next block earlier.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #79e7d8e Re-read the section: a 12-hour absence with a 1-hour cap stays elapsed 43200 and credited 3600, and state.t is not rewritten to wall time.
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

export type SessionStopReason = "horizon" | "until" | "goal" | "budget";

export type SessionClock = Readonly<{
  /** Wall length of this segment. */
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
 *
 * @evidence docs/requirements/active/session-clock.md#req-pr06-session-clock Schedules the next block on wall time and reports elapsed, credited, and active time separately.
 * @evidenceReview docs/requirements/active/session-clock.md#req-pr06-session-clock #79e7d8e Re-read the section: cap and decay do not pull the next active block forward, and policy none does not call decide.
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
  const trace: SimState<N, U, Vars>[] = [];
  const actionsLog: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];
  const eventBuffer = createEventBuffer<N>({
    enabled: sc.run.eventLog?.enabled ?? true,
    maxEvents: sc.run.eventLog?.maxEvents,
  });
  const segmentObservations: RunObservation[] = [];
  let state = start;
  let wallT = startT;
  let activeSec = 0;
  let offlineElapsedSec = 0;
  let offlineCreditedSec = 0;
  let lostRewardSec = 0;
  let activeBlocks = 0;
  let stopReason: SessionStopReason = "horizon";
  const actionPolicy = sc.run.offline?.actions ?? { mode: "legacy-all" as const };
  const originalUntil = sc.run.until;
  const goals = sc.run.goals ?? [];
  const stopFn =
    originalUntil !== undefined || goals.length > 0
      ? (next: SimState<N, U, Vars>) => (originalUntil?.(next) ?? false) || goals.some((goal) => goal.met(next))
      : undefined;

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
    const goalMet = run.observation?.goals.some((goal) => goal.status === "reached") ?? false;
    if (run.stop?.reason === "budget") return "budget";
    if (originalUntil?.(run.end)) return "until";
    if (run.stop?.reason === "until") return "goal";
    if (goalMet) return "goal";
    return undefined;
  };

  const appendOffline = (wallEnd: number, day: number) => {
    if (stopReason !== "horizon" || !(wallT < wallEnd)) return;
    const requested = wallEnd - wallT;
    const wallStart = wallT;
    const offlineRun = applyOfflineSeconds({
      scenario: withClocks(sc, wallStart, wallEnd, state.t, activeSec),
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
        ...(sc.run.maxSteps !== undefined ? { maxSteps: sc.run.maxSteps } : {}),
        ...(stopFn ? { until: stopFn } : {}),
      },
    });
    const credited = offlineRun.offline.simulatedSec;
    const lost = Math.max(0, requested - offlineRun.offline.effectiveSec);
    offlineElapsedSec += requested;
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
      wallEndT: wallEnd,
      clock: {
        elapsedSec: requested,
        creditedSec: credited,
        activeSec: 0,
        lostRewardSec: lost,
      },
      run: offlineRun,
    });
    state = offlineRun.end;
    wallT = wallEnd;
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
    const activeRun = runScenario({
      ...withClocks(sc, wallStart, plannedEnd, state.t, activeSec),
      initial: state,
      run: {
        ...sc.run,
        durationSec: block.durationSec,
        trace: { everySteps: 1, keepActionsLog: true },
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
    retainRun(activeRun);
    if (activeRun.trace?.length) {
      if (trace.length > 0 && activeRun.trace[0]?.t === trace[trace.length - 1]?.t) {
        trace.push(...activeRun.trace.slice(1));
      } else {
        trace.push(...activeRun.trace);
      }
    }
    if (activeRun.actionsLog?.length) actionsLog.push(...activeRun.actionsLog);
    segments.push({
      kind: "active",
      day: block.day,
      startT: activeRun.start.t,
      endT: activeRun.end.t,
      durationSec: simulated,
      wallStartT: wallStart,
      wallEndT: wallStart + simulated,
      clock: {
        elapsedSec: simulated,
        creditedSec: simulated,
        activeSec: simulated,
        lostRewardSec: 0,
      },
      run: activeRun,
    });
    state = activeRun.end;
    wallT = wallStart + simulated;
    const reason = classify(activeRun);
    if (reason) stopReason = reason;
  }

  if (stopReason === "horizon") {
    appendOffline(startT + horizonSec, Math.floor((wallT - startT) / 86400));
  }

  const observation = mergeObservations(segmentObservations);
  const stats = statsFromObservation(observation);
  const retained = eventBuffer.snapshot();
  const run: RunResult<N, U, Vars> = {
    start,
    end: state,
    events: retained.events,
    eventTimeline: retained.eventTimeline,
    trace,
    actionsLog,
    stats,
    uxFlags: analyzeUX(stats),
    observation,
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
      stop: { reason: stopReason },
    },
  };
}
