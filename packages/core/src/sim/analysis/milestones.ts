import type { RunResult } from "../types";

export type MilestoneOccurrence = Readonly<{
  key: string;
  firstSeenT: number;
  firstSeenSec: number;
  source: "event" | "action" | "prestige";
}>;

export type MilestoneReport = Readonly<{
  milestones: MilestoneOccurrence[];
  firstMilestoneSec?: number;
  firstActionSec?: number;
  firstPrestigeSec?: number;
  /** `incomplete` means the times came from a truncated log with no compact samples. */
  coverage?: "complete" | "partial" | "incomplete";
}>;

function compareOccurrence(a: MilestoneOccurrence, b: MilestoneOccurrence): number {
  if (a.firstSeenT !== b.firstSeenT) return a.firstSeenT - b.firstSeenT;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
}

/** The fallback reads events, the action log, and (for the first prestige) the trace. A drop in any of them can hide or shift a milestone. */
function fallbackDropped<N, U extends string, Vars>(run: RunResult<N, U, Vars>, prestiged: boolean): boolean {
  if ((run.eventLog?.dropped ?? 0) > 0) return true;
  if ((run.actionsLogMeta?.dropped ?? 0) > 0) return true;
  return prestiged && (run.traceLog?.dropped ?? 0) > 0;
}

export function analyzeMilestones<N, U extends string, Vars>(args: {
  run: RunResult<N, U, Vars>;
}): MilestoneReport {
  const { run } = args;
  const byKey = new Map<string, MilestoneOccurrence>();
  const startT = run.start.t;
  const compact = run.observation;
  const useCompact = compact !== undefined && compact.coverage !== "disabled" && !compact.legacyEventFallback;

  const upsert = (entry: MilestoneOccurrence) => {
    const prev = byKey.get(entry.key);
    if (!prev || compareOccurrence(entry, prev) < 0) {
      byKey.set(entry.key, entry);
    }
  };

  if (useCompact && compact) {
    for (const sample of compact.milestones) {
      if (sample.source === "goal") continue;
      upsert({
        key: sample.key,
        firstSeenT: sample.firstSeenT,
        firstSeenSec: Math.max(0, sample.firstSeenT - startT),
        source: sample.source === "milestone" ? "event" : sample.source,
      });
    }
  }

  if (useCompact) {
    const milestones = [...byKey.values()].sort(compareOccurrence);
    const firstAction = milestones.find((x) => x.source === "action");
    const firstPrestige = milestones.find((x) => x.key === "prestige.first");
    return {
      milestones,
      firstMilestoneSec: compact?.firstMilestoneT === undefined ? milestones[0]?.firstSeenSec : Math.max(0, compact.firstMilestoneT - startT),
      firstActionSec: compact?.firstActionT === undefined ? firstAction?.firstSeenSec : Math.max(0, compact.firstActionT - startT),
      firstPrestigeSec: compact?.firstPrestigeT === undefined ? firstPrestige?.firstSeenSec : Math.max(0, compact.firstPrestigeT - startT),
      // Milestones and goals have separate caps. Only a dropped milestone makes this report partial.
      coverage: (compact?.droppedMilestones ?? 0) > 0 ? "partial" : "complete",
    };
  }

  for (const frame of run.eventTimeline ?? []) {
    if (frame.event.type !== "milestone") continue;
    upsert({
      key: frame.event.key,
      firstSeenT: frame.t,
      firstSeenSec: Math.max(0, frame.t - startT),
      source: "event",
    });
  }

  for (const action of run.actionsLog ?? []) {
    const firstSeenSec = Math.max(0, action.t - startT);
    upsert({
      key: `action.${action.actionId}.firstApplied`,
      firstSeenT: action.t,
      firstSeenSec,
      source: "action",
    });

    if (!byKey.has("progress.first-upgrade")) {
      upsert({
        key: "progress.first-upgrade",
        firstSeenT: action.t,
        firstSeenSec,
        source: "action",
      });
    }
  }

  // The compact recorder marks a committed prestige action. This fallback has no action kinds, so it reads count and points.
  const prestiged =
    run.end.prestige.count > run.start.prestige.count ||
    String(run.end.prestige.points as any) !== String(run.start.prestige.points as any);
  if (prestiged) {
    let prestigeT = run.end.t;
    for (const state of run.trace ?? []) {
      if (
        state.prestige.count > run.start.prestige.count ||
        String(state.prestige.points as any) !== String(run.start.prestige.points as any)
      ) {
        prestigeT = state.t;
        break;
      }
    }

    upsert({
      key: "prestige.first",
      firstSeenT: prestigeT,
      firstSeenSec: Math.max(0, prestigeT - startT),
      source: "prestige",
    });
  }

  const milestones = [...byKey.values()].sort(compareOccurrence);
  const firstAction = milestones.find((x) => x.source === "action");
  const firstPrestige = milestones.find((x) => x.key === "prestige.first");

  return {
    milestones,
    firstMilestoneSec: milestones[0]?.firstSeenSec,
    firstActionSec: firstAction?.firstSeenSec,
    firstPrestigeSec: firstPrestige?.firstSeenSec,
    coverage: fallbackDropped(run, prestiged) ? "incomplete" : "complete",
  };
}
