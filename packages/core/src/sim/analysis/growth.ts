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

  const valueSource =
    args.series === "money"
      ? "money"
      : args.scenario?.model.netWorth
        ? "netWorth"
        : "netWorthFallback";
  const rawStates = args.run.trace && args.run.trace.length > 1 ? args.run.trace : [args.run.start, args.run.end];
  const states = sampleStatesByWindow(
    rawStates
    .filter((s) =>
      Number.isFinite(valueOfState(s, valueSource === "netWorthFallback" ? "money" : args.series, args.scenario)),
    )
    .sort((a, b) => a.t - b.t),
    Math.max(1, Math.floor(args.windowSec)),
  );

  if (states.length < 2) {
    return {
      windowSec: args.windowSec,
      seriesRequested: args.series,
      valueSource,
      segments: [],
      bottlenecks: [{ t: args.run.end.t, reason: "Insufficient trace points" }],
    };
  }

  const segments: GrowthSegment[] = [];
  const bottlenecks: Array<{ t: number; reason: string }> = [];

  for (let i = 1; i < states.length; i += 1) {
    const a = states[i - 1];
    const b = states[i];
    if (!a || !b) continue;

    const dt = Math.max(1e-9, b.t - a.t);
    const effectiveSeries = valueSource === "netWorthFallback" ? "money" : args.series;
    const av = Math.max(1e-12, Math.abs(valueOfState(a, effectiveSeries, args.scenario)));
    const bv = Math.max(1e-12, Math.abs(valueOfState(b, effectiveSeries, args.scenario)));

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

  return {
    windowSec: args.windowSec,
    seriesRequested: args.series,
    valueSource,
    segments,
    bottlenecks,
  };
}
