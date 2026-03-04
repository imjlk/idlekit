import type { RunResult, SimState } from "../types";

export type GrowthSegment = Readonly<{
  tFrom: number;
  tTo: number;
  regime: "stall" | "exp" | "super-exp" | "softcap";
  slope: number;
  doublingTimeSec?: number;
}>;

export type GrowthReport = Readonly<{
  windowSec: number;
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
): number {
  // netWorth series fallback: current implementation uses wallet until simulator stores explicit worth trace.
  if (series === "netWorth") {
    return num((s.wallet.money.amount as any) ?? 0);
  }
  return num((s.wallet.money.amount as any) ?? 0);
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
}): GrowthReport {
  const rawStates = args.run.trace && args.run.trace.length > 1 ? args.run.trace : [args.run.start, args.run.end];
  const states = rawStates
    .filter((s) => Number.isFinite(valueOfState(s, args.series)))
    .sort((a, b) => a.t - b.t);

  if (states.length < 2) {
    return {
      windowSec: args.windowSec,
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
    const av = Math.max(1e-12, Math.abs(valueOfState(a, args.series)));
    const bv = Math.max(1e-12, Math.abs(valueOfState(b, args.series)));

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
    segments,
    bottlenecks,
  };
}
