import type { StrategyFactory } from "./registry";
import {
  GreedyStrategyParamsV1Schema,
  PlannerStrategyParamsV1Schema,
  ScriptedStrategyParamsV1Schema,
} from "./params";

import { createGreedyStrategy } from "./greedy";
import { createPlannerStrategy } from "./planner";
import { createScriptedStrategy } from "./scripted";

export const builtinStrategyFactories: readonly StrategyFactory[] = [
  {
    id: "scripted",
    defaultParams: {
      schemaVersion: 1,
      program: [],
      onCannotApply: "skip",
      loop: true,
    },
    paramsSchema: ScriptedStrategyParamsV1Schema,
    create: (params) => createScriptedStrategy(params),
  },
  {
    id: "greedy",
    defaultParams: {
      schemaVersion: 1,
      objective: "minPayback",
      maxPicksPerStep: 1,
      bulk: { mode: "bestQuote" },
      payback: { capSec: 365 * 24 * 3600, useEquivalentCost: true, preferQuotedDeltaIncome: true },
      netWorth: { horizonSec: 900, series: "netWorth", useFastPreview: true },
      tieBreak: { preferLowerCost: true, preferBulk: true },
    },
    paramsSchema: GreedyStrategyParamsV1Schema,
    create: (params) => createGreedyStrategy(params),
  },
  {
    id: "planner",
    defaultParams: {
      schemaVersion: 1,
      horizonSteps: 6,
      beamWidth: 1,
      objective: "maximizeNetWorthAtEnd",
      series: "netWorth",
      maxBranchingActions: 8,
      useFastPreview: true,
      bulk: { mode: "bestQuote" },
    },
    paramsSchema: PlannerStrategyParamsV1Schema,
    create: (params) => createPlannerStrategy(params),
  },
];
