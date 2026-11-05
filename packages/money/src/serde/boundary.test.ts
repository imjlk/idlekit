import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { deserializeMoneyState, serializeMoneyState, type MoneyStateJSON } from "./moneyState";

const N = createNumberEngine();
const D = createBreakInfinityEngine();
const unit = { code: "COIN" as const };

describe("moneyState serde boundaries", () => {
  it("rejects garbage amounts instead of restoring NaN or 0", () => {
    for (const amount of ["", " ", "abc"]) {
      expect(() => deserializeMoneyState(N, { v: 1, unit: "COIN", amount, bucket: "0" })).toThrow(/Invalid number string/);
    }
  });

  it("rejects fields that are not strings", () => {
    const cases = [
      { v: 1, unit: "COIN", amount: 5, bucket: "0" },
      { v: 1, unit: "COIN", amount: "5" },
      { v: 1, unit: null, amount: "5", bucket: "0" },
    ];
    for (const json of cases) {
      expect(() => deserializeMoneyState(N, json as unknown as MoneyStateJSON)).toThrow(/must be a string/);
    }
    expect(() => deserializeMoneyState(N, null as unknown as MoneyStateJSON)).toThrow(/must be an object/);
  });

  it("round-trips the edges of both engines", () => {
    for (const amount of [Number.MAX_VALUE, Number.MIN_VALUE, -1e-13, Infinity, -Infinity]) {
      const json = serializeMoneyState(N, { money: { unit, amount }, bucket: 0 });
      expect(deserializeMoneyState(N, json).money.amount).toBe(amount);
    }
    const nan = serializeMoneyState(N, { money: { unit, amount: Number.NaN }, bucket: 0 });
    expect(Number.isNaN(deserializeMoneyState(N, nan).money.amount)).toBeTrue();

    for (const text of ["1e1000", "-3.5e-500", "0"]) {
      const json = serializeMoneyState(D, { money: { unit, amount: D.from(text) }, bucket: D.from("1e400") });
      const back = deserializeMoneyState(D, json);
      expect(D.cmp(back.money.amount, D.from(text))).toBe(0);
      expect(D.toString(back.bucket)).toBe(json.bucket);
    }
  });

  it("documents that the Number engine writes -0 as 0", () => {
    const json = serializeMoneyState(N, { money: { unit, amount: -0 }, bucket: 0 });
    expect(json.amount).toBe("0");
  });
});
