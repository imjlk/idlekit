import type { CompiledScenario, RunResult, SimState } from "../types";

export type GrowthSegment = Readonly<{
  tFrom: number;
  tTo: number;
  regime: "stall" | "exp" | "super-exp" | "softcap";
  slope: number;
  doublingTimeSec?: number;
}>;

export type GrowthReport = Readonly<{
  windowSec: number;
  seriesRequested: "money" | "netWorth";
  valueSource: "money" | "netWorth" | "netWorthFallback";
  segments: GrowthSegment[];
  bottlenecks: Array<{ t: number; reason: string }>;
}>;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number(v as any);
}

function valueOfState<N, U extends string, Vars>(
  s: SimState<N, U, Vars>,
  series: "money" | "netWorth",
  scenario?: CompiledScenario<N, U, Vars>,
): number {
  if (series === "netWorth") {
    if (!scenario) {
      throw new Error("analyzeGrowth requires compiled scenario when series='netWorth'");
    }
    const worth = scenario.model.netWorth?.(scenario.ctx, s) ?? s.wallet.money;
    return num((worth.amount as any) ?? 0);
  }
  return num((s.wallet.money.amount as any) ?? 0);
}

function sampleStatesByWindow<N, U extends string, Vars>(
  states: readonly SimState<N, U, Vars>[],
  windowSec: number,
): readonly SimState<N, U, Vars>[] {
  if (states.length <= 1024 || windowSec <= 1) return states;

  const sampled: SimState<N, U, Vars>[] = [];
  let anchor = states[0];
  if (anchor) sampled.push(anchor);

  for (let i = 1; i < states.length - 1; i += 1) {
    const state = states[i];
    if (!state || !anchor) continue;
    if (state.t - anchor.t >= windowSec) {
      sampled.push(state);
      anchor = state;
    }
  }

  const last = states[states.length - 1];
  if (last && sampled[sampled.length - 1]?.t !== last.t) {
    sampled.push(last);
  }

  return sampled;
}

function classify(slope: number): GrowthSegment["regime"] {
  if (slope < 1e-6) return "stall";
  if (slope < 0.01) return "softcap";
  if (slope < 0.1) return "exp";
  return "super-exp";
}

export function analyzeGrowth<N, U extends string, Vars>(args: {
  run: RunResult<N, U, Vars>;
  series: "money" | "netWorth";
  windowSec: number;
  scenario?: CompiledScenario<N, U, Vars>;
}): GrowthReport {
  if (args.series === "netWorth" && !args.scenario) {
    throw new Error("analyzeGrowth requires compiled scenario when series='netWorth'");
  }

  // A bounded trace keeps its tail. Slopes over that tail would read as the whole run.
  const droppedPoints = args.run.traceLog?.dropped ?? 0;
  if (droppedPoints > 0) {
    throw new Error(
      `analyzeGrowth needs the whole trace; the run dropped ${droppedPoints} trace points under trace.maxPoints`,
    );
  }

  const valueSource =
    args.series === "money"
      ? "money"
      : args.scenario?.model.netWorth
        ? "netWorth"
        : "netWorthFallback";
  const rawStates = args.run.trace && args.run.trace.length > 1 ? args.run.trace : [args.run.start, args.run.end];
  const effectiveSeries = valueSource === "netWorthFallback" ? "money" : args.series;
  const valueOf = (state: SimState<N, U, Vars>) => valueOfState(state, effectiveSeries, args.scenario);
  // An overflowed or NaN value has no slope. Split the trace there, so no segment spans an excluded point,
  // and say so instead of ending the segments quietly.
  const spans: SimState<N, U, Vars>[][] = [];
  let span: SimState<N, U, Vars>[] = [];
  let excluded = 0;
  let firstNonFinite: SimState<N, U, Vars> | undefined;
  for (const state of [...rawStates].sort((a, b) => a.t - b.t)) {
    if (Number.isFinite(valueOf(state))) {
      span.push(state);
      continue;
    }
    excluded += 1;
    firstNonFinite ??= state;
    if (span.length > 0) spans.push(span);
    span = [];
  }
  if (span.length > 0) spans.push(span);
  const bottlenecks: Array<{ t: number; reason: string }> = firstNonFinite
    ? [{ t: firstNonFinite.t, reason: `Value is not finite; ${excluded} trace points excluded` }]
    : [];
  const sampledSpans = spans
    .map((points) => sampleStatesByWindow(points, Math.max(1, Math.floor(args.windowSec))))
    .filter((points) => points.length >= 2);

  if (sampledSpans.length === 0) {
    return {
      windowSec: args.windowSec,
      seriesRequested: args.series,
      valueSource,
      segments: [],
      bottlenecks: [...bottlenecks, { t: args.run.end.t, reason: "Insufficient trace points" }],
    };
  }

  const segments: GrowthSegment[] = [];

  for (const states of sampledSpans) {
    for (let i = 1; i < states.length; i += 1) {
      const a = states[i - 1];
      const b = states[i];
      if (!a || !b) continue;

      const dt = Math.max(1e-9, b.t - a.t);
      const av = Math.max(1e-12, Math.abs(valueOf(a)));
      const bv = Math.max(1e-12, Math.abs(valueOf(b)));

      const slope = (Math.log10(bv) - Math.log10(av)) / dt;
      const regime = classify(slope);

      const doublingTimeSec = slope > 0 ? Math.log10(2) / slope : undefined;

      segments.push({
        tFrom: a.t,
        tTo: b.t,
        regime,
        slope,
        doublingTimeSec,
      });

      if (regime === "stall") {
        bottlenecks.push({ t: b.t, reason: "Near-zero growth slope" });
      }
    }
  }

  return {
    windowSec: args.windowSec,
    seriesRequested: args.series,
    valueSource,
    segments,
    bottlenecks,
  };
}
