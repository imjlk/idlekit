import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { alphaInfiniteSuffix, type Suffixer } from "./suffixer";

export type FormatMoneyOptions = Readonly<{
  suffix?: Suffixer;
  /** Significant digits of the mantissa. An integer from 1 to 100. Defaults to 3. */
  significantDigits?: number;
  showUnit?: boolean;
  trimTrailingZeros?: boolean;
}>;

/** Highest group index the suffixer can name, or `Infinity` when it never runs out. */
function maxSuffixGroup(suffix: Suffixer | undefined): number {
  if (suffix?.kind !== "table") return Infinity;
  return Math.max(0, suffix.table.length - 1);
}

function suffixAt(suffix: Suffixer | undefined, index: number): string {
  if (index <= 0) return "";
  if (!suffix) return alphaInfiniteSuffix(index, 2);
  if (suffix.kind === "table") return suffix.table[index] ?? "";
  return alphaInfiniteSuffix(index, suffix.minLen ?? 2);
}

/** Trim zeros of the fraction only, keeping any exponent part (`1.50e-7` -> `1.5e-7`). */
function trimZeros(n: string): string {
  const e = n.search(/e/i);
  const head = e < 0 ? n : n.slice(0, e);
  const tail = e < 0 ? "" : n.slice(e);
  if (!head.includes(".")) return n;
  return head.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1") + tail;
}

function assertSignificantDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 1 || digits > 100) {
    throw new RangeError(`significantDigits must be an integer from 1 to 100 (received: ${digits})`);
  }
}

/**
 * Round a non-negative mantissa to `digits` significant digits without switching to exponent
 * notation when the value is at least 1. `toPrecision` alone renders `150` with 2 digits as
 * `1.5e+2`; numbers below 1 keep `toPrecision` output because there is no suffix to absorb them.
 */
function roundMantissa(abs: number, digits: number): string {
  const text = abs.toPrecision(digits);
  if (!/e\+/i.test(text)) return text;
  const rounded = Number(text);
  return rounded < 1e21 ? String(rounded) : text;
}

export function formatMoney<N, U extends string>(
  E: Engine<N>,
  money: Money<N, U>,
  opts?: FormatMoneyOptions,
): string {
  const digits = opts?.significantDigits ?? 3;
  assertSignificantDigits(digits);
  const showUnit = opts?.showUnit ?? true;
  const trim = opts?.trimTrailingZeros ?? true;

  const amount = money.amount;
  const absLog10 = E.absLog10(amount);

  if (!Number.isFinite(absLog10)) {
    const raw = E.toString(amount);
    return showUnit ? `${raw} ${money.unit.code}` : raw;
  }

  // The sign comes from the value itself, not from `cmp`, whose tolerance would print -1e-13 as 1e-13.
  const negative = E.toString(amount).startsWith("-");
  const maxGroup = maxSuffixGroup(opts?.suffix);

  const render = (group: number): string => {
    const scale = E.from(`1e${group * 3}`);
    const mantissa = E.toNumber(E.divN(amount, scale));
    const abs = Number.isFinite(mantissa) ? Math.abs(mantissa) : Math.abs(E.toNumber(amount));
    return roundMantissa(abs, digits);
  };

  let group = Math.min(maxGroup, Math.max(0, Math.floor(absLog10 / 3)));
  let left = render(group);
  // Rounding can carry into the next group: 999.95 with 3 digits is 1.00e+3, which is 1.00 of the next suffix.
  if (group < maxGroup && Number(left) >= 1000) {
    group += 1;
    left = render(group);
  }

  if (trim) left = trimZeros(left);

  const suffix = suffixAt(opts?.suffix, group);
  // A magnitude that rounds to zero prints without a sign.
  const signed = negative && Number(left) !== 0 && !left.startsWith("-") ? `-${left}` : left;
  const raw = `${signed}${suffix}`;

  return showUnit ? `${raw} ${money.unit.code}` : raw;
}
