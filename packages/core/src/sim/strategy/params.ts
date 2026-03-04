import type { StandardSchema } from "../../scenario/validate";
import { zodStandardSchema } from "../../scenario/validate";
import { z } from "zod";

export type EmptyObject = Record<string, never>;

export type ScriptedStrategyParamsV1 = Readonly<{
  schemaVersion: 1;

  program: readonly Readonly<{
    actionId: string;
    bulkSize?: number;
  }>[];

  onCannotApply?: "skip" | "stop";

  loop?: boolean;
}>;

export type GreedyObjectiveId =
  | "maximizeIncome"
  | "minPayback"
  | "maximizeNetWorth";

export type GreedyBulkMode =
  | "size1"
  | "bestQuote"
  | "maxAffordable";

export type GreedyStrategyParamsV1 = Readonly<{
  schemaVersion: 1;

  objective: GreedyObjectiveId;

  maxPicksPerStep?: number;

  bulk?: Readonly<{
    mode?: GreedyBulkMode;
    maxSizeCap?: number;
  }>;

  payback?: Readonly<{
    capSec?: number;
    useEquivalentCost?: boolean;
    preferQuotedDeltaIncome?: boolean;
  }>;

  netWorth?: Readonly<{
    horizonSec?: number;
    series?: "netWorth" | "money";
    useFastPreview?: boolean;
  }>;

  tieBreak?: Readonly<{
    preferLowerCost?: boolean;
    preferBulk?: boolean;
  }>;
}>;

export type PlannerObjectiveId =
  | "maximizeNetWorthAtEnd"
  | "minTimeToTargetWorth"
  | "maximizePrestigePerHour";

export type PlannerStrategyParamsV1 = Readonly<{
  schemaVersion: 1;

  horizonSteps: number;

  beamWidth?: number;

  objective: PlannerObjectiveId;

  targetWorth?: string;

  series?: "netWorth" | "money";

  maxBranchingActions?: number;

  useFastPreview?: boolean;

  bulk?: Readonly<{
    mode?: "size1" | "bestQuote";
  }>;
}>;

export const ScriptedStrategyParamsV1Schema: StandardSchema<ScriptedStrategyParamsV1> =
  zodStandardSchema(
    z.object({
      schemaVersion: z.literal(1),
      program: z.array(
        z.object({
          actionId: z.string().min(1),
          bulkSize: z.number().int().positive().optional(),
        }),
      ),
      onCannotApply: z.enum(["skip", "stop"]).optional(),
      loop: z.boolean().optional(),
    }),
  );

export const GreedyStrategyParamsV1Schema: StandardSchema<GreedyStrategyParamsV1> =
  zodStandardSchema(
    z.object({
      schemaVersion: z.literal(1),
      objective: z.enum(["maximizeIncome", "minPayback", "maximizeNetWorth"]),
      maxPicksPerStep: z.number().int().positive().optional(),
      bulk: z
        .object({
          mode: z.enum(["size1", "bestQuote", "maxAffordable"]).optional(),
          maxSizeCap: z.number().int().positive().optional(),
        })
        .optional(),
      payback: z
        .object({
          capSec: z.number().positive().optional(),
          useEquivalentCost: z.boolean().optional(),
          preferQuotedDeltaIncome: z.boolean().optional(),
        })
        .optional(),
      netWorth: z
        .object({
          horizonSec: z.number().positive().optional(),
          series: z.enum(["netWorth", "money"]).optional(),
          useFastPreview: z.boolean().optional(),
        })
        .optional(),
      tieBreak: z
        .object({
          preferLowerCost: z.boolean().optional(),
          preferBulk: z.boolean().optional(),
        })
        .optional(),
    }),
  );

export const PlannerStrategyParamsV1Schema: StandardSchema<PlannerStrategyParamsV1> =
  zodStandardSchema(
    z.object({
      schemaVersion: z.literal(1),
      horizonSteps: z.number().int().positive(),
      beamWidth: z.number().int().positive().optional(),
      objective: z.enum(["maximizeNetWorthAtEnd", "minTimeToTargetWorth", "maximizePrestigePerHour"]),
      targetWorth: z.string().optional(),
      series: z.enum(["netWorth", "money"]).optional(),
      maxBranchingActions: z.number().int().positive().optional(),
      useFastPreview: z.boolean().optional(),
      bulk: z
        .object({
          mode: z.enum(["size1", "bestQuote"]).optional(),
        })
        .optional(),
    }),
  );
