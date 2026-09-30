import typia from "typia";
import { standardSchemaFromValidate, type StandardSchema } from "./validate";

/**
 * Structural probe for the concrete typia call site.
 * This is not a scenario field and it does not replace ScenarioV1 validation.
 */
export type ConcreteQuota = {
  readonly count: number;
};

export const validateConcreteQuota = typia.createValidate<ConcreteQuota>();

export const concreteQuotaSchema: StandardSchema<ConcreteQuota> =
  standardSchemaFromValidate(validateConcreteQuota);
