import type { StandardSchema } from "../../../../scenario/validate";
import { zodStandardSchema } from "../../../../scenario/validate";
import { z } from "zod";

export type ObjectiveEmptyObject = Record<string, never>;
export const ObjectiveEmptyObjectSchema: StandardSchema<ObjectiveEmptyObject> = zodStandardSchema(
  z.object({}).strict(),
);

export type ObjectiveEtaToWorthParams = Readonly<{
  targetWorth: string;
  unreachedPenaltySec?: number;
}>;

export const ObjectiveEtaToWorthParamsSchema: StandardSchema<ObjectiveEtaToWorthParams> =
  zodStandardSchema(
    z.object({
      targetWorth: z.string().min(1),
      unreachedPenaltySec: z.number().positive().optional(),
    }),
  );

export type ObjectivePacingParams = Readonly<{
  targetActionsPerHour?: number;
  actionRateWeight?: number;
  droppedRateWeight?: number;
}>;

export const ObjectivePacingParamsSchema: StandardSchema<ObjectivePacingParams> =
  zodStandardSchema(
    z.object({
      targetActionsPerHour: z.number().positive().optional(),
      actionRateWeight: z.number().nonnegative().optional(),
      droppedRateWeight: z.number().nonnegative().optional(),
    }),
  );
