import type { StandardSchema } from "../../../../scenario/validate";
import { typiaStandardSchema } from "../../../../scenario/validate";

export type ObjectiveEmptyObject = Record<string, never>;
export const ObjectiveEmptyObjectSchema: StandardSchema<ObjectiveEmptyObject> = typiaStandardSchema<ObjectiveEmptyObject>();
