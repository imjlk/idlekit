import { analyzeUX, createSimStatsAccumulator } from "./analysis/ux";
import { createEventBuffer } from "./eventBuffer";
import { applyOfflineSeconds, type OfflineRunResult } from "./offline";
import { runScenario } from "./simulator";
import type { CompiledScenario, RunResult, SimState } from "./types";

export type SessionPatternId =
  | "always-on"
  | "short-bursts"
  | "twice-daily"
  | "offline-heavy"
  | "weekend-marathon";

export type SessionPatternSpec = Readonly<{
  id: SessionPatternId;
  days: number;
}>;

export type SessionSegment<N, U extends string, Vars> =
  | Readonly<{
      kind: "active";
      day: number;
      startT: number;
      endT: number;
      durationSec: number;
      run: RunResult<N, U, Vars>;
    }>
  | Readonly<{
      kind: "offline";
      day: number;
      startT: number;
      endT: number;
      durationSec: number;
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
    totalActiveSec: number;
    totalOfflineSec: number;
  }>;
}>;

type ActiveBlock = Readonly<{
  day: number;
  startOffsetSec: number;
  durationSec: number;
}>;

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
  const statsAcc = createSimStatsAccumulator();
  const eventBuffer = createEventBuffer<N>({
    enabled: sc.run.eventLog?.enabled ?? true,
    maxEvents: sc.run.eventLog?.maxEvents,
  });
  let state = start;
  let totalActiveSec = 0;
  let totalOfflineSec = 0;
  let activeBlocks = 0;

  const retainRun = (run: RunResult<N, U, Vars>) => {
    statsAcc.push(run.events);
    eventBuffer.pushRun(run);
  };

  const blocks = buildBlocks(args.pattern);
  for (const block of blocks) {
    const absoluteStart = startT + block.day * 86400 + block.startOffsetSec;
    if (state.t < absoluteStart) {
      const offlineRun = applyOfflineSeconds({
        scenario: sc,
        seconds: absoluteStart - state.t,
        options: {
          fromState: state,
          useStrategy: true,
          fast: sc.run.fast,
          eventLog: {
            enabled: sc.run.eventLog?.enabled ?? true,
            maxEvents: sc.run.eventLog?.maxEvents,
          },
          policy: sc.run.offline,
        },
      });
      totalOfflineSec += offlineRun.offline.simulatedSec;
      retainRun(offlineRun);
      segments.push({
        kind: "offline",
        day: block.day,
        startT: state.t,
        endT: offlineRun.end.t,
        durationSec: offlineRun.offline.simulatedSec,
        run: offlineRun,
      });
      state = offlineRun.end;
    }

    const activeRun = runScenario({
      ...sc,
      initial: state,
      run: {
        ...sc.run,
        durationSec: block.durationSec,
        trace: { everySteps: 1, keepActionsLog: true },
        eventLog: {
          enabled: sc.run.eventLog?.enabled ?? true,
          maxEvents: sc.run.eventLog?.maxEvents,
        },
      },
    });

    totalActiveSec += activeRun.end.t - activeRun.start.t;
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
      durationSec: activeRun.end.t - activeRun.start.t,
      run: activeRun,
    });
    state = activeRun.end;
  }

  const horizonEnd = startT + horizonSec;
  if (state.t < horizonEnd) {
    const offlineRun = applyOfflineSeconds({
      scenario: sc,
      seconds: horizonEnd - state.t,
      options: {
        fromState: state,
        useStrategy: true,
        fast: sc.run.fast,
        eventLog: {
          enabled: sc.run.eventLog?.enabled ?? true,
          maxEvents: sc.run.eventLog?.maxEvents,
        },
        policy: sc.run.offline,
      },
    });
    totalOfflineSec += offlineRun.offline.simulatedSec;
    retainRun(offlineRun);
    segments.push({
      kind: "offline",
      day: Math.floor((state.t - startT) / 86400),
      startT: state.t,
      endT: offlineRun.end.t,
      durationSec: offlineRun.offline.simulatedSec,
      run: offlineRun,
    });
    state = offlineRun.end;
  }

  const stats = statsAcc.snapshot();
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
      totalActiveSec,
      totalOfflineSec,
    },
  };
}
