import type { Engine } from "./types";
import Decimal from "break_infinity.js";
import type { DecimalSource } from "break_infinity.js";

export type NumberEngineOptions = Readonly<{
  epsilon?: number;
}>;

export type BreakInfinityEngineOptions = Readonly<{
  epsilon?: DecimalSource;
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

function toDecimal(input: DecimalSource | Decimal): Decimal {
  return input instanceof Decimal ? input : new Decimal(input);
}

function decimalIsFinite(value: Decimal): boolean {
  return Number.isFinite(value.mantissa) && Number.isFinite(value.exponent);
}

export function createBreakInfinityEngine(opts?: BreakInfinityEngineOptions): Engine<Decimal> {
  const epsilon = toDecimal(opts?.epsilon ?? "1e-12");

  return {
    zero: () => new Decimal(0),
    from(input) {
      return toDecimal(input);
    },
    add: (a, b) => a.add(b),
    sub: (a, b) => a.sub(b),
    mul: (a, k) => a.mul(k),
    div: (a, k) => a.div(k),
    mulN: (a, b) => a.mul(b),
    divN: (a, b) => a.div(b),
    cmp(a, b) {
      const d = a.sub(b);
      if (d.abs().lte(epsilon)) return 0;
      return d.lt(0) ? -1 : 1;
    },
    absLog10(a) {
      if (a.eq(0)) return -Infinity;
      return a.absLog10();
    },
    isFinite: decimalIsFinite,
    toString: (a) => a.toString(),
    toNumber: (a) => a.toNumber(),
  };
}

// Canonical break_infinity.js adapter.
export const breakInfinityEngine = createBreakInfinityEngine();

export { Decimal };
