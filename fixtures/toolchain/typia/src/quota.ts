import typia from "typia";

export interface Quota {
  count: number;
}

export const validateQuota = typia.createValidate<Quota>();
