import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createBreakInfinityEngine, createNumberEngine } from "@idlekit/core";
import type { Engine, Model, SimState } from "@idlekit/core";
import { loadRegistries } from "./load";

type Vars = { producers?: number; upgrades?: number; gems?: number };

async function loadExample() {
  return loadRegistries([resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts")]);
}

function state<N>(E: Engine<N>, amount: string, vars: Vars): SimState<N, string, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount: E.from(amount) }, bucket: E.zero() },
    maxMoneyEver: { unit: { code: "COIN" }, amount: E.from(amount) },
    prestige: { count: 0, points: E.zero(), multiplier: E.from(1) },
    vars,
  };
}

describe("example plugin objective", () => {
  it("uses the built-in finite guard and zero floor for net worth", async () => {
    const loaded = await loadExample();
    const objective = loaded.objectiveRegistry.get("plugin.gemsAndWorthLog10")!.create({ gemsWeight: 0 });
    const score = <N>(E: Engine<N>, amount: string) => {
      const ctx = { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" as const } };
      const model = loaded.modelRegistry.get("plugin.generators", 1)!.create({}) as Model<N, string, Vars>;
      const end = state(E, amount, {});
      return objective.score({ scenario: { ctx, model } as any, run: { end } as any });
    };
    const number = createNumberEngine();
    expect(score(number, "0")).toBe(-300);
    // A positive Number subnormal does not score below zero.
    expect(score(number, "1e-310")).toBe(-300);
    expect(score(number, "1000")).toBe(3);
    expect(() => score(number, "1e400")).toThrow(/finite/);
    const big = createBreakInfinityEngine();
    expect(score(big, "1e-400")).toBe(-300);
    expect(score(big, "1e400")).toBe(400);
  });

  it("values net worth with the same helper its prestige check reads", async () => {
    const loaded = await loadExample();
    const E = createNumberEngine();
    const ctx = { E, unit: { code: "COIN" }, tickPolicy: { mode: "drop" as const } };
    const model = loaded.modelRegistry.get("plugin.generators", 1)!.create({
      producerBaseCost: "8", producerCostGrowth: 1, upgradeBaseCost: "120", upgradeGrowth: 1, gemExchangeCost: "500",
      prestigeRequirement: "1700",
    }) as Model<number, string, Vars>;
    // 100 cash + 2 producers at 8 + 1 upgrade at 120 + 3 gems at 500 = 1736.
    const current = state(E, "100", { producers: 2, upgrades: 1, gems: 3 });
    expect(model.netWorth?.(ctx, current).amount).toBe(1736);
    const prestige = model.actions(ctx, current).find((action) => action.id === "prestige.reboot")!;
    expect(prestige.canApply(ctx, current)).toBe(true);
    expect(prestige.canApply(ctx, state(E, "0", { producers: 2, upgrades: 1, gems: 3 }))).toBe(false);
  });
});
