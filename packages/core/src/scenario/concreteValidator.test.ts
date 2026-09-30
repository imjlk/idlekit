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

describe("concrete typia validator", () => {
  it("accepts a numeric count and rejects a string count", () => {
    const accepted = validateConcreteQuota({ count: 2 });
    const rejected = validateConcreteQuota({ count: "no" });
    expect(accepted.success).toBe(true);
    if (accepted.success) expect(accepted.data.count).toBe(2);
    expect(rejected.success).toBe(false);

    const schemaAccepted = concreteQuotaSchema["~standard"].validate({ count: 2 });
    const schemaRejected = concreteQuotaSchema["~standard"].validate({ count: "no" });
    expect(schemaAccepted.success).toBe(true);
    expect(schemaRejected.success).toBe(false);
  });

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

  it("does not report a missing generic transform as a user input error", () => {
    const schema = typiaStandardSchema<{ count: number }>();
    expect(() => schema["~standard"].validate({ count: 2 })).toThrow(TypiaTransformMissingError);
  });
});
