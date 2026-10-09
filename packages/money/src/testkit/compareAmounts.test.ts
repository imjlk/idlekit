import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { compareAmounts } from "./compareAmounts";

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Matches finite amounts and refuses a number Infinity collapse.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the section, then ran this function: 1000 matches across engines and 1e400 is refused on the number engine.
 * @evidence ./compareAmounts.ts#compareAmounts The number engine and break-infinity engine agree on 1000, and 1e400 collapses only on the number engine. A negative or non-finite logTolerance is rejected before the status is calculated.
 * @evidenceReview ./compareAmounts.ts#compareAmounts #4cc4f29 Re-read compareAmounts: 1000 matches by absLog10, and 1e400 returns refused-number-collapse because the number engine is not finite. A negative or non-finite logTolerance throws before the status is calculated.
 * @evidence ./compareAmounts.ts#AmountComparison.status Expects equal for 1000, different for 10 versus 11, and refused-number-collapse for 1e400.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.status #39607f9 Expects equal for 1000, different for 10 versus 11, and refused-number-collapse for 1e400.
 * @evidence ./compareAmounts.ts#AmountComparison.left The collapsed number text is not the break-infinity text.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.left #42a8aa8 The collapsed number text is not the break-infinity text.
 * @evidence ./compareAmounts.ts#AmountComparison.right The collapsed break-infinity text is not the number text.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.right #9f4f51a The collapsed break-infinity text is not the number text.
 * @evidence ./compareAmounts.ts#AmountComparison.detail The collapse detail says Infinity collapse is not an amount match.
 * @evidenceReview ./compareAmounts.ts#AmountComparison.detail #06eb7c7 The collapse detail says Infinity collapse is not an amount match.
 * @evidence ./compareAmounts.ts#AmountSide.engineId Passes number and break-infinity as the side ids.
 * @evidenceReview ./compareAmounts.ts#AmountSide.engineId #68eb69b Passes number and break-infinity as the side ids.
 * @evidence ./compareAmounts.ts#AmountSide.engine Passes the number engine and the break-infinity engine.
 * @evidenceReview ./compareAmounts.ts#AmountSide.engine #6b9c667 Passes the number engine and the break-infinity engine.
 * @evidence ./compareAmounts.ts#AmountSide.amount Passes 1000, 10, 11, 1e400, 0, and 1e-13 through the engines' from.
 * @evidenceReview ./compareAmounts.ts#AmountSide.amount #05b9864 Passes 1000, 10, 11, 1e400, 0, and 1e-13 through the engines' from.
 */
export function matchesFiniteAmountsAndRefusesInfinityCollapse(): void {
    const numberEngine = createNumberEngine();
    const bigEngine = createBreakInfinityEngine();
    const same = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(1000) },
      { engineId: "break-infinity", engine: bigEngine, amount: bigEngine.from(1000) },
    );
    expect(same.status).toBe("equal");

    const apart = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(10) },
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(11) },
    );
    expect(apart.status).toBe("different");

    const collapsed = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from("1e400") },
      { engineId: "break-infinity", engine: bigEngine, amount: bigEngine.from("1e400") },
    );
    expect(numberEngine.isFinite(numberEngine.from("1e400"))).toBe(false);
    expect(bigEngine.isFinite(bigEngine.from("1e400"))).toBe(true);
    expect(collapsed.status).toBe("refused-number-collapse");
    expect(collapsed.detail).toContain("Infinity collapse");
    expect(collapsed.left).not.toBe(collapsed.right);

    const nearZero = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(0) },
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(1e-13) },
    );
    expect(nearZero.status).toBe("different");
    const opposite = compareAmounts(
      { engineId: "number", engine: numberEngine, amount: numberEngine.from(1e-13) },
      { engineId: "break-infinity", engine: bigEngine, amount: bigEngine.from("-1e-13") },
    );
    expect(opposite.status).toBe("different");
    const sameSide = {
      engineId: "number",
      engine: numberEngine,
      amount: numberEngine.from(1000),
    };
    expect(() => compareAmounts(sameSide, sameSide, -1)).toThrow(/logTolerance/);
    expect(() => compareAmounts(sameSide, sameSide, Number.POSITIVE_INFINITY)).toThrow(
      /logTolerance/,
    );
}

describe("money conformance comparator", () => {
  it(
    "matches finite amounts by log distance and refuses Infinity collapse",
    matchesFiniteAmountsAndRefusesInfinityCollapse,
  );
});
