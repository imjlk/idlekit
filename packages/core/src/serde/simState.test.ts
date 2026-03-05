import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { deserializeSimState, parseSimStateJSON, serializeSimState } from "./simState";

const E = createNumberEngine();

describe("simState serde", () => {
  it("round-trips state", () => {
    const state = {
      t: 123,
      wallet: {
        money: { unit: { code: "COIN" as const }, amount: 456.7 },
        bucket: 0.25,
      },
      maxMoneyEver: { unit: { code: "COIN" as const }, amount: 500 },
      prestige: {
        count: 2,
        points: 1234,
        multiplier: 1.5,
      },
      vars: {
        owned: 10,
      },
    };

    const json = serializeSimState(E, state, {
      engineName: "number",
      scenarioPath: "../../examples/simple-linear.json",
      runId: "run-123",
      seed: 7,
      strategy: {
        id: "scripted",
        state: {
          cursor: 3,
        },
      },
    });

    expect(json.meta?.runId).toBe("run-123");
    expect(json.meta?.seed).toBe(7);
    expect(json.strategy?.id).toBe("scripted");
    expect((json.strategy?.state as Record<string, unknown>)?.cursor).toBe(3);

    const restored = deserializeSimState(E, json);
    expect(restored.t).toBe(123);
    expect(restored.wallet.money.unit.code).toBe("COIN");
    expect(restored.wallet.money.amount).toBe(456.7);
    expect(restored.wallet.bucket).toBe(0.25);
    expect(restored.maxMoneyEver.amount).toBe(500);
    expect(restored.prestige.count).toBe(2);
    expect(restored.prestige.points).toBe(1234);
    expect(restored.prestige.multiplier).toBe(1.5);
    expect((restored.vars as any).owned).toBe(10);
  });

  it("rejects unit mismatch with expectedUnit", () => {
    const json = serializeSimState(E, {
      t: 0,
      wallet: {
        money: { unit: { code: "COIN" as const }, amount: 1 },
        bucket: 0,
      },
      maxMoneyEver: { unit: { code: "COIN" as const }, amount: 1 },
      prestige: {
        count: 0,
        points: 0,
        multiplier: 1,
      },
      vars: {},
    });

    expect(() => deserializeSimState(E, json, { expectedUnit: "GEM" })).toThrow("Sim state unit mismatch");
  });

  it("rejects malformed sim state payload with clear error", () => {
    const malformed = {
      v: 1,
      unit: "COIN",
      // missing wallet/maxMoneyEver/prestige/vars
      t: 0,
    };

    expect(() => deserializeSimState(E, malformed)).toThrow("Invalid sim state json");
    expect(() => parseSimStateJSON(malformed)).toThrow("Invalid sim state json");
  });
});
