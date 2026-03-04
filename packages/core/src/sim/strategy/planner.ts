import type { Strategy } from "./types";
import { createGreedyStrategy, type GreedyOptions } from "./greedy";

export type PlannerObjective =
  | "maximizeNetWorthAtEnd"
  | "minTimeToTargetWorth"
  | "maximizePrestigePerHour";

export type PlannerOptions = Readonly<{
  objective?: PlannerObjective;
  horizonSteps?: number;
}>;

function asGreedy(objective: PlannerObjective): GreedyOptions["objective"] {
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
  opts?: PlannerOptions,
): Strategy<N, U, Vars> {
  const objective = opts?.objective ?? "maximizeNetWorthAtEnd";
  const greedy = createGreedyStrategy<N, U, Vars>({ objective: asGreedy(objective) });

  return {
    id: "planner",
    decide: greedy.decide,
  };
}
