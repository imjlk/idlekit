import type { Engine } from "../engine/types";
import type { Money, Unit } from "../money/types";
import { alphaInfiniteIndex, type Suffixer } from "./suffixer";

export type ParseMoneyOptions<U extends string> = Readonly<{
  suffix?: Suffixer;
  unit?: Unit<U>;
  allowUnitInString?: boolean;
}>;

function parseSuffixIndex(token: string | undefined, suffix: Suffixer | undefined): number {
  if (!token) return 0;

  if (!suffix) {
    return alphaInfiniteIndex(token, 2);
  }

  if (suffix.kind === "table") {
    const idx = suffix.table.findIndex((x) => x.toLowerCase() === token.toLowerCase());
    return idx >= 0 ? idx : -1;
  }

  return alphaInfiniteIndex(token, suffix.minLen ?? 2);
}

export function parseMoney<N, U extends string>(
  E: Engine<N>,
  input: string,
  opts: ParseMoneyOptions<U>,
): Money<N, U> {
  const text = input.trim();

  const m = text.match(
    /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*([A-Za-z]+)?(?:\s+([A-Za-z][A-Za-z0-9_]*))?$/i,
  );

  if (!m) throw new Error(`Invalid money string: ${input}`);

  const numeric = m[1];
  if (!numeric) throw new Error(`Invalid numeric part: ${input}`);
  const suffixToken = m[2];
  const inlineUnit = m[3] as U | undefined;

  if (inlineUnit && !opts.allowUnitInString) {
    throw new Error("Unit in string is not allowed. Set allowUnitInString=true.");
  }

  const suffixIndex = parseSuffixIndex(suffixToken, opts.suffix);
  if (suffixToken && suffixIndex < 0) {
    throw new Error(`Unknown suffix: ${suffixToken}`);
  }

  const exp3 = suffixIndex * 3;
  const scaled = exp3 > 0 ? E.mulN(E.from(numeric), E.from(`1e${exp3}`)) : E.from(numeric);

  const unit = opts.unit ?? (inlineUnit ? ({ code: inlineUnit } as Unit<U>) : undefined);
  if (!unit) {
    throw new Error("Unit is required. Provide opts.unit or unit in input string.");
  }

  if (inlineUnit && unit.code !== inlineUnit) {
    throw new Error(`Unit mismatch: expected ${unit.code}, got ${inlineUnit}`);
  }

  return {
    unit,
    amount: scaled,
  };
}
