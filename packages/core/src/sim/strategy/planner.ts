import type { Strategy } from "./types";
import { stepOnce } from "../step";
import type { StepOnceFn } from "../stepTypes";
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

/**
 * Planner MUST use stepOnce for rollouts.
 * Do NOT re-implement simulator tick/payment logic inside planner.
 */
export type PlannerDeps<N, U extends string, Vars> = Readonly<{
  stepOnce: StepOnceFn<N, U, Vars>;
}>;

export function createPlannerStrategy<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  deps?: PlannerDeps<N, U, Vars>,
): Strategy<N, U, Vars> {
  const d: PlannerDeps<N, U, Vars> = deps ?? ({ stepOnce } as PlannerDeps<N, U, Vars>);
  void d;

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
