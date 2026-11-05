import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { formatMoney } from "./formatMoney";
import { parseMoney } from "./parseMoney";
import { alphaInfiniteIndex, alphaInfiniteSuffix, type Suffixer } from "./suffixer";

const N = createNumberEngine();
const D = createBreakInfinityEngine();
const unit = { code: "COIN" as const };
const plain = { showUnit: false } as const;
const table: Suffixer = { kind: "table", table: ["", "K", "M"] };

describe("formatMoney boundaries", () => {
  it("carries a rounded mantissa into the next suffix group", () => {
    expect(formatMoney(N, { unit, amount: 999.9 }, plain)).toBe("1aa");
    expect(formatMoney(N, { unit, amount: 999_950 }, plain)).toBe("1ab");
    expect(formatMoney(D, { unit, amount: D.from(999_950) }, plain)).toBe("1ab");
    expect(formatMoney(N, { unit, amount: -999.9 }, plain)).toBe("-1aa");
    expect(formatMoney(N, { unit, amount: 999.4 }, plain)).toBe("999");
    expect(formatMoney(N, { unit, amount: 999.9 }, { ...plain, suffix: table })).toBe("1K");
  });

  it("keeps plain digits when significantDigits is smaller than the integer part", () => {
    expect(formatMoney(N, { unit, amount: 123 }, { ...plain, significantDigits: 1 })).toBe("100");
    expect(formatMoney(N, { unit, amount: 150 }, { ...plain, significantDigits: 2 })).toBe("150");
    expect(formatMoney(N, { unit, amount: 155 }, { ...plain, significantDigits: 2 })).toBe("160");
  });

  it("rejects significantDigits outside 1..100 or not an integer", () => {
    for (const significantDigits of [0, 101, 1.5, -1, Number.NaN, Infinity]) {
      expect(() => formatMoney(N, { unit, amount: 1 }, { significantDigits })).toThrow(
        /significantDigits must be an integer from 1 to 100/,
      );
    }
    expect(formatMoney(N, { unit, amount: 1 }, { ...plain, significantDigits: 1 })).toBe("1");
    expect(formatMoney(N, { unit, amount: 1 }, { ...plain, significantDigits: 100, trimTrailingZeros: false })).toBe(
      `1.${"0".repeat(99)}`,
    );
  });

  it("stays on the last table suffix instead of dropping the magnitude", () => {
    expect(formatMoney(N, { unit, amount: 1e12 }, { ...plain, suffix: table })).toBe("1000000M");
    expect(formatMoney(N, { unit, amount: 5e9 }, { ...plain, suffix: table })).toBe("5000M");
    expect(formatMoney(N, { unit, amount: -5e9 }, { ...plain, suffix: table })).toBe("-5000M");
    expect(formatMoney(N, { unit, amount: 1e30 }, { ...plain, suffix: table })).toBe("1e+24M");
    expect(formatMoney(N, { unit, amount: 5e6 }, { ...plain, suffix: table })).toBe("5M");
    expect(formatMoney(N, { unit, amount: 5e3 }, { ...plain, suffix: { kind: "table", table: [""] } })).toBe("5000");
  });

  it("keeps the sign of tiny negative values and trims their exponent form", () => {
    expect(formatMoney(N, { unit, amount: -1e-13 }, plain)).toBe("-1e-13");
    expect(formatMoney(N, { unit, amount: 1e-7 }, plain)).toBe("1e-7");
    expect(formatMoney(N, { unit, amount: 1.5e-7 }, plain)).toBe("1.5e-7");
    expect(formatMoney(N, { unit, amount: 1e-7 }, { ...plain, trimTrailingZeros: false })).toBe("1.00e-7");
    expect(formatMoney(N, { unit, amount: 0.5 }, plain)).toBe("0.5");
    expect(formatMoney(N, { unit, amount: -0 }, plain)).toBe("0");
  });

  it("passes non-finite values through as text", () => {
    expect(formatMoney(N, { unit, amount: Infinity })).toBe("Infinity COIN");
    expect(formatMoney(N, { unit, amount: -Infinity }, plain)).toBe("-Infinity");
    expect(formatMoney(N, { unit, amount: Number.NaN }, plain)).toBe("NaN");
    expect(formatMoney(N, { unit, amount: 0 }, plain)).toBe("0");
  });

  it("formats the edges of the double range and far beyond it on the Decimal engine", () => {
    expect(formatMoney(N, { unit, amount: Number.MAX_VALUE }, plain)).toBe(`180${alphaInfiniteSuffix(102, 2)}`);
    expect(formatMoney(N, { unit, amount: Number.MIN_VALUE }, plain)).toBe("4.94e-324");
    expect(formatMoney(D, { unit, amount: D.from("1e1000") }, plain)).toBe(`10${alphaInfiniteSuffix(333, 2)}`);
    expect(formatMoney(D, { unit, amount: D.from("-1e1000") }, plain)).toBe(`-10${alphaInfiniteSuffix(333, 2)}`);
  });
});

describe("parseMoney boundaries", () => {
  it("returns the engine's own overflow and underflow values, which callers check with isFinite", () => {
    // Core ETA and compare fail closed on a non-finite target, so parse does not throw here.
    expect(parseMoney(N, "1e400", { unit }).amount).toBe(Infinity);
    expect(parseMoney(N, "-1e400", { unit }).amount).toBe(-Infinity);
    expect(N.isFinite(parseMoney(N, "1e300zz", { unit }).amount)).toBeFalse();
    expect(D.toString(parseMoney(D, "1e400", { unit }).amount)).toBe("1e+400");
    expect(parseMoney(N, "1e-400", { unit }).amount).toBe(0);
    expect(parseMoney(N, "1.7976931348623157e308", { unit }).amount).toBe(Number.MAX_VALUE);
  });

  it("rejects locale separators, other digit systems, and loose numeric spellings", () => {
    for (const text of ["1,000", "1.000,5", "１２３", "1_000", "0x10", "5.", "NaN", "Infinity", "", "  ", "--1", "1e"]) {
      expect(() => parseMoney(N, text, { unit })).toThrow();
    }
    expect(() => parseMoney(N, "1 000", { unit })).toThrow(/Unit in string is not allowed/);
  });

  it("accepts the documented numeric forms", () => {
    expect(parseMoney(N, "+1.5", { unit }).amount).toBe(1.5);
    expect(parseMoney(N, ".5", { unit }).amount).toBe(0.5);
    expect(parseMoney(N, "-0", { unit }).amount).toBe(-0);
    expect(parseMoney(N, "  2E3  ", { unit }).amount).toBe(2000);
  });

  it("prefers an exact table suffix over a case-insensitive one", () => {
    const suffix: Suffixer = { kind: "table", table: ["", "K", "k"] };
    expect(parseMoney(N, "1k", { unit, suffix }).amount).toBe(1e6);
    expect(parseMoney(N, "1K", { unit, suffix }).amount).toBe(1e3);
    expect(parseMoney(N, "1m", { unit, suffix: table }).amount).toBe(1e6);
  });

  it("round-trips format output for values that do not lose digits", () => {
    for (const amount of [0, 1, 999, 1000, 12_300, 4.56e15, -7.89e40, 1e100]) {
      const text = formatMoney(N, { unit, amount }, { ...plain, significantDigits: 3 });
      expect(parseMoney(N, text, { unit }).amount).toBeCloseTo(amount, -Math.floor(Math.log10(Math.abs(amount) || 1)) + 2);
    }
  });
});

describe("alphaInfinite suffix boundaries", () => {
  it("round-trips index and suffix across rollovers", () => {
    for (let index = 1; index <= 30_000; index += 1) {
      expect(alphaInfiniteIndex(alphaInfiniteSuffix(index, 2), 2)).toBe(index);
    }
  });
});
