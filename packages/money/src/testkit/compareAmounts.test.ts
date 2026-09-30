import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { compareAmounts } from "./compareAmounts";

describe("money conformance comparator", () => {
  it("matches finite amounts by log distance and refuses Infinity collapse", () => {
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
    expect(collapsed.left).not.toBe(collapsed.right);
  });
});
