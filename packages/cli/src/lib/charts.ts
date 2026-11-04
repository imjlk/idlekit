import {
  buildProgressionChartData,
  chartTraceEverySteps,
  createChartData,
  DEFAULT_CHART_MAX_POINTS,
  renderChartSvg,
  resolveChartMaxPoints,
  MAX_CHART_MAX_POINTS,
  MIN_CHART_MAX_POINTS,
  type ChartDataV1,
  type Engine,
  type ProgressionChartData,
  type ProgressionSample,
  type SimState,
} from "@idlekit/core";
import { resolve } from "path";
import { z } from "zod";
import { usageError } from "../errors";
import { assertOutputNotInput } from "../io/writeOutput";
import { option } from "../runtime/command";
import { writeTextFile } from "../runtime/bun";

/** Chart flags shared by simulate, experience, compare, and experiment. */
export function chartOptions() {
  return {
    "chart-out": option(z.string().optional(), {
      description: "Write a dependency-free SVG chart to path (progression, A/B KPI, or sensitivity heatmap)",
    }),
    "chart-data-out": option(z.string().optional(), {
      description: "Write the chart data JSON (idlekit.chart-data.v1) to path",
    }),
    "chart-max-points": option(z.coerce.number().optional(), {
      description: `Points kept per chart series after LTTB downsampling (${MIN_CHART_MAX_POINTS}-${MAX_CHART_MAX_POINTS}, default ${DEFAULT_CHART_MAX_POINTS})`,
    }),
  };
}

export type ChartFlags = Readonly<{
  "chart-out"?: string;
  "chart-data-out"?: string;
  "chart-max-points"?: number;
}>;

/** Flags that only choose chart artifacts. Replay omits them: they do not change the result. */
export const CHART_FLAGS = ["chart-out", "chart-data-out", "chart-max-points"] as const;

export function chartRequested(flags: ChartFlags): boolean {
  return Boolean(flags["chart-out"] || flags["chart-data-out"]);
}

/** The point budget, checked before any run starts so a bad flag fails fast. */
export function chartMaxPoints(flags: ChartFlags): number {
  try {
    return resolveChartMaxPoints(flags["chart-max-points"]);
  } catch (error) {
    throw usageError(`--chart-max-points: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runner trace options for a charted run. The interval keeps about four candidate states per plotted
 * point, so memory stays bounded for long runs. Without a duration, `maxSteps` bounds the step count.
 * The trace only records states; it does not change what the run computes.
 */
export function chartTrace(args: Readonly<{
  durationSec: number | undefined;
  maxSteps?: number;
  stepSec: number;
  maxPoints: number;
}>): Readonly<{ trace: Readonly<{ everySteps: number; keepActionsLog: false }>; everySteps: number }> {
  const totalSteps = args.durationSec !== undefined && args.stepSec > 0
    ? Math.ceil(args.durationSec / args.stepSec)
    : args.maxSteps;
  const everySteps = chartTraceEverySteps({ totalSteps, maxPoints: args.maxPoints });
  return { trace: { everySteps, keepActionsLog: false }, everySteps };
}

type Amount<N> = Readonly<{ amount: N }>;

/** Read money and (when the model values holdings) net worth from each state, as text plus log10. */
export function progressionSamples<N, U extends string, Vars>(args: Readonly<{
  E: Engine<N>;
  states: readonly SimState<N, U, Vars>[];
  netWorth?: (state: SimState<N, U, Vars>) => Amount<N>;
}>): ProgressionSample[] {
  const read = (amount: N) => ({ text: args.E.toString(amount), log10: args.E.absLog10(amount) });
  return args.states.map((state) => ({
    t: state.t,
    money: read(state.wallet.money.amount),
    ...(args.netWorth ? { netWorth: read(args.netWorth(state).amount) } : {}),
  }));
}

export function progressionChart<N, U extends string, Vars>(args: Readonly<{
  E: Engine<N>;
  states: readonly SimState<N, U, Vars>[];
  startT: number;
  unit: string;
  primarySeries: "money" | "netWorth";
  netWorth?: (state: SimState<N, U, Vars>) => Amount<N>;
  milestones?: readonly Readonly<{ key: string; t: number; source: string }>[];
  droppedMilestones?: number;
  maxPoints: number;
  traceEverySteps?: number | null;
}>): ProgressionChartData {
  return buildProgressionChartData({
    samples: progressionSamples({ E: args.E, states: args.states, netWorth: args.netWorth }),
    startT: args.startT,
    unit: args.unit,
    primarySeries: args.primarySeries,
    milestones: args.milestones,
    droppedMilestones: args.droppedMilestones,
    maxPoints: args.maxPoints,
    traceEverySteps: args.traceEverySteps,
  });
}

/** Serialize chart data as stable JSON (two-space indent, trailing newline). */
export function chartDataJson(data: ChartDataV1): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Other output flags a chart path must not share, so a chart never overwrites the result or an artifact. */
const OTHER_OUTPUT_FLAGS = ["out", "artifact-out", "state-out"] as const;

/** Write the requested chart artifacts. Each path is checked against the other outputs and the command's inputs first. */
export async function writeChartArtifacts(
  flags: ChartFlags & Readonly<Partial<Record<(typeof OTHER_OUTPUT_FLAGS)[number], string>>>,
  data: ChartDataV1,
): Promise<Readonly<{ svg?: string; data?: string }>> {
  const svgPath = flags["chart-out"] ? resolve(process.cwd(), flags["chart-out"]) : undefined;
  const dataPath = flags["chart-data-out"] ? resolve(process.cwd(), flags["chart-data-out"]) : undefined;
  if (svgPath && dataPath && svgPath === dataPath) {
    throw usageError("--chart-out and --chart-data-out must name different files");
  }
  for (const name of OTHER_OUTPUT_FLAGS) {
    const other = flags[name];
    if (!other) continue;
    const otherPath = resolve(process.cwd(), other);
    if (otherPath === svgPath || otherPath === dataPath) {
      throw usageError(`chart output paths must differ from --${name}`);
    }
  }
  for (const path of [svgPath, dataPath]) if (path) await assertOutputNotInput(path);
  if (svgPath) await writeTextFile(svgPath, renderChartSvg(data));
  if (dataPath) await writeTextFile(dataPath, chartDataJson(data));
  return { ...(svgPath ? { svg: svgPath } : {}), ...(dataPath ? { data: dataPath } : {}) };
}

export { createChartData };
