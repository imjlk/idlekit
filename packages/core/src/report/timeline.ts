import type { RunResult } from "../sim/types";

export type TimelinePoint = Readonly<{
  t: number;
  money: string;
  netWorth?: string;
  prestigePoints?: string;
  notes?: string[];
}>;

function nearestAt<T extends { t: number }>(trace: readonly T[], t: number): T {
  if (trace.length === 0) {
    throw new Error("trace is empty");
  }

  const first = trace[0];
  if (!first) {
    throw new Error("trace is empty");
  }

  let best = first;
  let bestGap = Math.abs(best.t - t);

  for (const row of trace) {
    const gap = Math.abs(row.t - t);
    if (gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }

  return best;
}

export function buildTimeline(args: {
  run: RunResult<any, any, any>;
  checkpointsSec: number[];
  formatMoney: (amount: any) => string;
  formatNetWorth?: (amount: any) => string;
}): TimelinePoint[] {
  const trace = args.run.trace && args.run.trace.length > 0 ? args.run.trace : [args.run.start, args.run.end];

  return args.checkpointsSec.map((t) => {
    const s = nearestAt(trace, t);
    const notes: string[] = [];

    if (s.t !== t) {
      notes.push(`nearestTrace=${s.t}`);
    }

    return {
      t,
      money: args.formatMoney(s.wallet.money.amount),
      netWorth: args.formatNetWorth ? args.formatNetWorth(s.maxMoneyEver.amount) : undefined,
      prestigePoints: String(s.prestige.points as any),
      notes: notes.length > 0 ? notes : undefined,
    };
  });
}
