import { z } from "zod";
import { option } from "../../runtime/command";

/** Largest seed the uint32 RNG stream can represent without truncation. */
export const MAX_SEED = 0xffffffff;

/**
 * `--seed` accepts an unsigned 32-bit integer.
 * The RNG (`mulberry32`) reduces its seed with `>>> 0`, so a fractional,
 * negative, or larger value would be recorded in output metadata while the
 * run used a different stream. Rejecting those values keeps the recorded seed
 * equal to the seed that ran.
 */
export const seedSchema = z.coerce
  .number()
  .int({ message: "seed must be an integer" })
  .min(0, { message: "seed must be >= 0" })
  .max(MAX_SEED, { message: `seed must be <= ${MAX_SEED} (2^32 - 1)` });

export function seedOption(description: string) {
  return option(seedSchema.optional(), { description: `${description} (integer 0..${MAX_SEED})` });
}
