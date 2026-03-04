import type { Engine } from "./types";

export type NumberEngineOptions = Readonly<{
  epsilon?: number;
}>;

export function createNumberEngine(opts?: NumberEngineOptions): Engine<number> {
  const epsilon = opts?.epsilon ?? 1e-12;

  return {
    zero: () => 0,
    from(input) {
      if (typeof input === "number") return input;
      if (typeof input === "string") return Number(input);
      return input;
    },
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, k) => a * k,
    div: (a, k) => a / k,
    mulN: (a, b) => a * b,
    divN: (a, b) => a / b,
    cmp(a, b) {
      const d = a - b;
      if (Math.abs(d) <= epsilon) return 0;
      return d < 0 ? -1 : 1;
    },
    absLog10(a) {
      const n = Math.abs(a);
      if (n === 0) return -Infinity;
      return Math.log10(n);
    },
    isFinite: (a) => Number.isFinite(a),
    toString: (a) => String(a),
    toNumber: (a) => a,
  };
}

export const breakInfinityEngine = createNumberEngine();
