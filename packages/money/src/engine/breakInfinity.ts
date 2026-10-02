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

/** `String(1e21)` is `"1e+21"`. Settlement text needs one plain decimal exponent. */
function plainExponent(exponent: number): string {
  if (!Number.isFinite(exponent)) return String(exponent);
  const sign = exponent < 0 ? "-" : "";
  const magnitude = Math.abs(exponent);
  if (magnitude < 1e21) return `${sign}${String(magnitude)}`;
  const text = magnitude.toExponential();
  const match = /^(\d+)(?:\.(\d+))?e\+(\d+)$/.exec(text);
  if (!match?.[1] || !match[3]) return `${sign}${text}`;
  const fraction = match[2] ?? "";
  const zeros = Number(match[3]) - fraction.length;
  if (!Number.isInteger(zeros) || zeros < 0) return `${sign}${text}`;
  return `${sign}${match[1]}${fraction}${"0".repeat(zeros)}`;
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
    toString(value) {
      const text = value.toString();
      const underflow = (text === "0" || text === "-0") && value.mantissa !== 0;
      if (!underflow && text !== "Infinity" && text !== "-Infinity") return text;
      if (!decimalIsFinite(value)) return text;
      const sign = value.mantissa < 0 ? "-" : "";
      const digits = String(Math.abs(value.mantissa));
      return `${sign}${digits}e${plainExponent(value.exponent)}`;
    },
    toNumber: (a) => a.toNumber(),
  };
}

// Canonical break_infinity.js adapter.
export const breakInfinityEngine = createBreakInfinityEngine();

export { Decimal };
