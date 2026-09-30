import typia, { type IValidation } from "typia";
import { standardSchemaFromValidate, type StandardSchema } from "./validate";

/**
 * Structural probe for the concrete typia call site.
 * This is not a scenario field and it does not replace ScenarioV1 validation.
 */
export type ConcreteQuota = {
  readonly count: number;
};

// The call stays inside the function so importing the core barrel does not
// run an untransformed typia factory. ttsc still rewrites this concrete call.
export const validateConcreteQuota = (input: unknown): IValidation<ConcreteQuota> =>
  typia.createValidate<ConcreteQuota>()(input);

export const concreteQuotaSchema: StandardSchema<ConcreteQuota> =
  standardSchemaFromValidate(validateConcreteQuota);
