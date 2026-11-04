/**
 * idlekit plugin that exposes the game economy as runtime adapters.
 *
 * Run:
 *   idk verify runtime examples/engine-integration/scenario.json \
 *     --plugin examples/engine-integration/ts-runtime/runtime-plugin.ts \
 *     --allow-plugin true --runtime cafe.runtime.exact --seed 7
 */
import type { RuntimeEconomyAdapter, RuntimeProbeState } from "@idlekit/core";
import { CAFE_ECONOMY, CafeEconomy, type CafeEconomyConfig } from "./economy";

function owned(state: RuntimeProbeState): number {
  const value = state.vars.owned;
  return typeof value === "number" ? value : 0;
}

function adapterFor(id: string, description: string, config: CafeEconomyConfig): RuntimeEconomyAdapter {
  let economy = new CafeEconomy(config, 0);
  return {
    id,
    version: 1,
    description,
    init: (ctx) => {
      // A new economy per run, seeded from idlekit, keeps runs reproducible.
      economy = new CafeEconomy(config, ctx.seed);
    },
    incomePerSec: (state) => economy.incomePerSec(owned(state), state.prestigeMultiplier),
    actionCosts: (state) => ({ "buy.generator": economy.machineCost(owned(state)) }),
  };
}

export const runtimes: readonly RuntimeEconomyAdapter[] = [
  adapterFor("cafe.runtime", "Shipped game economy: prices rounded up to whole coins", CAFE_ECONOMY),
  adapterFor("cafe.runtime.exact", "Game economy without price rounding", {
    ...CAFE_ECONOMY,
    roundCostsUp: false,
  }),
];
