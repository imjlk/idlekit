import type { ScenarioV1 } from "../scenario/types";

export type CompareMetric =
  | "endMoney"
  | "endNetWorth"
  | "etaToTargetWorth"
  | "droppedRate"
  | "timeToMilestone"
  | "visibleChangesPerMinute"
  | "maxNoRewardGapSec";

export type MeasuredCompareMetrics = Readonly<Partial<Record<CompareMetric, number>>>;
export type MeasuredDecision = "a" | "b" | "tie";

function decimalParts(input: string) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))(?:e([+-]?\d+))?([a-z]{2,})?$/i.exec(input.trim());
  if (!match) throw new RangeError("Static monetary comparison requires decimal amounts");
  let suffixExponent = 0n;
  if (match[6]) {
    // alphaInfinite minLen=2: aa=1, az=26, zz=676, aaa=677.
    // Keep the suffix index exact instead of routing it through a number engine.
    let index = 0n;
    for (const ch of match[6].toLowerCase()) index = index * 26n + BigInt(ch.charCodeAt(0) - 96);
    suffixExponent = (index - 26n) * 3n;
  }
  const fraction = match[3] ?? match[4] ?? "";
  const digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/, "");
  let end = digits.length;
  while (end > 0 && digits[end - 1] === "0") end--;
  return {
    sign: digits.length === 0 ? 0 : match[1] === "-" ? -1 : 1,
    digits: digits.slice(0, end),
    magnitude: BigInt(match[5] ?? "0") + suffixExponent - BigInt(fraction.length) + BigInt(digits.length),
  };
}

/** Compare the decimal spellings without rounding, taking logs, or expanding powers of ten. */
function compareStaticMoney(left: string, right: string): number {
  const a = decimalParts(left), b = decimalParts(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  if (a.magnitude !== b.magnitude) return (a.magnitude < b.magnitude ? -1 : 1) * a.sign;
  const length = Math.max(a.digits.length, b.digits.length);
  const ad = a.digits.padEnd(length, "0"), bd = b.digits.padEnd(length, "0");
  return (ad < bd ? -1 : ad > bd ? 1 : 0) * a.sign;
}

function score(s: ScenarioV1, metric: CompareMetric): number | string {
  switch (metric) {
    case "endMoney":
      return s.initial.wallet.amount;
    case "endNetWorth":
      return s.initial.maxMoneyEver ?? s.initial.wallet.amount;
    case "droppedRate":
      return -(s.policy.maxLogGap ?? 0);
    case "etaToTargetWorth":
      return -(s.clock.durationSec ?? Number.MAX_SAFE_INTEGER);
    case "timeToMilestone":
    case "visibleChangesPerMinute":
    case "maxNoRewardGapSec":
      return 0;
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

  if (!useMeasured && (args.metric === "endMoney" || args.metric === "endNetWorth")) {
    const order = compareStaticMoney(String(aScore), String(bScore));
    return {
      better: order === 0 ? "tie" : order > 0 ? "a" : "b",
      detail: { aScore, bScore, metric: args.metric, source: "static" },
    };
  }

  const higherBetter =
    args.metric === "endMoney" ||
    args.metric === "endNetWorth" ||
    args.metric === "visibleChangesPerMinute";

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
