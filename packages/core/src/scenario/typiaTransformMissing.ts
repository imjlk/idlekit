import type { StandardResult, StandardSchema } from "./validate";

export class TypiaTransformMissingError extends Error {
  constructor(cause: unknown) {
    super(
      "typia.validate<T>() was not transformed. Call typia.createValidate<Concrete>() at a concrete site and pass that function to standardSchemaFromValidate().",
      cause === undefined ? undefined : { cause },
    );
    this.name = "TypiaTransformMissingError";
  }
}

/**
 * @deprecated The pinned typia transform rejects `typia.validate<T>()` when `T` is not concrete
 * (`non-specified generic argument`). There are no in-repo callers. Use
 * `standardSchemaFromValidate` with `typia.createValidate<Concrete>()`.
 * Calling this helper throws {@link TypiaTransformMissingError} instead of reporting a user-input issue.
 *
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing This is the function that throws TypiaTransformMissingError for an unresolved type argument.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section and this body: validate throws TypiaTransformMissingError and does not return a failed user-input result.
 */
export function typiaStandardSchema<T>(): StandardSchema<T> {
  return {
    "~standard": {
      validate(_input: unknown): StandardResult<T> {
        throw new TypiaTransformMissingError(
          "typia.validate<T>() was not emitted because the type argument is not concrete",
        );
      },
    },
  };
}
