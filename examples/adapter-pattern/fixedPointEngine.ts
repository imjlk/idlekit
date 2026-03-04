import type { Engine } from "../../packages/core/src/engine/types";

const SCALE_DIGITS = 6;
const SCALE = 1_000_000n;

type Fixed = bigint;

function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  return 10n ** BigInt(n);
}

function parseFixed(text: string): Fixed {
  const s = text.trim();
  const m = s.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!m) throw new Error(`Invalid decimal: ${text}`);

  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? "";
  const exp = Number(m[4] ?? "0");

  const coeff = BigInt(`${intPart}${fracPart}`);
  const exp10 = exp - fracPart.length;

  let scaled: bigint;
  if (exp10 >= 0) {
    scaled = coeff * pow10(exp10) * SCALE;
  } else {
    const divider = pow10(-exp10);
    scaled = (coeff * SCALE) / divider;
  }

  return sign * scaled;
}

function fixedToString(v: Fixed): string {
  const sign = v < 0n ? "-" : "";
  const x = v < 0n ? -v : v;
  const intPart = x / SCALE;
  const fracPart = x % SCALE;

  if (fracPart === 0n) return `${sign}${intPart}`;

  const rawFrac = fracPart.toString().padStart(SCALE_DIGITS, "0");
  const trimmed = rawFrac.replace(/0+$/, "");
  return `${sign}${intPart}.${trimmed}`;
}

function fixedToNumber(v: Fixed): number {
  return Number(v) / Number(SCALE);
}

function absLog10(v: Fixed): number {
  const x = v < 0n ? -v : v;
  if (x === 0n) return Number.NEGATIVE_INFINITY;

  const digits = x.toString();
  const leadLen = Math.min(15, digits.length);
  const lead = Number(digits.slice(0, leadLen));
  const log10Int = (digits.length - leadLen) + Math.log10(lead);
  return log10Int - SCALE_DIGITS;
}

export function fp(input: string | number | bigint): bigint {
  if (typeof input === "bigint") return input;
  if (typeof input === "number") return parseFixed(String(input));
  return parseFixed(input);
}

export function createFixedPointEngine(): Engine<Fixed> {
  return {
    zero: () => 0n,
    from(input) {
      if (typeof input === "bigint") return input;
      if (typeof input === "number") return fp(input);
      return fp(input);
    },
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul(a, k) {
      return fp(fixedToNumber(a) * k);
    },
    div(a, k) {
      return fp(fixedToNumber(a) / k);
    },
    mulN(a, b) {
      return (a * b) / SCALE;
    },
    divN(a, b) {
      if (b === 0n) throw new Error("division by zero");
      return (a * SCALE) / b;
    },
    cmp(a, b) {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    },
    absLog10,
    isFinite: () => true,
    toString: fixedToString,
    toNumber: fixedToNumber,
  };
}
