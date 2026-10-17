/** Finite metrics retain numbers; monetary metrics may retain bounded decimal text. */
export type PacingValue = number | string;
const MAX_DECIMAL_LENGTH = 200;
const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

export function pacingValue(value: unknown): PacingValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined;
  return typeof value === "string" && value.length <= MAX_DECIMAL_LENGTH && DECIMAL.test(value) ? value : undefined;
}

function parts(value: PacingValue) {
  if (pacingValue(value) === undefined) throw new RangeError("Pacing value must be finite or bounded decimal text");
  const match = DECIMAL.exec(String(value))!;
  const fraction = match[3] ?? match[4] ?? "";
  const digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/, "");
  const sign = digits.length === 0 ? 0 : match[1] === "-" ? -1 : 1;
  return { sign, digits: digits.replace(/0+$/, ""),
    magnitude: BigInt(match[5] ?? "0") - BigInt(fraction.length) + BigInt(digits.length) };
}

/** Exact ordering of the reported decimal spellings; never expands a power of ten. */
export function comparePacingValues(left: PacingValue, right: PacingValue): number {
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
  const a = parts(left), b = parts(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  if (a.magnitude !== b.magnitude) return (a.magnitude < b.magnitude ? -1 : 1) * a.sign;
  const length = Math.max(a.digits.length, b.digits.length);
  const ad = a.digits.padEnd(length, "0"), bd = b.digits.padEnd(length, "0");
  return (ad < bd ? -1 : ad > bd ? 1 : 0) * a.sign;
}
