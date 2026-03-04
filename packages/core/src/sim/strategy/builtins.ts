import { z } from "zod";
import type { StandardSchema } from "../../scenario/validate";
import { createGreedyStrategy, type GreedyObjective } from "./greedy";
import { createPlannerStrategy, type PlannerObjective } from "./planner";
import { createScriptedStrategy } from "./scripted";
import type { StrategyFactory } from "./registry";

function asStandard<T>(schema: z.ZodType<T>): StandardSchema<T> {
  return schema as unknown as StandardSchema<T>;
}

export const builtinStrategyFactories: readonly StrategyFactory[] = [
  {
    id: "greedy",
    paramsSchema: asStandard(
      z
        .object({
          objective: z.enum(["maximizeIncome", "minPayback", "maximizeNetWorth"]).optional(),
        })
        .partial(),
    ),
    create(params: { objective?: GreedyObjective }) {
      return createGreedyStrategy(params ?? {});
    },
  },
  {
    id: "planner",
    paramsSchema: asStandard(
      z
        .object({
          objective: z.enum(["maximizeNetWorthAtEnd", "minTimeToTargetWorth", "maximizePrestigePerHour"]).optional(),
          horizonSteps: z.coerce.number().int().positive().optional(),
        })
        .partial(),
    ),
    create(params: { objective?: PlannerObjective; horizonSteps?: number }) {
      return createPlannerStrategy(params ?? {});
    },
  },
  {
    id: "scripted",
    paramsSchema: asStandard(
      z
        .object({
          plan: z
            .array(
              z.object({
                actionId: z.string(),
                bulkSize: z.coerce.number().int().positive().optional(),
              }),
            )
            .optional(),
        })
        .partial(),
    ),
    create(params: { plan?: Array<{ actionId: string; bulkSize?: number }> }) {
      return createScriptedStrategy(params?.plan ?? []);
    },
  },
];
