import { z } from "zod";
import type { Engine } from "../engine/types";
import { defineModelFactory, type ModelFactory } from "../scenario/registry";
import type { Action, BulkQuote, Model, SimContext, SimState } from "../sim/types";
import { createLedger, PRIMARY, type Ledger } from "./ledger";
import {
  amountOf,
  bulkSizes,
  countOf,
  finiteAmount,
  geometricSeries,
  growthFactor,
  modelKey,
  nonNegativeAmount,
  optionalObjectSchema,
} from "./shared";

export const PRODUCTION_CHAIN_MODEL_ID = "production-chain" as const;

const resourceSchema = z.object({
  id: modelKey,
  initial: nonNegativeAmount.default("0"),
  /** Storage ceiling. A recipe whose output would exceed it slows to what still fits (backpressure). */
  cap: nonNegativeAmount.optional(),
  /** Primary-equivalent value of one unit, for net worth, purchase quotes, and bottleneck ranking. */
  valueInPrimary: z.number().finite().nonnegative().default(0),
});

const recipeSchema = z.object({
  id: modelKey,
  /** Amount consumed per batch, by `primary` or resource id. */
  inputs: z.record(z.string(), nonNegativeAmount).default({}),
  /** Amount produced per batch, by `primary` or resource id. */
  outputs: z.record(z.string(), nonNegativeAmount).refine((value) => Object.keys(value).length > 0, "a recipe needs at least one output"),
  /** Seconds one level takes to finish one batch. */
  timeSec: z.number().finite().positive().default(1),
  build: z
    .object({
      /** `primary` or a resource id. */
      currency: z.string().default(PRIMARY),
      base: nonNegativeAmount.default("10"),
      growth: growthFactor.default(1.15),
    })
    .default({ currency: PRIMARY, base: "10", growth: 1.15 }),
  maxLevel: z.number().int().positive().optional(),
  /** Every gate must hold before the first level can be built. */
  unlock: z.array(z.object({ recipe: z.string(), level: z.number().int().positive() })).default([]),
});

export const productionChainParamsSchema = z
  .object({
    primary: z.object({ idleIncome: nonNegativeAmount.default("1") }).default({ idleIncome: "1" }),
    resources: z.array(resourceSchema).default([]),
    recipes: z.array(recipeSchema).min(1),
  })
  .superRefine((params, issue) => {
    const resources = new Set<string>();
    params.resources.forEach((resource, index) => {
      if (resource.id === PRIMARY) issue.addIssue({ code: "custom", path: ["resources", index, "id"], message: "'primary' is reserved for the wallet" });
      if (resources.has(resource.id)) issue.addIssue({ code: "custom", path: ["resources", index, "id"], message: `duplicate resource '${resource.id}'` });
      resources.add(resource.id);
    });
    const known = (key: string) => key === PRIMARY || resources.has(key);
    const recipes = new Set(params.recipes.map((recipe) => recipe.id));
    const seen = new Set<string>();
    params.recipes.forEach((recipe, index) => {
      if (seen.has(recipe.id)) issue.addIssue({ code: "custom", path: ["recipes", index, "id"], message: `duplicate recipe '${recipe.id}'` });
      seen.add(recipe.id);
      for (const key of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) {
        if (!known(key)) issue.addIssue({ code: "custom", path: ["recipes", index], message: `unknown resource '${key}'` });
      }
      if (!known(recipe.build.currency)) issue.addIssue({ code: "custom", path: ["recipes", index, "build", "currency"], message: `unknown resource '${recipe.build.currency}'` });
      recipe.unlock.forEach((gate, gateIndex) => {
        if (!recipes.has(gate.recipe)) issue.addIssue({ code: "custom", path: ["recipes", index, "unlock", gateIndex, "recipe"], message: `unknown recipe '${gate.recipe}'` });
      });
    });
    try {
      recipeOrder(params.recipes);
    } catch (error) {
      issue.addIssue({ code: "custom", path: ["recipes"], message: (error as Error).message });
    }
  });

export type ProductionChainParams = z.output<typeof productionChainParamsSchema>;
export type ProductionChainParamsInput = z.input<typeof productionChainParamsSchema>;
type Recipe = ProductionChainParams["recipes"][number];

export const productionChainVarsSchema = z
  .object({
    levels: z.record(z.string(), z.number().int().nonnegative()),
    stock: z.record(z.string(), nonNegativeAmount),
  })
  .partial();

export type ProductionChainVars = Readonly<{
  levels?: Readonly<Record<string, number>>;
  stock?: Readonly<Record<string, string>>;
}>;

export function parseProductionChainParams(raw: unknown): ProductionChainParams {
  return productionChainParamsSchema.parse(raw ?? {});
}

type RecipeShape = Readonly<{ id: string; inputs: Readonly<Record<string, string>>; outputs: Readonly<Record<string, string>> }>;

/**
 * Producers before consumers, ties in declared order. A resource cycle (`primary` excluded) is rejected,
 * because a continuous chain with a loop has no single processing order.
 */
export function recipeOrder<R extends RecipeShape>(recipes: readonly R[]): R[] {
  const producers = new Map<string, number[]>();
  recipes.forEach((recipe, index) => {
    for (const key of Object.keys(recipe.outputs)) {
      if (key === PRIMARY) continue;
      producers.set(key, [...(producers.get(key) ?? []), index]);
    }
  });
  const deps = recipes.map((recipe, index) => {
    const out = new Set<number>();
    for (const key of Object.keys(recipe.inputs)) {
      if (key === PRIMARY) continue;
      for (const producer of producers.get(key) ?? []) if (producer !== index) out.add(producer);
      if ((producers.get(key) ?? []).includes(index)) throw new Error(`recipe '${recipe.id}' consumes its own output '${key}'`);
    }
    return out;
  });
  const order: R[] = [];
  const state = new Array<0 | 1 | 2>(recipes.length).fill(0);
  const visit = (index: number, path: string[]): void => {
    if (state[index] === 2) return;
    const recipe = recipes[index]!;
    if (state[index] === 1) throw new Error(`recipe cycle: ${[...path, recipe.id].join(" -> ")}`);
    state[index] = 1;
    for (const dep of [...deps[index]!].sort((a, b) => a - b)) visit(dep, [...path, recipe.id]);
    state[index] = 2;
    order.push(recipe);
  };
  recipes.forEach((_recipe, index) => visit(index, []));
  return order;
}

function levelsOf(state: Readonly<{ vars?: unknown }>): Readonly<Record<string, number>> {
  const raw = (state.vars as ProductionChainVars | undefined)?.levels;
  return raw && typeof raw === "object" ? raw : {};
}

function unlocked(recipe: Recipe, levels: Readonly<Record<string, number>>): boolean {
  return recipe.unlock.every((gate) => countOf(levels[gate.recipe]) >= gate.level);
}

export type ChainLimit = "capacity" | "unbuilt" | "locked" | Readonly<{ input: string }>;

export type ChainRecipeFlow = Readonly<{
  id: string;
  /** 1 for a recipe with no resource input. Otherwise 1 + the deepest producer of its inputs. */
  depth: number;
  level: number;
  capacityBatchesPerSec: number;
  batchesPerSec: number;
  /** batchesPerSec / capacityBatchesPerSec, or 0 without capacity. */
  utilization: number;
  limitedBy: ChainLimit;
  /** Extra value per second, in primary, from one more level of this recipe alone. */
  marginalValuePerSec: number;
}>;

export type ChainResourceFlow = Readonly<{
  id: string;
  producedPerSec: number;
  consumedPerSec: number;
  surplusPerSec: number;
}>;

export type ProductionChainAnalysis = Readonly<{
  /** Longest recipe path. */
  depth: number;
  recipes: readonly ChainRecipeFlow[];
  resources: readonly ChainResourceFlow[];
  /** Net primary per second from recipes, before the prestige multiplier. `primary.idleIncome` is excluded. */
  primaryPerSec: number;
  /** primaryPerSec plus each resource surplus times its valueInPrimary. */
  valuePerSec: number;
  /** The recipe whose next level adds the most value, or null when no level adds any. */
  bottleneck: Readonly<{ recipe: string; marginalValuePerSec: number; limitedBy: ChainLimit }> | null;
  /** Recipes held below capacity by an input. */
  starved: readonly string[];
  assumptions: readonly string[];
}>;

type Flow = Readonly<{
  rates: Map<string, number>;
  limits: Map<string, ChainLimit>;
  produced: Map<string, number>;
  consumed: Map<string, number>;
  primaryPerSec: number;
  valuePerSec: number;
}>;

function steadyFlow(params: ProductionChainParams, order: readonly Recipe[], levels: Readonly<Record<string, number>>): Flow {
  const supply = new Map<string, number>();
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const rates = new Map<string, number>();
  const limits = new Map<string, ChainLimit>();
  let primaryPerSec = 0;
  for (const recipe of order) {
    const level = countOf(levels[recipe.id]);
    const capacity = level / recipe.timeSec;
    let rate = capacity;
    let limit: ChainLimit = "capacity";
    if (level === 0) limit = unlocked(recipe, levels) ? "unbuilt" : "locked";
    for (const [key, raw] of Object.entries(recipe.inputs)) {
      const per = Number(raw);
      if (key === PRIMARY || per <= 0) continue;
      const available = (supply.get(key) ?? 0) / per;
      if (available < rate) {
        rate = available;
        if (level > 0) limit = { input: key };
      }
    }
    rates.set(recipe.id, rate);
    limits.set(recipe.id, limit);
    for (const [key, raw] of Object.entries(recipe.inputs)) {
      const amount = rate * Number(raw);
      if (key === PRIMARY) primaryPerSec -= amount;
      else {
        supply.set(key, (supply.get(key) ?? 0) - amount);
        consumed.set(key, (consumed.get(key) ?? 0) + amount);
      }
    }
    for (const [key, raw] of Object.entries(recipe.outputs)) {
      const amount = rate * Number(raw);
      if (key === PRIMARY) primaryPerSec += amount;
      else {
        supply.set(key, (supply.get(key) ?? 0) + amount);
        produced.set(key, (produced.get(key) ?? 0) + amount);
      }
    }
  }
  let valuePerSec = primaryPerSec;
  for (const resource of params.resources) {
    valuePerSec += Math.max(0, supply.get(resource.id) ?? 0) * resource.valueInPrimary;
  }
  return { rates, limits, produced, consumed, primaryPerSec, valuePerSec };
}

function depthsOf(order: readonly Recipe[]): Map<string, number> {
  const producerDepth = new Map<string, number>();
  const depths = new Map<string, number>();
  for (const recipe of order) {
    let depth = 1;
    for (const key of Object.keys(recipe.inputs)) {
      if (key === PRIMARY) continue;
      depth = Math.max(depth, (producerDepth.get(key) ?? 0) + 1);
    }
    depths.set(recipe.id, depth);
    for (const key of Object.keys(recipe.outputs)) {
      if (key === PRIMARY) continue;
      producerDepth.set(key, Math.max(producerDepth.get(key) ?? 0, depth));
    }
  }
  return depths;
}

function marginalValue(params: ProductionChainParams, order: readonly Recipe[], levels: Readonly<Record<string, number>>, recipe: Recipe, base: number): number {
  const level = countOf(levels[recipe.id]);
  if (!unlocked(recipe, levels)) return 0;
  if (recipe.maxLevel !== undefined && level >= recipe.maxLevel) return 0;
  const next = steadyFlow(params, order, { ...levels, [recipe.id]: level + 1 });
  return Math.max(0, next.valuePerSec - base);
}

/**
 * Steady-state flow of a production chain at the given levels, in the Number domain.
 *
 * Recipes run producers first. A resource consumed by two recipes goes to the earlier one first.
 * Stock already held and storage caps are not part of a steady state, so a recipe fed from stock in a
 * simulation can run faster for a while than this flow says.
 */
export function analyzeProductionChain(
  params: ProductionChainParamsInput,
  levels: Readonly<Record<string, number>> = {},
): ProductionChainAnalysis {
  const p = productionChainParamsSchema.parse(params);
  const order = recipeOrder(p.recipes);
  const flow = steadyFlow(p, order, levels);
  const depths = depthsOf(order);
  const recipes: ChainRecipeFlow[] = p.recipes.map((recipe) => {
    const level = countOf(levels[recipe.id]);
    const capacity = level / recipe.timeSec;
    const rate = flow.rates.get(recipe.id) ?? 0;
    return {
      id: recipe.id,
      depth: depths.get(recipe.id) ?? 1,
      level,
      capacityBatchesPerSec: capacity,
      batchesPerSec: rate,
      utilization: capacity > 0 ? rate / capacity : 0,
      limitedBy: flow.limits.get(recipe.id) ?? "capacity",
      marginalValuePerSec: marginalValue(p, order, levels, recipe, flow.valuePerSec),
    };
  });
  let bottleneck: ProductionChainAnalysis["bottleneck"] = null;
  for (const recipe of recipes) {
    if (recipe.marginalValuePerSec <= 0) continue;
    if (!bottleneck || recipe.marginalValuePerSec > bottleneck.marginalValuePerSec) {
      bottleneck = { recipe: recipe.id, marginalValuePerSec: recipe.marginalValuePerSec, limitedBy: recipe.limitedBy };
    }
  }
  return {
    depth: Math.max(0, ...recipes.map((recipe) => recipe.depth)),
    recipes,
    resources: p.resources.map((resource) => {
      const producedPerSec = flow.produced.get(resource.id) ?? 0;
      const consumedPerSec = flow.consumed.get(resource.id) ?? 0;
      return { id: resource.id, producedPerSec, consumedPerSec, surplusPerSec: producedPerSec - consumedPerSec };
    }),
    primaryPerSec: flow.primaryPerSec,
    valuePerSec: flow.valuePerSec,
    bottleneck,
    starved: recipes.filter((recipe) => typeof recipe.limitedBy === "object").map((recipe) => recipe.id),
    assumptions: [
      "steady-state flow per second; stock already held and storage caps are not counted",
      "a shared input goes to recipes in producer-first, then declared, order",
      "primary inputs are assumed affordable",
      "values are Number-domain design estimates, not engine amounts",
    ],
  };
}

/**
 * Built-in `production-chain` model: resources turned into other resources and primary money by recipes.
 *
 * Each recipe level finishes one batch per `timeSec`, as a continuous flow. In `evolve` recipes run producers
 * first. A batch rate is limited by capacity, by each input held, and by the room left under each output cap.
 * Primary outputs are multiplied by the prestige multiplier and added to the wallet. A build paid in a
 * resource has `cost: null` for the wallet and deducts in `apply`. Build quotes carry the steady-state
 * marginal value from `analyzeProductionChain`, so `greedy` builds the current bottleneck first.
 */
export function createProductionChainModel<N, U extends string = string>(
  params: ProductionChainParamsInput,
): Model<N, U, ProductionChainVars> {
  const p = productionChainParamsSchema.parse(params);
  const id = PRODUCTION_CHAIN_MODEL_ID;
  const order = recipeOrder(p.recipes);
  const ledger: Ledger = createLedger(
    id,
    "stock",
    p.resources.map((resource) => ({
      id: resource.id,
      initial: resource.initial,
      ...(resource.cap !== undefined ? { cap: resource.cap } : {}),
      valueInPrimary: resource.valueInPrimary,
    })),
  );

  type S = SimState<N, U, ProductionChainVars>;
  type C = SimContext<N, U, ProductionChainVars>;

  const remaining = (recipe: Recipe, level: number): number =>
    recipe.maxLevel === undefined ? Number.POSITIVE_INFINITY : Math.max(0, recipe.maxLevel - level);

  const price = (E: Engine<N>, recipe: Recipe, level: number, count: number): N =>
    finiteAmount(E, geometricSeries(E, amountOf(E, recipe.build.base, id, `${recipe.id} build.base`), recipe.build.growth, level, count), id, `${recipe.id} cost`);

  const marginal = (E: Engine<N>, state: S, recipe: Recipe, size: number): N => {
    const levels = levelsOf(state);
    const base = steadyFlow(p, order, levels).valuePerSec;
    const after = steadyFlow(p, order, { ...levels, [recipe.id]: countOf(levels[recipe.id]) + size }).valuePerSec;
    const gain = Math.max(0, after - base);
    return E.mulN(E.from(Number.isFinite(gain) ? gain : 0), state.prestige.multiplier);
  };

  const buildAction = (ctx: C, recipe: Recipe): Action<N, U, ProductionChainVars> => {
    const E = ctx.E;
    const paidInPrimary = recipe.build.currency === PRIMARY;
    const costValue = ledger.valueOf(recipe.build.currency);
    const quote = (state: S, size: number): BulkQuote<N, U> => {
      const total = price(E, recipe, countOf(levelsOf(state)[recipe.id]), size);
      return {
        size,
        cost: paidInPrimary ? { unit: ctx.unit, amount: total } : null,
        equivalentCost: { unit: ctx.unit, amount: E.mul(total, costValue) },
        deltaIncomePerSec: { unit: ctx.unit, amount: marginal(E, state, recipe, size) },
      };
    };
    return {
      id: `build.${recipe.id}`,
      kind: "buy",
      label: `Build ${recipe.id}`,
      canApply(_ctx, state) {
        const levels = levelsOf(state);
        const level = countOf(levels[recipe.id]);
        if (remaining(recipe, level) < 1 || !unlocked(recipe, levels)) return false;
        if (paidInPrimary) return true;
        return E.cmp(ledger.read(E, state, recipe.build.currency), price(E, recipe, level, 1)) >= 0;
      },
      cost(_ctx, state) {
        if (!paidInPrimary) return null;
        return { unit: ctx.unit, amount: price(E, recipe, countOf(levelsOf(state)[recipe.id]), 1) };
      },
      equivalentCost(_ctx, state) {
        return { unit: ctx.unit, amount: E.mul(price(E, recipe, countOf(levelsOf(state)[recipe.id]), 1), costValue) };
      },
      bulk(_ctx, state) {
        const level = countOf(levelsOf(state)[recipe.id]);
        const sizes = paidInPrimary ? bulkSizes(remaining(recipe, level)) : remaining(recipe, level) >= 1 ? [1] : [];
        return sizes.map((size) => quote(state, size));
      },
      apply(_ctx, state, bulkSize = 1) {
        const level = countOf(levelsOf(state)[recipe.id]);
        let next = state;
        if (!paidInPrimary) {
          const owed = price(E, recipe, level, bulkSize);
          const held = ledger.read(E, next, recipe.build.currency);
          if (E.cmp(held, owed) < 0) return state;
          next = ledger.write(E, next, recipe.build.currency, E.sub(held, owed)).state;
        }
        return { ...next, vars: { ...(next.vars ?? {}), levels: { ...levelsOf(next), [recipe.id]: level + bulkSize } } };
      },
    };
  };

  /** Batches this tick: capacity, then every input held, then the room left under every capped output. */
  const batchesFor = (E: Engine<N>, state: S, recipe: Recipe, level: number, dt: number): N => {
    let batches = E.from((level * dt) / recipe.timeSec);
    for (const [key, raw] of Object.entries(recipe.inputs)) {
      const per = amountOf(E, raw, id, `${recipe.id} input ${key}`);
      if (E.cmp(per, E.zero()) <= 0) continue;
      const held = ledger.read(E, state, key);
      const fit = E.divN(held, per);
      if (E.cmp(fit, batches) < 0) batches = fit;
    }
    for (const [key, raw] of Object.entries(recipe.outputs)) {
      if (key === PRIMARY) continue;
      const limit = ledger.cap(E, key);
      if (limit === undefined) continue;
      const per = amountOf(E, raw, id, `${recipe.id} output ${key}`);
      if (E.cmp(per, E.zero()) <= 0) continue;
      const room = E.sub(limit, ledger.read(E, state, key));
      const fit = E.cmp(room, E.zero()) > 0 ? E.divN(room, per) : E.zero();
      if (E.cmp(fit, batches) < 0) batches = fit;
    }
    return E.cmp(batches, E.zero()) > 0 ? batches : E.zero();
  };

  return {
    id,
    version: 1,
    income(ctx, state) {
      return {
        unit: ctx.unit,
        amount: finiteAmount(ctx.E, ctx.E.mulN(amountOf(ctx.E, p.primary.idleIncome, id, "primary.idleIncome"), state.prestige.multiplier), id, "income"),
      };
    },
    evolve(ctx, state, dt) {
      const E = ctx.E;
      let next = state;
      const levels = levelsOf(state);
      for (const recipe of order) {
        const level = countOf(levels[recipe.id]);
        if (level === 0 || !unlocked(recipe, levels)) continue;
        const batches = batchesFor(E, next, recipe, level, dt);
        if (E.cmp(batches, E.zero()) <= 0) continue;
        for (const [key, raw] of Object.entries(recipe.inputs)) {
          const amount = E.mulN(batches, amountOf(E, raw, id, `${recipe.id} input ${key}`));
          next = ledger.write(E, next, key, E.sub(ledger.read(E, next, key), amount)).state;
        }
        for (const [key, raw] of Object.entries(recipe.outputs)) {
          let amount = E.mulN(batches, amountOf(E, raw, id, `${recipe.id} output ${key}`));
          if (key === PRIMARY) amount = E.mulN(amount, next.prestige.multiplier);
          next = ledger.write(E, next, key, E.add(ledger.read(E, next, key), amount)).state;
        }
      }
      return next;
    },
    actions(ctx) {
      return p.recipes.map((recipe) => buildAction(ctx, recipe));
    },
    netWorth(ctx, state) {
      const E = ctx.E;
      let total = E.add(state.wallet.money.amount, ledger.value(E, state));
      const levels = levelsOf(state);
      for (const recipe of p.recipes) {
        const level = countOf(levels[recipe.id]);
        if (level === 0) continue;
        total = E.add(total, E.mul(price(E, recipe, 0, level), ledger.valueOf(recipe.build.currency)));
      }
      return { unit: ctx.unit, amount: finiteAmount(E, total, id, "net worth") };
    },
    milestones(_ctx, prev, next) {
      const out: string[] = [];
      const before = levelsOf(prev);
      const after = levelsOf(next);
      for (const recipe of p.recipes) {
        if (!unlocked(recipe, before) && unlocked(recipe, after) && recipe.unlock.length > 0) out.push(`${id}.${recipe.id}.unlocked`);
      }
      return out;
    },
  };
}

/** Built-in `production-chain@1`. */
export function createProductionChainFactory(): ModelFactory {
  return defineModelFactory<unknown, string, ProductionChainVars>({
    id: PRODUCTION_CHAIN_MODEL_ID,
    version: 1,
    paramsSchema: optionalObjectSchema(productionChainParamsSchema),
    varsSchema: optionalObjectSchema(productionChainVarsSchema),
    create: (raw) => createProductionChainModel(parseProductionChainParams(raw)),
  });
}
