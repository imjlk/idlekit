import type { Engine } from "../../engine/types";

export function computeLogGap<N>(E: Engine<N>, base: N, delta: N): number {
  const zero = E.zero();
  if (E.cmp(base, zero) <= 0) return -Infinity;
  if (E.cmp(delta, zero) === 0) return Infinity;
  return E.absLog10(base) - E.absLog10(delta);
}

export function isTooSmall<N>(E: Engine<N>, base: N, delta: N, maxLogGap?: number): boolean {
  if (maxLogGap === undefined) return false;
  const gap = computeLogGap(E, base, delta);
  return Number.isFinite(gap) && gap > maxLogGap;
}
