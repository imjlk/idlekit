import { runScenario } from "../simulator";
import type { CompiledScenario } from "../types";

export type PrestigeCycleObjective = "netWorthPerHour" | "pointsPerHour";

export type PrestigeCycleRow = Readonly<{
  intervalSec: number;
  cycles: number;
  netWorthPerHour: string;
  pointsPerHour: string;
  breakEvenSec: number;
  stability: "stable" | "drifting";
}>;

function metric(row: PrestigeCycleRow, objective: PrestigeCycleObjective): number {
  return Number(objective === "netWorthPerHour" ? row.netWorthPerHour : row.pointsPerHour);
}

export function analyzePrestigeCycle<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  scan: Readonly<{ fromSec: number; toSec: number; stepSec: number }>;
  horizonSec: number;
  cycles: number;
  objective: PrestigeCycleObjective;
}): Readonly<{ best: PrestigeCycleRow; rows: PrestigeCycleRow[] }> {
  const rows: PrestigeCycleRow[] = [];

  for (let interval = args.scan.fromSec; interval <= args.scan.toSec; interval += args.scan.stepSec) {
    const run = runScenario({
      ...args.scenario,
      run: {
        ...args.scenario.run,
        durationSec: interval,
        trace: undefined,
      },
    });

    const worth = args.scenario.model.netWorth?.(args.scenario.ctx, run.end) ?? run.end.wallet.money;
    const netWorthPerHour =
      args.scenario.ctx.E.toNumber(worth.amount) / Math.max(1 / 3600, interval / 3600);

    const gainedPoints = args.scenario.ctx.E.sub(run.end.prestige.points, run.start.prestige.points);
    const pointsPerHour =
      args.scenario.ctx.E.toNumber(gainedPoints) / Math.max(1 / 3600, interval / 3600);

    rows.push({
      intervalSec: interval,
      cycles: args.cycles,
      netWorthPerHour: String(netWorthPerHour),
      pointsPerHour: String(pointsPerHour),
      breakEvenSec: Math.min(interval, args.horizonSec),
      stability: args.cycles >= 5 ? "stable" : "drifting",
    });
  }

  if (rows.length === 0) {
    throw new Error("No rows generated for prestige cycle analysis");
  }

  const first = rows[0];
  if (!first) {
    throw new Error("No rows generated for prestige cycle analysis");
  }

  let best = first;
  for (const row of rows.slice(1)) {
    if (metric(row, args.objective) > metric(best, args.objective)) {
      best = row;
    }
  }

  return { best, rows };
}
