import { describe, expect, it } from "bun:test";
import { displayDecimal, displayDecimals } from "./displayNumber";
import { renderOutput } from "./writeOutput";

describe("display decimal policy", () => {
  it("rounds float residue in plain decimal strings and numbers", () => {
    expect(displayDecimal("214545.80000000002")).toBe("214545.8");
    expect(displayDecimal("81276.59999999998")).toBe("81276.6");
    expect(displayDecimal(0.1 + 0.2)).toBe(0.3);
    expect(displayDecimal("-0.30000000000000004")).toBe("-0.3");
  });

  it("leaves integers, short decimals, exponent text, and non-numeric strings unchanged", () => {
    for (const value of ["0", "1200", "0.5", "3198.25", "1.5e300", "1e+21", "Infinity", "NaN", "1.4.0", "simulate-r5vghb", "8b49edd0"]) {
      expect(displayDecimal(value)).toBe(value);
    }
    expect(displayDecimal(42)).toBe(42);
    expect(displayDecimal(null)).toBe(null);
    expect(displayDecimal(true)).toBe(true);
  });

  it("walks nested values", () => {
    expect(displayDecimals({ a: ["214545.80000000002", { b: 0.1 + 0.2 }], c: "x" })).toEqual({ a: ["214545.8", { b: 0.3 }], c: "x" });
  });

  it("applies to markdown only; json and csv stay lossless", () => {
    const rows = [{ horizon: "7d", endNetWorth: "214545.80000000002" }];
    expect(renderOutput("md", rows)).toContain("| 7d | 214545.8 |");
    expect(renderOutput("json", rows)).toContain("214545.80000000002");
    expect(renderOutput("csv", rows)).toContain("214545.80000000002");
  });
});
