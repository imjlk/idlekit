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
}>;

function compareOccurrence(a: MilestoneOccurrence, b: MilestoneOccurrence): number {
  if (a.firstSeenT !== b.firstSeenT) return a.firstSeenT - b.firstSeenT;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
}

export function analyzeMilestones<N, U extends string, Vars>(args: {
  run: RunResult<N, U, Vars>;
}): MilestoneReport {
  const { run } = args;
  const byKey = new Map<string, MilestoneOccurrence>();
  const startT = run.start.t;

  const upsert = (entry: MilestoneOccurrence) => {
    const prev = byKey.get(entry.key);
    if (!prev || compareOccurrence(entry, prev) < 0) {
      byKey.set(entry.key, entry);
    }
  };

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

  if (
    run.end.prestige.count > run.start.prestige.count ||
    String(run.end.prestige.points as any) !== String(run.start.prestige.points as any)
  ) {
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
  };
}
