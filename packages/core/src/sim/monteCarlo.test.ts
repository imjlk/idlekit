import { describe, expect, it, mock } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { simulateMonteCarlo } from "./monteCarlo";
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

describe("simulateMonteCarlo", () => {
  it("is reproducible for the same seed", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 7 },
      model,
      initial: makeState(),
      run: { stepSec: 1, durationSec: 10 },
    };

    const a = simulateMonteCarlo({
      scenario,
      draws: 3,
      seed: 7,
      metrics: ({ scenario }) => scenario.ctx.seed ?? 0,
    });
    const b = simulateMonteCarlo({
      scenario,
      draws: 3,
      seed: 7,
      metrics: ({ scenario }) => scenario.ctx.seed ?? 0,
    });

    expect(a.results).toEqual(b.results);
  });

  it("does not depend on Math.random", () => {
    const E = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [],
    };
    const scenario: CompiledScenario<number, UnitCode, Vars> = {
      ctx: { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 11 },
      model,
      initial: makeState(),
      run: { stepSec: 1, durationSec: 10 },
    };

    const original = Math.random;
    Math.random = mock(() => {
      throw new Error("Math.random should not be used");
    }) as unknown as typeof Math.random;

    try {
      const out = simulateMonteCarlo({
        scenario,
        draws: 2,
        seed: 11,
        metrics: ({ scenario }) => scenario.ctx.seed ?? 0,
      });
      expect(out.results.length).toBe(2);
    } finally {
      Math.random = original;
    }
  });
});
