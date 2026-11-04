import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "./breakInfinity";

const N = createNumberEngine();
const D = createBreakInfinityEngine();

describe("number engine boundaries", () => {
  it("rejects blank and non-numeric strings instead of loading 0 or NaN", () => {
    for (const text of ["", " ", "\n", "abc", "1abc", "1,000"]) {
      expect(() => N.from(text)).toThrow(/Invalid number string/);
    }
  });

  it("still reads every string its own toString writes", () => {
    for (const value of [0, 1.5, -2e-300, Number.MAX_VALUE, Number.MIN_VALUE, Infinity, -Infinity, Number.NaN]) {
      expect(Object.is(N.from(N.toString(value)), value)).toBeTrue();
    }
  });

  it("compares equal infinities as equal", () => {
    expect(N.cmp(Infinity, Infinity)).toBe(0);
    expect(N.cmp(-Infinity, -Infinity)).toBe(0);
    expect(N.cmp(Infinity, -Infinity)).toBe(1);
    expect(N.cmp(-Infinity, Infinity)).toBe(-1);
    expect(N.cmp(Infinity, Number.MAX_VALUE)).toBe(1);
  });

  it("documents that cmp has no unordered result for NaN, so callers guard with isFinite", () => {
    // The two engines disagree on NaN; neither answer is meaningful.
    expect(N.cmp(Number.NaN, 0)).toBe(1);
    expect(N.cmp(0, Number.NaN)).toBe(1);
    expect(D.cmp(D.from(Number.NaN), D.zero())).toBe(0);
    expect(N.isFinite(Number.NaN)).toBeFalse();
    expect(D.isFinite(D.from(Number.NaN))).toBeFalse();
  });

  it("treats values within epsilon as equal, including around zero", () => {
    expect(N.cmp(1e-13, -1e-13)).toBe(0);
    expect(N.cmp(0.1 + 0.2, 0.3)).toBe(0);
    expect(createNumberEngine({ epsilon: 0 }).cmp(0.1 + 0.2, 0.3)).toBe(1);
  });

  it("reports magnitude for zero, subnormals, and the top of the range", () => {
    expect(N.absLog10(0)).toBe(-Infinity);
    expect(N.absLog10(-0)).toBe(-Infinity);
    expect(N.absLog10(Number.MIN_VALUE)).toBeCloseTo(-323.3, 1);
    expect(N.absLog10(-Number.MAX_VALUE)).toBeCloseTo(308.25, 2);
    expect(N.absLog10(Infinity)).toBe(Infinity);
    expect(Number.isNaN(N.absLog10(Number.NaN))).toBeTrue();
  });

  it("overflows to Infinity in arithmetic, which isFinite reports", () => {
    const big = N.mul(Number.MAX_VALUE, 2);
    expect(big).toBe(Infinity);
    expect(N.isFinite(big)).toBeFalse();
    expect(D.isFinite(D.mul(D.from(Number.MAX_VALUE), 2))).toBeTrue();
  });

  it("keeps Decimal magnitudes far past 1e308", () => {
    expect(D.absLog10(D.from("1e1000"))).toBe(1000);
    expect(D.absLog10(D.from("1e-1000"))).toBe(-1000);
    expect(D.cmp(D.from("1e-1000"), D.zero())).toBe(0);
  });
});
