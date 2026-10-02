import { expect, test } from "bun:test";
import { quotaHost, quotaLabel } from "./host";

/**
 * @evidence docs/spec.md#quota Executed check that quotaHost returns 3 and the label is quota.
 * @evidenceReview docs/spec.md#quota #93d93c4 Ran quotaHost and quotaLabel against the section's quota of 3.
 * @evidence ./host.ts#quotaHost Calls quotaHost and expects 3.
 * @evidenceReview ./host.ts#quotaHost #e206d74 The function returns 3. This test fails if it does not.
 * @evidence ./host.ts#quotaLabel Reads the label exported beside quotaHost.
 * @evidenceReview ./host.ts#quotaLabel #0f47c10 quotaLabel is the string quota. This test expects that string.
 */
export function quotaIsDocumented(): void {
  expect(quotaHost()).toBe(3);
  expect(quotaLabel).toBe("quota");
}

test("quota is documented", quotaIsDocumented);
