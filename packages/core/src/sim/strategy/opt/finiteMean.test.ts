import { expect, test } from "bun:test";
import { finiteMean } from "./finiteMean";

test("rounds normal halfway means to the even representable number", () => {
  const step = Number.EPSILON;
  expect(finiteMean([1, 1 + step])).toBe(1);
  expect(finiteMean([1 + step, 1 + 2 * step])).toBe(1 + 2 * step);
  expect(finiteMean([-1, -1 - step])).toBe(-1);
});

test("keeps extreme means finite regardless of sample count", () => {
  for (const count of [1, 3, 7, 17, 100]) {
    expect(finiteMean(Array(count).fill(Number.MAX_VALUE))).toBe(Number.MAX_VALUE);
    expect(finiteMean(Array(count).fill(-Number.MAX_VALUE))).toBe(-Number.MAX_VALUE);
  }
});

test("rounds across the normal/subnormal boundary without losing a bit", () => {
  const normal = 2 ** -1022;
  expect(finiteMean([normal, normal - Number.MIN_VALUE])).toBe(normal);
  expect(finiteMean([-Number.MIN_VALUE, 0])).toBe(-0);
  expect(finiteMean([Number.MAX_VALUE, -Number.MAX_VALUE])).toBe(0);
});
