import { runScenario } from "../simulator";
import { assertHorizonReached, type CompiledScenario } from "../types";

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

const maxPrestigeScanIntervals = 100_000;

export function analyzePrestigeCycle<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  scan: Readonly<{ fromSec: number; toSec: number; stepSec: number }>;
  horizonSec: number;
  cycles: number;
  objective: PrestigeCycleObjective;
}): Readonly<{ best: PrestigeCycleRow; rows: PrestigeCycleRow[] }> {
  const rows: PrestigeCycleRow[] = [];
  const { fromSec, toSec, stepSec } = args.scan;
  // `interval += stepSec` never ends for a step <= 0, or once the step is below an ulp of the interval.
  if (
    !Number.isFinite(fromSec) ||
    !Number.isFinite(toSec) ||
    !Number.isFinite(stepSec) ||
    !(fromSec > 0) ||
    toSec < fromSec ||
    !(stepSec > 0)
  ) {
    throw new Error(
      `analyzePrestigeCycle scan needs finite 0 < fromSec <= toSec and stepSec > 0 (received: ${fromSec}..${toSec} step ${stepSec})`,
    );
  }
  // Index the grid so 0.1 + 0.1 + 0.1 rounding cannot skip toSec.
  const count = Math.floor((toSec - fromSec) / stepSec + 1e-9) + 1;
  // Each interval is a full run. Refuse a grid that would allocate or run more than that before starting.
  if (!Number.isFinite(count) || count > maxPrestigeScanIntervals) {
    throw new Error(
      `analyzePrestigeCycle scan ${fromSec}..${toSec} step ${stepSec} has ${count} intervals; the limit is ${maxPrestigeScanIntervals}`,
    );
  }

  const intervals: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const interval = Math.min(fromSec + i * stepSec, toSec);
    const previous = intervals.at(-1);
    if (previous !== undefined && !(interval > previous)) {
      throw new Error(`analyzePrestigeCycle scan step ${stepSec} cannot advance interval ${previous}`);
    }
    intervals.push(interval);
  }

  for (const interval of intervals) {
    const run = runScenario({
      ...args.scenario,
      run: {
        ...args.scenario.run,
        durationSec: interval,
        trace: undefined,
      },
    });
    // Rates divide by the interval, so a budget stop cannot stand for it.
    assertHorizonReached(run, "analyzePrestigeCycle");

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

  // A NaN or overflowed rate cannot rank. NaN never compares greater, so it would keep the first row.
  let best: PrestigeCycleRow | undefined;
  for (const row of rows) {
    const value = metric(row, args.objective);
    if (!Number.isFinite(value)) continue;
    if (best === undefined || value > metric(best, args.objective)) {
      best = row;
    }
  }
  if (!best) {
    throw new Error(`analyzePrestigeCycle has no finite ${args.objective} to rank`);
  }

  return { best, rows };
}
