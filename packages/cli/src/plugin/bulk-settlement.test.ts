import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createNumberEngine, stepOnce } from "@idlekit/core";
import type { Model, SimState } from "@idlekit/core";
import { loadRegistries } from "./load";

type Vars = { owned?: number; producers?: number; upgrades?: number; gems?: number };

function state(amount: number, vars: Vars): SimState<number, string, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars,
  };
}

describe("builtin and plugin bulk settlement", () => {
  it("pays the linear quote once and the plugin producer quote once", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const loaded = await loadRegistries([pluginPath]);
    const engine = createNumberEngine();
    const ctx = {
      E: engine,
      unit: { code: "COIN" },
      tickPolicy: { mode: "drop" as const },
    };

    const cases = [
      {
        id: "linear",
        version: 1,
        actionId: "buy.generator",
        vars: { owned: 0 },
        ownedKey: "owned" as const,
      },
      {
        id: "plugin.generators",
        version: 1,
        actionId: "buy.producer",
        vars: { producers: 0, upgrades: 0, gems: 0 },
        ownedKey: "producers" as const,
      },
    ];

    for (const entry of cases) {
      const factory = loaded.modelRegistry.get(entry.id, entry.version);
      expect(factory).toBeDefined();
      const model = factory!.create({}) as Model<number, string, Vars>;
      const start = state(10_000, entry.vars);
      const action = model.actions(ctx, start).find((candidate) => candidate.id === entry.actionId);
      expect(action).toBeDefined();
      const quote = action!.bulk?.(ctx, start)?.find((candidate) => candidate.size === 10);
      const unitCost = action!.cost(ctx, start);
      expect(quote?.cost).toBeTruthy();
      expect(engine.cmp(quote!.cost!.amount, unitCost!.amount) > 0).toBe(true);
      const out = stepOnce({
        ctx,
        model,
        state: start,
        dt: 0,
        decisions: [{ action: action!, bulkSize: 10 }],
      });
      expect(engine.cmp(out.next.wallet.money.amount, engine.sub(start.wallet.money.amount, quote!.cost!.amount))).toBe(
        0,
      );
      expect(out.next.vars[entry.ownedKey]).toBe(10);
      expect(start.wallet.money.amount).toBe(10_000);
      expect(start.vars[entry.ownedKey]).toBe(0);
    }
  });
});
