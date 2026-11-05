/**
 * Game-side economy code, as a game would ship it.
 *
 * This file has no idlekit imports. It stands in for the income and cost
 * functions in your game client or server. `runtime-plugin.ts` wraps it so
 * `idk verify runtime` can compare it with the idlekit simulation.
 */

export type CafeEconomyConfig = Readonly<{
  baseIncome: number;
  incomePerMachine: number;
  machineCostBase: number;
  machineCostGrowth: number;
  /** The shipped game rounds prices up to whole coins. */
  roundCostsUp: boolean;
  /** Random tip bonus in [0, tipJitter). Zero turns randomness off. */
  tipJitter: number;
}>;

export const CAFE_ECONOMY: CafeEconomyConfig = {
  baseIncome: 1,
  incomePerMachine: 1.35,
  machineCostBase: 12,
  machineCostGrowth: 1.11,
  roundCostsUp: true,
  tipJitter: 0,
};

/** Small seeded generator (mulberry32). Games that use randomness must seed it. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CafeEconomy {
  private rng: () => number;

  constructor(
    readonly config: CafeEconomyConfig,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  incomePerSec(machines: number, multiplier: number): number {
    const tip = this.config.tipJitter > 0 ? this.rng() * this.config.tipJitter : 0;
    return (this.config.baseIncome + this.config.incomePerMachine * machines + tip) * multiplier;
  }

  machineCost(machines: number): number {
    const raw = this.config.machineCostBase * this.config.machineCostGrowth ** machines;
    return this.config.roundCostsUp ? Math.ceil(raw) : raw;
  }
}
