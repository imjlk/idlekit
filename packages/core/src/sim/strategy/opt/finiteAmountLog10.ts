import type { Engine } from "../../../engine/types";

/** Zero's historical tuning score. No finite amount scores below it. */
export const ZERO_AMOUNT_LOG10_FLOOR = -300;

/**
 * Tuning score of a monetary amount: log10 of its magnitude, never below the zero floor, and never a score for an
 * invalid amount. A positive amount smaller than 1e-300, such as a Number subnormal or a breakInfinity `1e-400`,
 * scores at the floor with zero instead of below it, so zero never outranks a positive amount.
 * The score reads magnitude only: a negative amount scores as its absolute value, as `absLog10` defines.
 */
export function finiteAmountLog10<N>(E: Pick<Engine<N>, "isFinite" | "absLog10">, amount: N): number {
  if (!E.isFinite(amount)) throw new RangeError("Tuning requires finite monetary amounts in the selected engine");
  const value = E.absLog10(amount);
  if (value === Number.NEGATIVE_INFINITY) return ZERO_AMOUNT_LOG10_FLOOR;
  if (!Number.isFinite(value)) throw new RangeError("Tuning requires a finite monetary logarithm");
  return Math.max(ZERO_AMOUNT_LOG10_FLOOR, value);
}
