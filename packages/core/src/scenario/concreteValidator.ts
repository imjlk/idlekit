import typia, { type IValidation } from "typia";
import { standardSchemaFromValidate, type StandardSchema } from "./validate";

/**
 * Structural probe for the concrete typia call site.
 * This is not a scenario field and it does not replace ScenarioV1 validation.
 */
export type ConcreteQuota = {
  readonly count: number;
};

/**
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing Generates the validator at a concrete ConcreteQuota site so an unresolved generic is not reported as bad user input.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section and this declaration: the call is typia.createValidate of ConcreteQuota, and the section's string count is not a Standard Schema issue from this function.
 */
// The call stays inside the function so importing the core barrel does not
// run an untransformed typia factory. ttsc still rewrites this concrete call.
export const validateConcreteQuota = (input: unknown): IValidation<ConcreteQuota> =>
  typia.createValidate<ConcreteQuota>()(input);

/** Adapts validateConcreteQuota without parsing the requirement a second time. */
export const concreteQuotaSchema: StandardSchema<ConcreteQuota> =
  standardSchemaFromValidate(validateConcreteQuota);
