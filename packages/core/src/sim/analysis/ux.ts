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

export function buildSimStats<N>(events: readonly SimEvent<N>[]): SimStats {
  let applied = 0;
  let dropped = 0;
  let queued = 0;
  let flushed = 0;
  let blocked = 0;

  let actionApplied = 0;
  let skippedCannotApply = 0;
  let skippedInsufficientFunds = 0;

  for (const e of events) {
    if (e.type === "money") {
      for (const me of e.events as readonly MoneyEvent<N>[]) {
        switch (me.type) {
          case "applied":
            applied += 1;
            break;
          case "dropped":
            dropped += 1;
            break;
          case "queued":
            queued += 1;
            break;
          case "flushed":
            flushed += 1;
            break;
          case "blocked":
            blocked += 1;
            break;
          default:
            break;
        }
      }
    }

    if (e.type === "action.applied") actionApplied += 1;
    if (e.type === "action.skipped") {
      if (e.reason === "cannotApply") skippedCannotApply += 1;
      if (e.reason === "insufficientFunds") skippedInsufficientFunds += 1;
    }
  }

  const totalMoney = applied + dropped + queued;
  const droppedRate = totalMoney > 0 ? dropped / totalMoney : 0;
  const flushRate = queued > 0 ? flushed / queued : 0;

  return {
    money: {
      applied,
      dropped,
      queued,
      flushed,
      blocked,
      droppedRate,
      flushRate,
    },
    actions: {
      applied: actionApplied,
      skippedCannotApply,
      skippedInsufficientFunds,
    },
  };
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
