import { describe, expect, it } from "bun:test";
import {
  BREAK_ETERNITY_EXPERIMENTAL_MESSAGE,
  breakEternityEngine,
  createBreakEternityEngine,
} from "./breakEternity";

describe("breakEternity engine placeholder", () => {
  it("throws an explicit not-implemented error", () => {
    expect(() => breakEternityEngine.zero()).toThrow(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);

    const engine = createBreakEternityEngine();
    expect(() => engine.from("1e6" as never)).toThrow(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);
  });
});
