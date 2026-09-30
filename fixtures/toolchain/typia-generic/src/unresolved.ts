import typia from "typia";

export function validateUnresolved<T>(input: unknown) {
  return typia.validate<T>(input);
}
