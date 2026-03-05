import { describe, expect, it } from "bun:test";
import { alphaInfiniteIndex, alphaInfiniteSuffix } from "./suffixer";

describe("alphaInfinite suffix/index", () => {
  it("maps canonical milestones", () => {
    expect(alphaInfiniteSuffix(1, 2)).toBe("aa");
    expect(alphaInfiniteSuffix(26, 2)).toBe("az");
    expect(alphaInfiniteSuffix(27, 2)).toBe("ba");
    expect(alphaInfiniteSuffix(676, 2)).toBe("zz");
    expect(alphaInfiniteSuffix(677, 2)).toBe("aaa");
  });

  it("round-trips suffix <-> index", () => {
    for (const i of [1, 2, 25, 26, 27, 101, 676, 677, 2000]) {
      const s = alphaInfiniteSuffix(i, 2);
      expect(alphaInfiniteIndex(s, 2)).toBe(i);
    }
  });

  it("rejects invalid labels", () => {
    expect(alphaInfiniteIndex("a", 2)).toBe(-1);
    expect(alphaInfiniteIndex("a1", 2)).toBe(-1);
    expect(alphaInfiniteIndex("", 2)).toBe(-1);
  });
});
