import { describe, expect, it } from "bun:test";
import { Decimal, breakInfinityEngine, createBreakInfinityEngine, createNumberEngine } from "./breakInfinity";

describe("breakInfinity engine adapters", () => {
  it("supports huge values without Number overflow", () => {
    const E = createBreakInfinityEngine();
    const huge = E.from("1e100000");

    expect(E.isFinite(huge)).toBeTrue();
    expect(E.toNumber(huge)).toBe(Infinity);
    expect(E.toString(huge)).toMatch(/e\+?100000/);
  });

  it("compares using decimal epsilon", () => {
    const E = createBreakInfinityEngine({ epsilon: "1e-6" });
    const a = E.from("1");
    const b = E.from("1.0000004");
    expect(E.cmp(a, b)).toBe(0);
  });

  it("exports a canonical breakInfinityEngine instance", () => {
    const out = breakInfinityEngine.add(new Decimal(2), new Decimal(3));
    expect(out.toString()).toBe("5");
  });

  it("keeps lightweight number engine for tests/small-scale use", () => {
    const E = createNumberEngine();
    expect(E.add(1, 2)).toBe(3);
    expect(E.cmp(1, 1 + 1e-13)).toBe(0);
  });
});
