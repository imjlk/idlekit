import type { ScenarioV1 } from "../scenario/types";

export type CompareMetric =
  | "endMoney"
  | "endNetWorth"
  | "etaToTargetWorth"
  | "droppedRate";

export type MeasuredCompareMetrics = Readonly<Partial<Record<CompareMetric, number>>>;
export type MeasuredDecision = "a" | "b" | "tie";

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

function measuredScore(
  measured: MeasuredCompareMetrics | undefined,
  metric: CompareMetric,
): number | undefined {
  if (!measured) return undefined;
  const v = measured[metric];
  return typeof v === "number" ? v : undefined;
}

export function compareScenarios(args: {
  a: ScenarioV1;
  b: ScenarioV1;
  metric: CompareMetric;
  measured?: Readonly<{
    a?: MeasuredCompareMetrics;
    b?: MeasuredCompareMetrics;
  }>;
  measuredDecision?: (metric: CompareMetric) => MeasuredDecision | undefined;
}): Readonly<{ better: "a" | "b" | "tie"; detail: unknown }> {
  const decision = args.measuredDecision?.(args.metric);
  if (decision) {
    const measuredA = measuredScore(args.measured?.a, args.metric);
    const measuredB = measuredScore(args.measured?.b, args.metric);
    return {
      better: decision,
      detail: {
        aScore: measuredA,
        bScore: measuredB,
        metric: args.metric,
        source: "measured",
      },
    };
  }

  const measuredA = measuredScore(args.measured?.a, args.metric);
  const measuredB = measuredScore(args.measured?.b, args.metric);
  const useMeasured = measuredA !== undefined && measuredB !== undefined;

  const aScore = useMeasured ? measuredA : score(args.a, args.metric);
  const bScore = useMeasured ? measuredB : score(args.b, args.metric);

  const higherBetter = args.metric === "endMoney" || args.metric === "endNetWorth";

  if (aScore === bScore) {
    return {
      better: "tie",
      detail: {
        aScore,
        bScore,
        metric: args.metric,
        source: useMeasured ? "measured" : "static",
      },
    };
  }

  return {
    better: higherBetter
      ? (aScore > bScore ? "a" : "b")
      : (aScore < bScore ? "a" : "b"),
    detail: {
      aScore,
      bScore,
      metric: args.metric,
      source: useMeasured ? "measured" : "static",
    },
  };
}
