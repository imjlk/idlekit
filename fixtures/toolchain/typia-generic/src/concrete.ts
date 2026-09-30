import typia from "typia";

interface Quota {
  count: number;
}

export const validateQuota = typia.createValidate<Quota>();
