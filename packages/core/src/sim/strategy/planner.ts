import type { Strategy } from "./types";
import { createGreedyStrategy } from "./greedy";
import type { PlannerObjectiveId, PlannerStrategyParamsV1 } from "./params";

export type PlannerObjective = PlannerStrategyParamsV1["objective"];

function asGreedy(objective: PlannerObjectiveId): "maximizeIncome" | "minPayback" | "maximizeNetWorth" {
  switch (objective) {
    case "minTimeToTargetWorth":
      return "minPayback";
    case "maximizePrestigePerHour":
      return "maximizeIncome";
    default:
      return "maximizeNetWorth";
  }
}

export function createPlannerStrategy<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
): Strategy<N, U, Vars> {
  const greedy = createGreedyStrategy<N, U, Vars>({
    schemaVersion: 1,
    objective: asGreedy(params.objective),
    maxPicksPerStep: 1,
    bulk: { mode: params.bulk?.mode ?? "bestQuote" },
    netWorth: {
      horizonSec: Math.max(1, (params.horizonSteps ?? 1)) * 60,
      series: params.series ?? "netWorth",
      useFastPreview: params.useFastPreview ?? true,
    },
  });

  return {
    id: "planner",
    decide: greedy.decide,
  };
}
