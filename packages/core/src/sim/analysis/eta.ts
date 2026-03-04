import { runScenario } from "../simulator";
import type { CompiledScenario, RunResult } from "../types";
import { parseMoney } from "../../notation/parseMoney";

export type ETATarget = Readonly<
  | { kind: "money"; value: string }
  | { kind: "netWorth"; value: string }
>;

export type ETAResult = Readonly<{
  reached: boolean;
  seconds: number;
  mode: "simulate" | "analytic";
  confidence?: "high" | "medium" | "low";
  assumptions?: string[];
  compare?: Readonly<{
    simulateSec?: number;
    analyticSec?: number;
    diffSec?: number;
    diffPct?: number;
  }>;
  run?: RunResult<any, any, any>;
}>;

function targetReached<N, U extends string, Vars>(
  scenario: CompiledScenario<N, U, Vars>,
  targetKind: ETATarget["kind"],
  threshold: N,
  run: RunResult<N, U, Vars>,
): boolean {
  const { E } = scenario.ctx;

  if (targetKind === "money") {
    return E.cmp(run.end.wallet.money.amount, threshold) >= 0;
  }

  const worth = scenario.model.netWorth?.(scenario.ctx, run.end) ?? run.end.wallet.money;
  return E.cmp(worth.amount, threshold) >= 0;
}

export function etaSimulate<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  target: ETATarget;
  maxDurationSec: number;
  includeRun?: boolean;
}): ETAResult {
  const threshold = parseMoney(args.scenario.ctx.E, args.target.value, {
    unit: args.scenario.ctx.unit,
    suffix: { kind: "alphaInfinite", minLen: 2 },
  }).amount;

  const until = (s: RunResult<N, U, Vars>["end"]) => {
    if (args.target.kind === "money") {
      return args.scenario.ctx.E.cmp(s.wallet.money.amount, threshold) >= 0;
    }
    const worth = args.scenario.model.netWorth?.(args.scenario.ctx, s) ?? s.wallet.money;
    return args.scenario.ctx.E.cmp(worth.amount, threshold) >= 0;
  };

  const scenario: CompiledScenario<N, U, Vars> = {
    ...args.scenario,
    run: {
      ...args.scenario.run,
      durationSec: args.maxDurationSec,
      trace: undefined,
      until,
    },
  };

  const run = runScenario(scenario);
  const reached = targetReached(scenario, args.target.kind, threshold, run);

  return {
    reached,
    seconds: reached ? run.end.t - run.start.t : args.maxDurationSec,
    mode: "simulate",
    confidence: "high",
    assumptions: ["Direct simulation over maxDurationSec"],
    run: args.includeRun ? run : undefined,
  };
}

export function etaAnalytic<N, U extends string, Vars>(args: {
  scenario: CompiledScenario<N, U, Vars>;
  target: ETATarget;
}): ETAResult {
  const { scenario } = args;
  const { E } = scenario.ctx;

  const currMoney = scenario.initial.wallet.money.amount;
  const currWorth = (scenario.model.netWorth?.(scenario.ctx, scenario.initial) ?? scenario.initial.wallet.money)
    .amount;
  const rate = scenario.model.income(scenario.ctx, scenario.initial).amount;

  const threshold = E.from(args.target.value);
  const current = args.target.kind === "money" ? currMoney : currWorth;

  if (E.cmp(current, threshold) >= 0) {
    return {
      reached: true,
      seconds: 0,
      mode: "analytic",
      confidence: "high",
      assumptions: ["Target already reached at t=0"],
    };
  }

  const r = E.toNumber(rate);
  if (!(r > 0)) {
    return {
      reached: false,
      seconds: Number.POSITIVE_INFINITY,
      mode: "analytic",
      confidence: "low",
      assumptions: ["Non-positive initial income; analytic estimate unavailable"],
    };
  }

  const diff = E.toNumber(E.sub(threshold, current));
  const seconds = Math.max(0, diff / r);

  const hint = scenario.model.analytic?.(scenario.ctx, scenario.initial);
  const confidence = hint?.incomeKind === "constant" ? "high" : "medium";

  return {
    reached: Number.isFinite(seconds),
    seconds,
    mode: "analytic",
    confidence,
    assumptions: [
      "Income assumed near-constant in local interval",
      hint ? `Model analytic hint: ${hint.incomeKind ?? "custom"}` : "No analytic hint provided",
    ],
  };
}
