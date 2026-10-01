import type { IValidation } from "typia";

export type StandardIssue = Readonly<{
  path?: string;
  message: string;
  expected?: string;
  value?: unknown;
}>;

export type StandardResult<T> =
  | Readonly<{ success: true; value: T }>
  | Readonly<{ success: false; issues: StandardIssue[] }>;

export type StandardSchema<T> = Readonly<{
  "~standard": Readonly<{
    validate: (input: unknown) => StandardResult<T>;
  }>;
}>;

function issuesFromTypiaErrors(errors: readonly IValidation.IError[]): StandardIssue[] {
  return errors.map((err) => ({
    path: err.path,
    message: err.description ?? `Expected ${err.expected}`,
    expected: err.expected,
    value: err.value,
  }));
}

/**
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing Turns a concrete validator result into a Standard Schema result.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section and this function: success keeps data, and failure copies typia path, expected, and value into issues.
 */
export function standardResultFromValidation<T>(validated: IValidation<T>): StandardResult<T> {
  if (validated.success) {
    return { success: true, value: validated.data };
  }
  return { success: false, issues: issuesFromTypiaErrors(validated.errors) };
}

/**
 * Adapts a validator that was generated at a concrete call site.
 * `typia.createValidate<Concrete>()` is the supported generator. An unresolved
 * `typia.validate<T>()` inside {@link typiaStandardSchema} is not.
 *
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing Adapts validateConcreteQuota through standardSchemaFromValidate.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section and this function: the returned validate method calls standardResultFromValidation.
 */
export function standardSchemaFromValidate<T>(
  validate: (input: unknown) => IValidation<T>,
): StandardSchema<T> {
  return {
    "~standard": {
      validate(input) {
        return standardResultFromValidation(validate(input));
      },
    },
  };
}
