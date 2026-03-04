import type { StandardSchema } from "../../../../scenario/validate";
import { typiaStandardSchema } from "../../../../scenario/validate";

export type ObjectiveEmptyObject = Record<string, never>;
export const ObjectiveEmptyObjectSchema: StandardSchema<ObjectiveEmptyObject> = typiaStandardSchema<ObjectiveEmptyObject>();

export type ObjectiveEtaToWorthParams = Readonly<{
  targetWorth: string;
  unreachedPenaltySec?: number;
}>;

export const ObjectiveEtaToWorthParamsSchema: StandardSchema<ObjectiveEtaToWorthParams> =
  typiaStandardSchema<ObjectiveEtaToWorthParams>();

export type ObjectivePacingParams = Readonly<{
  targetActionsPerHour?: number;
  actionRateWeight?: number;
  droppedRateWeight?: number;
}>;

export const ObjectivePacingParamsSchema: StandardSchema<ObjectivePacingParams> =
  typiaStandardSchema<ObjectivePacingParams>();
