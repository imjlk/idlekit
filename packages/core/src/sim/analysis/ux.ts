import type { MoneyEvent } from "../../policy/types";
import type { SimEvent } from "../types";

/**
 * `missing` means the counters were not collected.
 * A missing rate is null. It is not a measured zero.
 */
export type MetricStatus = "observed" | "missing";

export type SimStats = Readonly<{
  money: Readonly<{
    status: MetricStatus;
    applied: number;
    dropped: number;
    queued: number;
    flushed: number;
    blocked: number;
    droppedRate: number | null;
    flushRate: number | null;
  }>;
  actions: Readonly<{
    status: MetricStatus;
    applied: number;
    skippedCannotApply: number;
    skippedInsufficientFunds: number;
    /** Absent on a stats object built before this counter existed. New results still set it. */
    skippedInvalidQuote?: number;
  }>;
  coverage: "complete" | "partial" | "incomplete" | "disabled";
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
  skippedInvalidQuote: number;
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
    if (e.reason === "invalidQuote") m.skippedInvalidQuote += 1;
  }
}

export function simStatsFromCounters(args: {
  money: Readonly<{
    status: MetricStatus;
    applied: number;
    dropped: number;
    queued: number;
    flushed: number;
    blocked: number;
  }>;
  actions: Readonly<{
    status: MetricStatus;
    applied: number;
    skippedCannotApply: number;
    skippedInsufficientFunds: number;
    skippedInvalidQuote: number;
  }>;
  coverage: SimStats["coverage"];
}): SimStats {
  const moneyMissing = args.money.status !== "observed";
  const totalMoney = args.money.applied + args.money.dropped + args.money.queued;
  return {
    money: {
      status: args.money.status,
      applied: moneyMissing ? 0 : args.money.applied,
      dropped: moneyMissing ? 0 : args.money.dropped,
      queued: moneyMissing ? 0 : args.money.queued,
      flushed: moneyMissing ? 0 : args.money.flushed,
      blocked: moneyMissing ? 0 : args.money.blocked,
      droppedRate: moneyMissing ? null : totalMoney > 0 ? args.money.dropped / totalMoney : 0,
      flushRate: moneyMissing ? null : args.money.queued > 0 ? args.money.flushed / args.money.queued : 0,
    },
    actions: {
      status: args.actions.status,
      applied: args.actions.status === "observed" ? args.actions.applied : 0,
      skippedCannotApply: args.actions.status === "observed" ? args.actions.skippedCannotApply : 0,
      skippedInsufficientFunds: args.actions.status === "observed" ? args.actions.skippedInsufficientFunds : 0,
      skippedInvalidQuote: args.actions.status === "observed" ? args.actions.skippedInvalidQuote : 0,
    },
    coverage: args.coverage,
  };
}

function toSimStats(m: SimStatsMutable): SimStats {
  return simStatsFromCounters({
    coverage: "complete",
    money: {
      status: "observed",
      applied: m.applied,
      dropped: m.dropped,
      queued: m.queued,
      flushed: m.flushed,
      blocked: m.blocked,
    },
    actions: {
      status: "observed",
      applied: m.actionApplied,
      skippedCannotApply: m.skippedCannotApply,
      skippedInsufficientFunds: m.skippedInsufficientFunds,
      skippedInvalidQuote: m.skippedInvalidQuote,
    },
  });
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
    skippedInvalidQuote: 0,
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
  const moneyStatus = stats.money.status ?? "observed";
  const actionStatus = stats.actions.status ?? "observed";

  if (moneyStatus === "observed" && stats.money.droppedRate !== null && stats.money.droppedRate > 0.5) {
    flags.push({
      code: "TOO_MANY_DROPS",
      severity: stats.money.droppedRate > 0.8 ? "critical" : "warn",
      detail: { droppedRate: stats.money.droppedRate },
    });
  }

  if (moneyStatus === "observed" && stats.money.flushRate !== null && stats.money.queued > 0 && stats.money.flushRate < 0.1) {
    flags.push({
      code: "TOO_RARE_FLUSH",
      severity: stats.money.flushRate < 0.03 ? "critical" : "warn",
      detail: { flushRate: stats.money.flushRate },
    });
  }

  if (actionStatus === "observed" && stats.actions.applied === 0 && stats.actions.skippedInsufficientFunds > 10) {
    flags.push({
      code: "STALLING_FEELING",
      severity: "warn",
      detail: { skippedInsufficientFunds: stats.actions.skippedInsufficientFunds },
    });
  }

  return flags;
}
