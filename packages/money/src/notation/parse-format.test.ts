import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
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

  it("combines scientific exponents and suffixes before converting to the engine", () => {
    const decimal = createBreakInfinityEngine();
    for (const [literal, expected] of [["1e-2028zz", 1], ["-2.5e-2028zz", -2.5], [".5e-2027zz", 5], ["0zz", 0]] as const) {
      expect(parseMoney(E, literal, { unit }).amount).toBe(expected);
      expect(decimal.toNumber(parseMoney(decimal, literal, { unit }).amount)).toBe(expected);
    }
    expect(parseMoney(E, "1e-600 K", { unit: { code: "K" }, allowUnitInString: true }).amount).toBe(0);
    expect(parseMoney(E, "1e-600K", { unit, suffix: { kind: "table", table: ["", "K"] } }).amount).toBe(0);
    expect(parseMoney(E, "1e-3aa", { unit }).amount).toBe(1);
    expect(parseMoney(E, "1e-324aa", { unit }).amount).toBe(1e-321);
  });

  it("parses with inline unit when allowed", () => {
    const m = parseMoney(E, "12.3aa COIN", {
      suffix: { kind: "alphaInfinite", minLen: 2 },
      allowUnitInString: true,
    });
    expect(m.unit.code).toBe("COIN");
    expect(Number.isFinite(m.amount)).toBeTrue();
  });

  it("parses unit-only token without treating it as suffix", () => {
    const m = parseMoney(E, "10 COIN", {
      unit,
      allowUnitInString: true,
    });
    expect(m.amount).toBe(10);
    expect(m.unit.code).toBe("COIN");
  });

  it("rejects unknown suffix", () => {
    expect(() => parseMoney(E, "10zzzzq", { unit, suffix: { kind: "table", table: ["", "K"] } })).toThrow(
      "Unknown suffix",
    );
  });
});
