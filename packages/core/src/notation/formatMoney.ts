import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import type { Suffixer } from "./suffixer";

export type FormatMoneyOptions = Readonly<{
  suffix?: Suffixer;
  significantDigits?: number;
  showUnit?: boolean;
  trimTrailingZeros?: boolean;
}>;

function alphaSuffix(index: number, minLen = 2): string {
  if (index <= 0) return "";
  let n = index - 1;
  let out = "";
  do {
    const r = n % 26;
    out = String.fromCharCode(97 + r) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  while (out.length < minLen) out = `a${out}`;
  return out;
}

function suffixAt(suffix: Suffixer | undefined, index: number): string {
  if (index <= 0) return "";
  if (!suffix) return alphaSuffix(index, 2);
  if (suffix.kind === "table") return suffix.table[index] ?? "";
  return alphaSuffix(index, suffix.minLen ?? 2);
}

function trimZeros(n: string): string {
  if (!n.includes(".")) return n;
  return n.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

export function formatMoney<N, U extends string>(
  E: Engine<N>,
  money: Money<N, U>,
  opts?: FormatMoneyOptions,
): string {
  const digits = opts?.significantDigits ?? 3;
  const showUnit = opts?.showUnit ?? true;
  const trim = opts?.trimTrailingZeros ?? true;

  const amount = money.amount;
  const absLog10 = E.absLog10(amount);
  const sign = E.cmp(amount, E.zero()) < 0 ? -1 : 1;

  if (!Number.isFinite(absLog10)) {
    const raw = E.toString(amount);
    return showUnit ? `${raw} ${money.unit.code}` : raw;
  }

  const group = Math.max(0, Math.floor(absLog10 / 3));
  const scale = E.from(`1e${group * 3}`);
  const mantissa = E.toNumber(E.divN(amount, scale));

  let left = Number.isFinite(mantissa)
    ? Math.abs(mantissa).toPrecision(digits)
    : Math.abs(E.toNumber(amount)).toPrecision(digits);

  if (trim) left = trimZeros(left);

  const suffix = suffixAt(opts?.suffix, group);
  const signed = sign < 0 && !left.startsWith("-") ? `-${left}` : left;
  const raw = `${signed}${suffix}`;

  return showUnit ? `${raw} ${money.unit.code}` : raw;
}
