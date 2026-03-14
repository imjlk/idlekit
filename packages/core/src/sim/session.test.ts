import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { simulateSessionPattern } from "./session";
import type { CompiledScenario, Model, SimState } from "./types";

type UnitCode = "COIN";
type Vars = { owned: number };

function makeState(): SimState<number, UnitCode, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit: { code: "COIN" }, amount: 0 },
      bucket: 0,
    },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { owned: 0 },
  };
}

describe("simulateSessionPattern", () => {
  it("is deterministic for a fixed pattern and seed", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 42 },
      model,
      initial: makeState(),
      run: { stepSec: 1, durationSec: 10 },
    };

    const a = simulateSessionPattern({ scenario, pattern: { id: "short-bursts", days: 1 }, seed: 42 });
    const b = simulateSessionPattern({ scenario, pattern: { id: "short-bursts", days: 1 }, seed: 42 });
    expect(a.end.t).toBe(86400);
    expect(a.end.wallet.money.amount).toBe(b.end.wallet.money.amount);
    expect(a.summary.activeBlocks).toBe(10);
  });
});
