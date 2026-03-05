import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { deserializeMoneyState, serializeMoneyState } from "./moneyState";

const E = createNumberEngine();

describe("moneyState serde", () => {
  it("round-trips state", () => {
    const state = {
      money: { unit: { code: "COIN" as const }, amount: 123.45 },
      bucket: 0.5,
    };

    const json = serializeMoneyState(E, state, { engineName: "number", engineVersion: "1" });
    const restored = deserializeMoneyState(E, json);

    expect(restored.money.unit.code).toBe("COIN");
    expect(restored.money.amount).toBe(123.45);
    expect(restored.bucket).toBe(0.5);
  });

  it("rejects future version unless explicitly allowed", () => {
    expect(() =>
      deserializeMoneyState(E, {
        v: 2 as 1,
        unit: "COIN",
        amount: "1",
        bucket: "0",
      }),
    ).toThrow("Unsupported money state version");

    const restored = deserializeMoneyState(
      E,
      {
        v: 2 as 1,
        unit: "COIN",
        amount: "1",
        bucket: "0",
      },
      { allowFutureVersions: true },
    );
    expect(restored.money.amount).toBe(1);
  });
});
