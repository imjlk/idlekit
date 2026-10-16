import { createValidate } from "typia";

export const validateNamed = createValidate<{ count: number }>();
if (!validateNamed({ count: 42 }).success || validateNamed({ count: "invalid" }).success) {
  throw new Error("named factory validator does not validate the concrete type");
}
console.log("named-probe-ok");
