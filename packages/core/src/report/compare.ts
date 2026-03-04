import type { ScenarioV1 } from "../scenario/types";

export type CompareMetric =
  | "endMoney"
  | "endNetWorth"
  | "etaToTargetWorth"
  | "droppedRate";

function safeNum(input: unknown): number {
  if (typeof input === "number") return input;
  if (typeof input === "string") return Number(input);
  return Number.NaN;
}

function score(s: ScenarioV1, metric: CompareMetric): number {
  switch (metric) {
    case "endMoney":
      return safeNum(s.initial.wallet.amount);
    case "endNetWorth":
      return safeNum(s.initial.maxMoneyEver ?? s.initial.wallet.amount);
    case "droppedRate":
      return -(s.policy.maxLogGap ?? 0);
    case "etaToTargetWorth":
      return -(s.clock.durationSec ?? Number.MAX_SAFE_INTEGER);
    default:
      return 0;
  }
}

export function compareScenarios(args: {
  a: ScenarioV1;
  b: ScenarioV1;
  metric: CompareMetric;
}): Readonly<{ better: "a" | "b" | "tie"; detail: unknown }> {
  const aScore = score(args.a, args.metric);
  const bScore = score(args.b, args.metric);

  if (aScore === bScore) {
    return { better: "tie", detail: { aScore, bScore, metric: args.metric } };
  }

  return {
    better: aScore > bScore ? "a" : "b",
    detail: { aScore, bScore, metric: args.metric },
  };
}
