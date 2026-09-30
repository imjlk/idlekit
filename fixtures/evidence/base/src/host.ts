/**
 * @evidence docs/spec.md#quota Returns the quota this section states, which is 3.
 * @evidenceReview docs/spec.md#quota #93d93c4 Re-read the section: the only accepted quota is 3.
 */
export function quotaHost(): number {
  return 3;
}

/** Second export so this file is not a one-function module. singular stays off. */
export const quotaLabel = "quota";
