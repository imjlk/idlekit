import type { MoneyEvent } from "../../policy/types";
import type { SimEvent } from "../types";

export type SimStats = Readonly<{
  money: Readonly<{
    applied: number;
    dropped: number;
    queued: number;
    flushed: number;
    blocked: number;
    droppedRate: number;
    flushRate: number;
  }>;
  actions: Readonly<{
    applied: number;
    skippedCannotApply: number;
    skippedInsufficientFunds: number;
  }>;
}>;

export type UXFlag = Readonly<{
  code: "STALLING_FEELING" | "TOO_RARE_FLUSH" | "TOO_MANY_DROPS";
  severity: "info" | "warn" | "critical";
  detail?: unknown;
}>;

type SimStatsMutable = {
  applied: number;
  dropped: number;
  queued: number;
  flushed: number;
  blocked: number;
  actionApplied: number;
  skippedCannotApply: number;
  skippedInsufficientFunds: number;
};

function applySimEvent<N>(m: SimStatsMutable, e: SimEvent<N>): void {
  if (e.type === "money") {
    for (const me of e.events as readonly MoneyEvent<N>[]) {
      switch (me.type) {
        case "applied":
          m.applied += 1;
          break;
        case "dropped":
          m.dropped += 1;
          break;
        case "queued":
          m.queued += 1;
          break;
        case "flushed":
          m.flushed += 1;
          break;
        case "blocked":
          m.blocked += 1;
          break;
        default:
          break;
      }
    }
  }

  if (e.type === "action.applied") m.actionApplied += 1;
  if (e.type === "action.skipped") {
    if (e.reason === "cannotApply") m.skippedCannotApply += 1;
    if (e.reason === "insufficientFunds") m.skippedInsufficientFunds += 1;
  }
}

function toSimStats(m: SimStatsMutable): SimStats {
  const totalMoney = m.applied + m.dropped + m.queued;
  const droppedRate = totalMoney > 0 ? m.dropped / totalMoney : 0;
  const flushRate = m.queued > 0 ? m.flushed / m.queued : 0;

  return {
    money: {
      applied: m.applied,
      dropped: m.dropped,
      queued: m.queued,
      flushed: m.flushed,
      blocked: m.blocked,
      droppedRate,
      flushRate,
    },
    actions: {
      applied: m.actionApplied,
      skippedCannotApply: m.skippedCannotApply,
      skippedInsufficientFunds: m.skippedInsufficientFunds,
    },
  };
}

export type SimStatsAccumulator = Readonly<{
  push: <N>(events: readonly SimEvent<N>[]) => void;
  snapshot: () => SimStats;
}>;

export function createSimStatsAccumulator(): SimStatsAccumulator {
  const mutable: SimStatsMutable = {
    applied: 0,
    dropped: 0,
    queued: 0,
    flushed: 0,
    blocked: 0,
    actionApplied: 0,
    skippedCannotApply: 0,
    skippedInsufficientFunds: 0,
  };

  return {
    push<N>(events: readonly SimEvent<N>[]) {
      for (const e of events) applySimEvent(mutable, e);
    },
    snapshot() {
      return toSimStats(mutable);
    },
  };
}

export function buildSimStats<N>(events: readonly SimEvent<N>[]): SimStats {
  const acc = createSimStatsAccumulator();
  acc.push(events);
  return acc.snapshot();
}

export function analyzeUX(stats: SimStats): UXFlag[] {
  const flags: UXFlag[] = [];

  if (stats.money.droppedRate > 0.5) {
    flags.push({
      code: "TOO_MANY_DROPS",
      severity: stats.money.droppedRate > 0.8 ? "critical" : "warn",
      detail: { droppedRate: stats.money.droppedRate },
    });
  }

  if (stats.money.queued > 0 && stats.money.flushRate < 0.1) {
    flags.push({
      code: "TOO_RARE_FLUSH",
      severity: stats.money.flushRate < 0.03 ? "critical" : "warn",
      detail: { flushRate: stats.money.flushRate },
    });
  }

  if (stats.actions.applied === 0 && stats.actions.skippedInsufficientFunds > 10) {
    flags.push({
      code: "STALLING_FEELING",
      severity: "warn",
      detail: { skippedInsufficientFunds: stats.actions.skippedInsufficientFunds },
    });
  }

  return flags;
}
