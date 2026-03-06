import { describe, expect, it } from "bun:test";
import { betterFromCmp, formatEtaLabel, toComparableEta } from "./compareEval";

describe("compare eval helpers", () => {
  it("maps comparison sign to scenario side", () => {
    expect(betterFromCmp(1)).toBe("a");
    expect(betterFromCmp(-1)).toBe("b");
    expect(betterFromCmp(0)).toBe("tie");
  });

  it("formats eta label consistently", () => {
    expect(formatEtaLabel(120, true)).toBe("120");
    expect(formatEtaLabel(Number.POSITIVE_INFINITY, true)).toBe("unreached");
    expect(formatEtaLabel(10, false)).toBe("unreached");
  });

  it("normalizes infinite eta with penalty", () => {
    expect(toComparableEta(undefined, 3600)).toBeUndefined();
    expect(toComparableEta(300, 3600)).toBe(300);
    expect(toComparableEta(Number.POSITIVE_INFINITY, 3600)).toBe(1_000_003_600);
  });
});
