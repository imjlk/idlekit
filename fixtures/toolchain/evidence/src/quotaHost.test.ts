import { expect, test } from "bun:test";
import { quotaHost } from "./quotaHost";

/**
 * @evidence docs/quota.md#quota Executed check that quotaHost returns the documented quota.
 */
export function quotaIsDocumented(): void {
  expect(quotaHost()).toBe(3);
}

test("quota is documented", quotaIsDocumented);
