import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { formatMoney } from "./formatMoney";
import { parseMoney } from "./parseMoney";

const E = createNumberEngine();
const unit = { code: "COIN" as const };

describe("formatMoney/parseMoney", () => {
  it("formats with alphaInfinite suffix by default", () => {
    const out = formatMoney(E, { unit, amount: 12345 });
    expect(out.endsWith(" COIN")).toBeTrue();
    expect(out.includes("aa")).toBeTrue();
  });

  it("parses scientific and suffixed inputs", () => {
    const a = parseMoney(E, "1e3", { unit });
    const b = parseMoney(E, "1aa", { unit, suffix: { kind: "alphaInfinite", minLen: 2 } });
    expect(a.amount).toBe(1000);
    expect(b.amount).toBe(1000);
  });

  it("parses with inline unit when allowed", () => {
    const m = parseMoney(E, "12.3aa COIN", {
      suffix: { kind: "alphaInfinite", minLen: 2 },
      allowUnitInString: true,
    });
    expect(m.unit.code).toBe("COIN");
    expect(Number.isFinite(m.amount)).toBeTrue();
  });

  it("rejects unknown suffix", () => {
    expect(() => parseMoney(E, "10zzzzq", { unit, suffix: { kind: "table", table: ["", "K"] } })).toThrow(
      "Unknown suffix",
    );
  });
});
