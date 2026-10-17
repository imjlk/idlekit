import type { Engine } from "../../../engine/types";

/** Keep zero's historical scoring floor, but never turn an invalid amount into a score. */
export function finiteAmountLog10<N>(E: Pick<Engine<N>, "isFinite" | "absLog10">, amount: N): number {
  if (!E.isFinite(amount)) throw new RangeError("Tuning requires finite monetary amounts in the selected engine");
  const value = E.absLog10(amount);
  if (value === Number.NEGATIVE_INFINITY) return -300;
  if (!Number.isFinite(value)) throw new RangeError("Tuning requires a finite monetary logarithm");
  return value;
}
