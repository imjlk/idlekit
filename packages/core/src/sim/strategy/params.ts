import type { StandardSchema } from "../../scenario/validate";
import { typiaStandardSchema } from "../../scenario/validate";

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
  typiaStandardSchema<ScriptedStrategyParamsV1>();

export const GreedyStrategyParamsV1Schema: StandardSchema<GreedyStrategyParamsV1> =
  typiaStandardSchema<GreedyStrategyParamsV1>();

export const PlannerStrategyParamsV1Schema: StandardSchema<PlannerStrategyParamsV1> =
  typiaStandardSchema<PlannerStrategyParamsV1>();
