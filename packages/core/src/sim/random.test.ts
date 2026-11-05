import { describe, expect, it } from "bun:test";
import { deriveDrawSeed, mulberry32 } from "./random";

/** Reference: mix the index with an exact 32-bit product computed in BigInt. */
function referenceDrawSeed(baseSeed: number, drawIndex: number): number {
  const product = Number((BigInt(drawIndex + 1) * 0x9e3779b9n) & 0xffffffffn);
  const rng = mulberry32((baseSeed ^ product) >>> 0);
  return Math.floor(rng() * 0xffffffff) >>> 0;
}

/** The pre-Math.imul formula, kept to prove small-index seeds did not move. */
function floatDrawSeed(baseSeed: number, drawIndex: number): number {
  const rng = mulberry32((baseSeed ^ ((drawIndex + 1) * 0x9e3779b9)) >>> 0);
  return Math.floor(rng() * 0xffffffff) >>> 0;
}

describe("deriveDrawSeed", () => {
  it("keeps every seed where the float product was exact (no golden drift)", () => {
    for (const base of [0, 1, 42, 12345, 0x7fffffff, 0xffffffff]) {
      for (const index of [0, 1, 2, 3, 99, 1_000, 65_535, 1_000_000, 3_000_000, 3_390_000]) {
        expect(deriveDrawSeed(base, index)).toBe(floatDrawSeed(base, index));
      }
    }
  });

  it("matches the exact 32-bit product past 2^53 where the float formula loses bits", () => {
    const indexes = [3_500_000, 10_000_000, 123_456_789, 2 ** 31, 2 ** 32 - 2];
    let floatDiverged = 0;
    for (const index of indexes) {
      expect(deriveDrawSeed(7, index)).toBe(referenceDrawSeed(7, index));
      if (floatDrawSeed(7, index) !== referenceDrawSeed(7, index)) floatDiverged++;
    }
    // Documents why the formula changed: the float product is wrong for large indexes.
    expect(floatDiverged).toBeGreaterThan(0);
  });

  it("is deterministic and returns an unsigned 32-bit integer", () => {
    for (const index of [0, 5, 4_000_000_000]) {
      const seed = deriveDrawSeed(99, index);
      expect(seed).toBe(deriveDrawSeed(99, index));
      expect(Number.isInteger(seed)).toBeTrue();
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
