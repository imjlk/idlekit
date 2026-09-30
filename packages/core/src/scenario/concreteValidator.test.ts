import { describe, expect, it } from "bun:test";
import {
  concreteQuotaSchema,
  validateConcreteQuota,
} from "./concreteValidator";
import {
  standardSchemaFromValidate,
  TypiaTransformMissingError,
  typiaStandardSchema,
} from "./validate";

/**
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing Accepts count 2 and rejects a string count through the concrete validator and its schema adapter.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section, then ran both inputs: count 2 succeeds and the string count is rejected.
 * @evidence ./concreteValidator.ts#validateConcreteQuota Calls validateConcreteQuota for count 2 and for a string count.
 * @evidenceReview ./concreteValidator.ts#validateConcreteQuota #3dda434 Re-read the arrow: it still calls typia.createValidate of ConcreteQuota when invoked, and this test fails if either input is classified wrong.
 * @evidence ./concreteValidator.ts#concreteQuotaSchema Checks the Standard Schema adapter on the same two inputs.
 * @evidenceReview ./concreteValidator.ts#concreteQuotaSchema #65e8e9e The adapter is standardSchemaFromValidate of validateConcreteQuota. Both results are asserted here.
 * @evidence ./concreteValidator.ts#ConcreteQuota.count Reads the accepted count field named by the ConcreteQuota type.
 * @evidenceReview ./concreteValidator.ts#ConcreteQuota.count #e5d9ed6 accepted.data.count is 2 when the input count is 2. The field is the numeric count on ConcreteQuota.
 */
export function acceptsNumericConcreteQuota(): void {
  const accepted = validateConcreteQuota({ count: 2 });
  const rejected = validateConcreteQuota({ count: "no" });
  expect(accepted.success).toBe(true);
  if (accepted.success) expect(accepted.data.count).toBe(2);
  expect(rejected.success).toBe(false);

  const schemaAccepted = concreteQuotaSchema["~standard"].validate({ count: 2 });
  const schemaRejected = concreteQuotaSchema["~standard"].validate({ count: "no" });
  expect(schemaAccepted.success).toBe(true);
  expect(schemaRejected.success).toBe(false);
}

describe("concrete typia validator", () => {
  it("accepts a numeric count and rejects a string count", acceptsNumericConcreteQuota);

  it("adapts a caller-supplied validator without casting away the result", () => {
    const schema = standardSchemaFromValidate<{ count: number }>((input) => {
      if (typeof input === "object" && input !== null && "count" in input && typeof input.count === "number") {
        return { success: true, data: { count: input.count } };
      }
      return {
        success: false,
        data: input,
        errors: [{ path: "$input.count", expected: "number", value: input }],
      };
    });
    expect(schema["~standard"].validate({ count: 1 }).success).toBe(true);
    expect(schema["~standard"].validate({ count: "no" }).success).toBe(false);
  });

  it("does not report a missing generic transform as a user input error", rejectsUnresolvedGenericAsUserInput);
});

/**
 * @evidence docs/requirements/active/typia-transform.md#req-typia-transform-missing Throws TypiaTransformMissingError instead of reporting a user-input issue.
 * @evidenceReview docs/requirements/active/typia-transform.md#req-typia-transform-missing #1e5e1ef Re-read the section and ran this test: count 2 throws TypiaTransformMissingError rather than a failed user-input result.
 * @evidence ./typiaTransformMissing.ts#typiaStandardSchema Calls typiaStandardSchema for an unresolved type argument.
 * @evidenceReview ./typiaTransformMissing.ts#typiaStandardSchema #c09164c Re-read the function: its validate method throws TypiaTransformMissingError and does not return issues.
 */
export function rejectsUnresolvedGenericAsUserInput(): void {
  const schema = typiaStandardSchema<{ count: number }>();
  expect(() => schema["~standard"].validate({ count: 2 })).toThrow(TypiaTransformMissingError);
}
