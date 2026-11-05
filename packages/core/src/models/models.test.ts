import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { compileScenario } from "../scenario/compile";
import { createModelRegistry } from "../scenario/registry";
import { createStrategyRegistry } from "../sim/strategy/registry";
import type { ScenarioV1 } from "../scenario/types";
import { validateScenarioV1 } from "../scenario/validate";
import { analyzeGrowth } from "../sim/analysis/growth";
import { executeResetCycles, resetAdapterFor } from "../sim/analysis/resetCycle";
import { analyzeResetPolicies } from "../sim/analysis/resetOptimization";
import { runScenario } from "../sim/simulator";
import { builtinStrategyFactories } from "../sim/strategy/builtins";
import type { CompiledScenario, SimContext, SimState } from "../sim/types";
import {
  analyzeProductionChain,
  builtinModelFactories,
  builtinModelParamsJsonSchemas,
  createExponentialModel,
  createMultiCurrencyModel,
  createPrestigeModel,
  createProductionChainModel,
  exponentialParamsSchema,
  multiCurrencyParamsSchema,
  previewPrestigeGain,
  prestigePointsFor,
  prestigeParamsSchema,
  productionChainParamsSchema,
  recipeOrder,
  PRESTIGE_RESET_ACTION_ID,
  type ExponentialParamsInput,
  type ProductionChainParamsInput,
} from "./index";

const tutorialDir = resolve(import.meta.dir, "../../../../examples/tutorials");
const tutorial = (name: string): ScenarioV1 => JSON.parse(readFileSync(resolve(tutorialDir, name), "utf8")) as ScenarioV1;

const TUTORIALS = {
  exponential: "26-exponential-forge-v1.json",
  prestige: "27-prestige-loop-v1.json",
  multiCurrency: "28-twin-currency-v1.json",
  productionChain: "29-factory-chain-v1.json",
} as const;

const registry = () => createModelRegistry(builtinModelFactories());
const strategies = () => createStrategyRegistry([...builtinStrategyFactories]);

function validate(scenario: unknown) {
  return validateScenarioV1(scenario, registry(), strategies());
}

function compile<N>(E: Engine<N>, raw: ScenarioV1, patch?: (scenario: ScenarioV1) => ScenarioV1): CompiledScenario<N, string, any> {
  const checked = validate(patch ? patch(raw) : raw);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return compileScenario<N, string, any>({ E, scenario: checked.scenario!, registry: registry(), strategyRegistry: strategies() });
}

function short(raw: ScenarioV1, durationSec: number): ScenarioV1 {
  return { ...raw, clock: { ...raw.clock, durationSec } };
}

function ctxFor<N, Vars>(E: Engine<N>): SimContext<N, "C", Vars> {
  return { E, unit: { code: "C" }, stepSec: 1 } as SimContext<N, "C", Vars>;
}

function stateFor<Vars>(vars: Vars, money = 0, t = 0): SimState<number, "C", Vars> {
  return {
    t,
    wallet: { money: { unit: { code: "C" }, amount: money }, bucket: 0 },
    maxMoneyEver: { unit: { code: "C" }, amount: money },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars,
  };
}

/** A run's observable result: end state and every committed action. */
function fingerprint(run: ReturnType<typeof runScenario<number, string, unknown>>): string {
  return JSON.stringify({ end: run.end, actions: run.actionsLog });
}

describe("built-in model registry", () => {
  it("registers four factories with distinct ids at version 1", () => {
    const ids = builtinModelFactories().map((factory) => `${factory.id}@${factory.version}`);
    expect(ids).toEqual(["exponential@1", "prestige@1", "multi-currency@1", "production-chain@1"]);
    for (const factory of builtinModelFactories()) {
      expect(factory.paramsSchema).toBeDefined();
      expect(factory.varsSchema).toBeDefined();
    }
  });

  for (const [kind, name] of Object.entries(TUTORIALS)) {
    it(`${kind}: the tutorial validates, compiles, and replays bit-for-bit`, () => {
      const raw = short(tutorial(name), 600);
      expect(validate(raw).ok).toBe(true);
      const E = createNumberEngine();
      const first = runScenario(compile(E, raw));
      const second = runScenario(compile(E, raw));
      expect(first.actionsLog?.length ?? 0).toBeGreaterThan(0);
      expect(fingerprint(second)).toBe(fingerprint(first));
    });

    it(`${kind}: the tutorial runs on the break_infinity engine with the same purchases`, () => {
      const raw = short(tutorial(name), 300);
      const numeric = runScenario(compile(createNumberEngine(), raw));
      const big = runScenario(compile(createBreakInfinityEngine(), raw));
      expect(big.actionsLog?.map((entry) => entry.actionId)).toEqual(numeric.actionsLog?.map((entry) => entry.actionId));
      const money = Number(big.end.wallet.money.amount.toString());
      expect(Math.abs(money - numeric.end.wallet.money.amount)).toBeLessThanOrEqual(1e-6 * Math.max(1, numeric.end.wallet.money.amount));
    });

    it(`${kind}: analyzeGrowth reads the run on both series`, () => {
      const compiled = compile(createNumberEngine(), short(tutorial(name), 600));
      const run = runScenario(compiled);
      const money = analyzeGrowth({ run, series: "money", windowSec: 60 });
      const netWorth = analyzeGrowth({ run, series: "netWorth", windowSec: 60, scenario: compiled });
      expect(money.segments.length).toBeGreaterThan(0);
      expect(netWorth.segments.length).toBeGreaterThan(0);
    });
  }

  it("accepts a scenario that omits model params and vars where every field has a default", () => {
    const raw = tutorial(TUTORIALS.exponential);
    const bare = { ...raw, model: { id: "exponential", version: 1 }, initial: { ...raw.initial, vars: undefined } };
    expect(validate(bare).ok).toBe(true);
  });
});

describe("exponential", () => {
  const E = createNumberEngine();

  it("sums a geometric generator: income(L) = idle + base * (g^L - 1) / (g - 1)", () => {
    const model = createExponentialModel<number, "C">({ idleIncome: "2", baseIncome: "3", growthRate: 1.07 });
    const income = model.income(ctxFor(E), stateFor({ level: 5 })).amount;
    expect(income).toBeCloseTo(2 + (3 * (Math.pow(1.07, 5) - 1)) / 0.07, 9);
  });

  it("prices a bulk buy as the geometric sum and quotes its exact income delta", () => {
    const model = createExponentialModel<number, "C">({ costBase: "10", costGrowth: 1.15, growthRate: 1.1 });
    const ctx = ctxFor<number, { level?: number }>(E);
    const state = stateFor({ level: 3 });
    const action = model.actions(ctx, state)[0]!;
    const quote = action.bulk!(ctx, state).find((entry) => entry.size === 10)!;
    expect(quote.cost!.amount).toBeCloseTo((10 * Math.pow(1.15, 3) * (Math.pow(1.15, 10) - 1)) / 0.15, 6);
    const after = action.apply(ctx, state, 10);
    expect(after.vars.level).toBe(13);
    const delta = model.income(ctx, after).amount - model.income(ctx, state).amount;
    expect(quote.deltaIncomePerSec!.amount).toBeCloseTo(delta, 9);
  });

  it("stops at maxLevel and clips bulk sizes to what is left", () => {
    const model = createExponentialModel<number, "C">({ maxLevel: 12 });
    const ctx = ctxFor<number, { level?: number }>(E);
    const action = model.actions(ctx, stateFor({ level: 0 }))[0]!;
    expect(action.bulk!(ctx, stateFor({ level: 0 })).map((quote) => quote.size)).toEqual([1, 10]);
    expect(action.bulk!(ctx, stateFor({ level: 5 })).map((quote) => quote.size)).toEqual([1]);
    expect(action.canApply(ctx, stateFor({ level: 12 }))).toBe(false);
    expect(model.milestones!(ctx, stateFor({ level: 11 }), stateFor({ level: 12 }))).toContain("exponential.max-level");
  });

  it("applies pow, sqrt, and log soft caps above startsAt only", () => {
    const at = (softCap: NonNullable<ExponentialParamsInput["softCap"]>, level: number) =>
      createExponentialModel<number, "C">({ idleIncome: "0", baseIncome: "100", growthRate: 1, softCap }).income(ctxFor(E), stateFor({ level })).amount;
    expect(at({ startsAt: "1000", strength: 0.5 }, 5)).toBe(500);
    expect(at({ startsAt: "1000", strength: 0.5 }, 40)).toBeCloseTo(1000 * Math.pow(4, 0.5), 9);
    expect(at({ kind: "sqrt", startsAt: "1000" }, 90)).toBeCloseTo(1000 * 3, 9);
    expect(at({ kind: "log", startsAt: "1000", strength: 0.5 }, 100)).toBeCloseTo(1000 * (1 + 0.5 * Math.log(10)), 9);
  });

  it("reports linear analytic hints when growthRate is 1 without a soft cap, and custom otherwise", () => {
    const ctx = ctxFor<number, { level?: number }>(E);
    expect(createExponentialModel<number, "C">({ growthRate: 1 }).analytic!(ctx, stateFor({ level: 4 }))?.incomeKind).toBe("linear");
    expect(createExponentialModel<number, "C">({ growthRate: 1.05 }).analytic!(ctx, stateFor({ level: 4 }))?.incomeKind).toBe("custom");
  });

  it("scales income with the prestige multiplier", () => {
    const model = createExponentialModel<number, "C">({ baseIncome: "1", growthRate: 1 });
    const base = stateFor({ level: 4 });
    expect(model.income(ctxFor(E), { ...base, prestige: { ...base.prestige, multiplier: 3 } }).amount).toBe(3 * model.income(ctxFor(E), base).amount);
  });

  it("stays finite past 1e308 on break_infinity", () => {
    const B = createBreakInfinityEngine();
    const model = createExponentialModel<ReturnType<typeof B.from>, "C">({ growthRate: 2, costGrowth: 2 });
    const ctx = { E: B, unit: { code: "C" }, stepSec: 1 } as SimContext<ReturnType<typeof B.from>, "C", { level?: number }>;
    const state = {
      t: 0,
      wallet: { money: { unit: { code: "C" as const }, amount: B.zero() }, bucket: B.zero() },
      maxMoneyEver: { unit: { code: "C" as const }, amount: B.zero() },
      prestige: { count: 0, points: B.zero(), multiplier: B.from(1) },
      vars: { level: 2000 },
    };
    const income = model.income(ctx, state).amount;
    expect(B.isFinite(income)).toBe(true);
    expect(B.absLog10(income)).toBeGreaterThan(600);
  });

  it("rejects out-of-range params through scenario validation", () => {
    const raw = tutorial(TUTORIALS.exponential);
    const bad = { ...raw, model: { ...raw.model, params: { growthRate: 0.5 } } };
    expect(validate(bad).ok).toBe(false);
    expect(exponentialParamsSchema.safeParse({ costBase: "-1" }).success).toBe(false);
    expect(exponentialParamsSchema.safeParse({ softCap: { startsAt: "10", strength: 1.5 } }).success).toBe(false);
  });
});

describe("prestige", () => {
  const E = createNumberEngine();
  const rules = (patch: object = {}) => prestigeParamsSchema.parse({ prestige: { requirement: "1e6", ...patch } }).prestige;

  it("grants root and log10 points above the requirement and none below", () => {
    expect(prestigePointsFor(E, rules(), 9e5)).toBe(0);
    expect(prestigePointsFor(E, rules(), 4e6)).toBe(2);
    expect(prestigePointsFor(E, rules({ formula: { kind: "root", scale: 3, exponent: 0.5 } }), 9e6)).toBe(9);
    expect(prestigePointsFor(E, rules({ formula: { kind: "log10", scale: 1 } }), 1e8)).toBe(3);
  });

  it("previews the next gain and multiplier in additive and compound modes", () => {
    const additive = previewPrestigeGain(E, { prestige: { requirement: "1e6", multiplierPerPoint: 0.1 } }, 4e6, 3);
    expect(additive).toEqual({ eligible: true, gainedPoints: 2, nextPoints: 5, nextMultiplier: 1.5 });
    const compound = previewPrestigeGain(E, { prestige: { requirement: "1e6", multiplierPerPoint: 0.1, multiplierMode: "compound" } }, 4e6);
    expect(compound.nextMultiplier).toBeCloseTo(1.21, 12);
    expect(previewPrestigeGain(E, { prestige: { requirement: "1e6", minGain: 3 } }, 4e6).eligible).toBe(false);
  });

  it("resets the run, keeps levels and points, and refuses before minRunSec", () => {
    const model = createPrestigeModel<number, "C">({
      generator: { costBase: "10" },
      prestige: { requirement: "1e3", multiplierPerPoint: 0.5, minRunSec: 100, starterCash: "25", keepLevels: 2 },
    });
    const ctx = ctxFor<number, { level?: number; runStartT?: number }>(E);
    const reset = model.actions(ctx, stateFor({ level: 10, runStartT: 0 })).find((action) => action.id === PRESTIGE_RESET_ACTION_ID)!;
    expect(reset.kind).toBe("prestige");
    expect(reset.cost(ctx, stateFor({ level: 10, runStartT: 0 }))).toBeNull();
    expect(reset.canApply(ctx, stateFor({ level: 10, runStartT: 0 }, 1e5, 50))).toBe(false);
    const ready = stateFor({ level: 10, runStartT: 0 }, 1e5, 150);
    expect(reset.canApply(ctx, ready)).toBe(true);
    const after = reset.apply(ctx, ready);
    expect(after.wallet.money.amount).toBe(25);
    expect(after.maxMoneyEver.amount).toBe(25);
    expect(after.vars).toEqual({ level: 2, runStartT: 150 });
    expect(after.prestige.count).toBe(1);
    expect(after.prestige.points).toBeGreaterThan(0);
    expect(after.prestige.multiplier).toBe(1 + 0.5 * after.prestige.points);
    expect(model.prestige).toBeDefined();
  });

  it("greedy never resets on its own; reset timing belongs to the reset-cycle executor", () => {
    const run = runScenario(compile(E, short(tutorial(TUTORIALS.prestige), 1800)));
    expect(run.end.prestige.count).toBe(0);
    expect(run.actionsLog?.some((entry) => entry.actionId === PRESTIGE_RESET_ACTION_ID)).toBe(false);
  });

  it("resolves the listed reset action and runs fixed-interval cycles deterministically", () => {
    const raw = tutorial(TUTORIALS.prestige);
    const compiled = compile(E, raw);
    const adapter = resetAdapterFor(compiled);
    expect(adapter?.id).toBe("prestige.action");
    expect(adapter?.action(compiled.ctx, compiled.initial)?.id).toBe(PRESTIGE_RESET_ACTION_ID);
    const run = () => executeResetCycles({ scenario: compile(E, raw), policy: { kind: "fixed-interval", intervalSec: 900, cycles: 3 } });
    const first = run();
    const second = run();
    expect(first.artifact.appliedResets).toBe(3);
    expect(first.state.prestige.count).toBe(3);
    expect(first.state.prestige.points).toBeGreaterThan(0);
    expect(first.state.prestige.multiplier).toBe(1 + 0.25 * first.state.prestige.points);
    expect(first.state.vars.level).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.artifact)).toBe(JSON.stringify(first.artifact));
  });

  it("feeds analyzeResetPolicies, which ranks scanned intervals by realized points", () => {
    const raw = tutorial(TUTORIALS.prestige);
    const artifact = analyzeResetPolicies({
      createScenario: () => compile(E, raw),
      scan: { fromSec: 600, toSec: 1800, stepSec: 600 },
      horizonSec: 5400,
      cycleBudget: 10,
      objective: "cumulative-reset-reward",
      recovery: { metric: "pre-reset-net-worth" },
      stability: { minObservedCycles: 3, windows: [2, 3], absoluteTolerance: "0", relativeTolerance: 0.5 },
    });
    expect(artifact.candidates.map((row) => row.intervalSec)).toEqual([600, 1200, 1800]);
    expect(artifact.globalOptimum).toBe(false);
    for (const row of artifact.candidates) expect(Number(row.realizedReward)).toBeGreaterThan(0);
    expect([600, 1200, 1800]).toContain(artifact.best.intervalSec);
  });
});

describe("multi-currency", () => {
  const E = createNumberEngine();
  type V = { levels?: Record<string, number>; balances?: Record<string, string> };
  const base = {
    primary: { idleIncome: "0" },
    currencies: [{ id: "gem", cap: "10", valueInPrimary: 5 }],
    generators: [
      { id: "mine", produces: "primary", incomePerLevel: "1" },
      { id: "drill", produces: "gem", incomePerLevel: "2" },
      { id: "foundry", produces: "primary", incomePerLevel: "7", costCurrency: "gem", costBase: "4", costGrowth: 2 },
    ],
    exchanges: [{ id: "sell", from: "gem", to: "primary", rate: 10, fee: 0.2, lot: "2" }],
  };

  it("accrues secondary currencies in evolve and clamps them to the cap", () => {
    const model = createMultiCurrencyModel<number, "C">(base);
    const ctx = ctxFor<number, V>(E);
    const next = model.evolve!(ctx, stateFor<V>({ levels: { drill: 2 }, balances: { gem: "3" } }), 1);
    expect(next.vars.balances?.gem).toBe("7");
    const capped = model.evolve!(ctx, next, 1);
    expect(capped.vars.balances?.gem).toBe("10");
    expect(model.milestones!(ctx, next, capped)).toContain("multi-currency.gem.capped");
  });

  it("converts overflow and surplus automatically, after the fee", () => {
    const ctx = ctxFor<number, V>(E);
    const overflow = createMultiCurrencyModel<number, "C">({ ...base, autoConvert: [{ exchange: "sell", mode: "overflow" }] });
    const a = overflow.evolve!(ctx, stateFor<V>({ levels: { drill: 3 }, balances: { gem: "8" } }), 1);
    expect(a.vars.balances?.gem).toBe("10");
    expect(a.wallet.money.amount).toBeCloseTo(4 * 10 * 0.8, 9);
    const surplus = createMultiCurrencyModel<number, "C">({ ...base, autoConvert: [{ exchange: "sell", mode: "surplus", keep: "1" }] });
    const b = surplus.evolve!(ctx, stateFor<V>({ levels: {}, balances: { gem: "6" } }), 1);
    expect(b.vars.balances?.gem).toBe("1");
    expect(b.wallet.money.amount).toBeCloseTo(5 * 10 * 0.8, 9);
  });

  it("runs a manual exchange one lot at a time", () => {
    const model = createMultiCurrencyModel<number, "C">(base);
    const ctx = ctxFor<number, V>(E);
    const exchange = model.actions(ctx, stateFor<V>({})).find((action) => action.id === "exchange.sell")!;
    expect(exchange.canApply(ctx, stateFor<V>({ balances: { gem: "1" } }))).toBe(false);
    const after = exchange.apply(ctx, stateFor<V>({ balances: { gem: "5" } }));
    expect(after.vars.balances?.gem).toBe("3");
    expect(after.wallet.money.amount).toBeCloseTo(16, 9);
  });

  it("pays a secondary-currency purchase from the balance and quotes it in primary terms", () => {
    const model = createMultiCurrencyModel<number, "C">(base);
    const ctx = ctxFor<number, V>(E);
    const buy = model.actions(ctx, stateFor<V>({})).find((action) => action.id === "buy.foundry")!;
    expect(buy.cost(ctx, stateFor<V>({}))).toBeNull();
    expect(buy.canApply(ctx, stateFor<V>({ balances: { gem: "3" } }))).toBe(false);
    const ready = stateFor<V>({ levels: { foundry: 1 }, balances: { gem: "9" } });
    expect(buy.canApply(ctx, ready)).toBe(true);
    const [quote] = buy.bulk!(ctx, ready);
    expect(quote?.equivalentCost?.amount).toBe(8 * 5);
    expect(quote?.deltaIncomePerSec?.amount).toBe(7);
    const after = buy.apply(ctx, ready);
    expect(after.vars.balances?.gem).toBe("1");
    expect(after.vars.levels?.foundry).toBe(2);
    expect(model.income(ctx, after).amount).toBe(14);
  });

  it("values balances and invested levels in net worth", () => {
    const model = createMultiCurrencyModel<number, "C">(base);
    const ctx = ctxFor<number, V>(E);
    const worth = model.netWorth!(ctx, stateFor<V>({ levels: { foundry: 2 }, balances: { gem: "4" } }, 10)).amount;
    expect(worth).toBe(10 + 4 * 5 + (4 + 8) * 5);
  });

  it("clamps the wallet to a primary cap", () => {
    const model = createMultiCurrencyModel<number, "C">({ ...base, primary: { idleIncome: "1", cap: "50" } });
    const next = model.evolve!(ctxFor<number, V>(E), stateFor<V>({}, 80), 1);
    expect(next.wallet.money.amount).toBe(50);
  });

  it("rejects unknown references and duplicate ids", () => {
    expect(multiCurrencyParamsSchema.safeParse({ ...base, generators: [{ id: "x", produces: "ruby" }] }).success).toBe(false);
    expect(multiCurrencyParamsSchema.safeParse({ ...base, currencies: [{ id: "gem" }, { id: "gem" }] }).success).toBe(false);
    expect(multiCurrencyParamsSchema.safeParse({ ...base, currencies: [{ id: "primary" }] }).success).toBe(false);
    expect(multiCurrencyParamsSchema.safeParse({ ...base, autoConvert: [{ exchange: "nope" }] }).success).toBe(false);
    expect(multiCurrencyParamsSchema.safeParse({ ...base, exchanges: [{ id: "loop", from: "gem", to: "gem", rate: 1 }] }).success).toBe(false);
  });

  it("buys with gems in the tutorial run", () => {
    const run = runScenario(compile(E, tutorial(TUTORIALS.multiCurrency)));
    expect(run.actionsLog?.some((entry) => entry.actionId === "buy.foundry")).toBe(true);
    expect(run.actionsLog?.some((entry) => entry.actionId === "buy.drill")).toBe(true);
  });
});

describe("production-chain", () => {
  const E = createNumberEngine();
  type V = { levels?: Record<string, number>; stock?: Record<string, string> };
  const chain: ProductionChainParamsInput = {
    primary: { idleIncome: "0" },
    resources: [
      { id: "ore", valueInPrimary: 1 },
      { id: "bar", valueInPrimary: 5, cap: "4" },
    ],
    recipes: [
      { id: "mine", outputs: { ore: "1" }, timeSec: 1 },
      { id: "smelt", inputs: { ore: "2" }, outputs: { bar: "1" }, timeSec: 2, unlock: [{ recipe: "mine", level: 2 }] },
      { id: "sell", inputs: { bar: "1" }, outputs: { primary: "20" }, timeSec: 1 },
    ],
  };

  it("orders producers before consumers and rejects cycles and self-consumption", () => {
    const parsed = productionChainParamsSchema.parse(chain);
    expect(recipeOrder([parsed.recipes[2]!, parsed.recipes[1]!, parsed.recipes[0]!]).map((r) => r.id)).toEqual(["mine", "smelt", "sell"]);
    const cycle = {
      ...chain,
      recipes: [
        { id: "a", inputs: { bar: "1" }, outputs: { ore: "1" } },
        { id: "b", inputs: { ore: "1" }, outputs: { bar: "1" } },
      ],
    };
    expect(productionChainParamsSchema.safeParse(cycle).success).toBe(false);
    expect(productionChainParamsSchema.safeParse({ ...chain, recipes: [{ id: "a", inputs: { ore: "1" }, outputs: { ore: "2" } }] }).success).toBe(false);
    expect(productionChainParamsSchema.safeParse({ ...chain, recipes: [{ id: "a", outputs: { ruby: "1" } }] }).success).toBe(false);
  });

  it("runs batches producer-first in one tick, limited by inputs on hand", () => {
    const model = createProductionChainModel<number, "C">(chain);
    const ctx = ctxFor<number, V>(E);
    const next = model.evolve!(ctx, stateFor<V>({ levels: { mine: 4, smelt: 2, sell: 1 }, stock: {} }), 1);
    // mine makes 4 ore; smelt runs 1 batch per sec (2 levels / 2 s) using 2 ore; sell turns that bar into 20.
    expect(next.vars.stock).toEqual({ ore: "2", bar: "0" });
    expect(next.wallet.money.amount).toBe(20);
  });

  it("applies backpressure at an output cap", () => {
    const model = createProductionChainModel<number, "C">(chain);
    const ctx = ctxFor<number, V>(E);
    // mine adds 2 ore; smelt could run 10 batches but only one bar fits under the cap of 4.
    const next = model.evolve!(ctx, stateFor<V>({ levels: { mine: 2, smelt: 20 }, stock: { ore: "100", bar: "3" } }), 1);
    expect(next.vars.stock).toEqual({ ore: "100", bar: "4" });
  });

  it("does not run a recipe whose unlock gate no longer holds", () => {
    const model = createProductionChainModel<number, "C">(chain);
    const next = model.evolve!(ctxFor<number, V>(E), stateFor<V>({ levels: { smelt: 4 }, stock: { ore: "10" } }), 1);
    expect(next.vars.stock?.ore).toBe("10");
  });

  it("gates a build on its unlock levels", () => {
    const model = createProductionChainModel<number, "C">(chain);
    const ctx = ctxFor<number, V>(E);
    const build = model.actions(ctx, stateFor<V>({})).find((action) => action.id === "build.smelt")!;
    expect(build.canApply(ctx, stateFor<V>({ levels: { mine: 1 } }, 1e6))).toBe(false);
    expect(build.canApply(ctx, stateFor<V>({ levels: { mine: 2 } }, 1e6))).toBe(true);
    expect(model.milestones!(ctx, stateFor<V>({ levels: { mine: 1 } }), stateFor<V>({ levels: { mine: 2 } }))).toContain("production-chain.smelt.unlocked");
  });

  it("names the bottleneck: the build that adds the most steady-state value", () => {
    const starved = analyzeProductionChain(chain, { mine: 10, smelt: 1, sell: 5 });
    expect(starved.bottleneck?.recipe).toBe("smelt");
    expect(starved.recipes.find((row) => row.id === "sell")?.limitedBy).toEqual({ input: "bar" });
    expect(starved.starved).toContain("sell");
    const balanced = analyzeProductionChain(chain, { mine: 2, smelt: 2, sell: 1 });
    expect(balanced.primaryPerSec).toBe(20);
    expect(balanced.recipes.find((row) => row.id === "smelt")?.utilization).toBe(1);
    expect(analyzeProductionChain(chain, {}).recipes.find((row) => row.id === "smelt")?.limitedBy).toBe("locked");
    expect(balanced.depth).toBe(3);
  });

  it("quotes the bottleneck's marginal value to greedy", () => {
    const model = createProductionChainModel<number, "C">(chain);
    const ctx = ctxFor<number, V>(E);
    const state = stateFor<V>({ levels: { mine: 10, smelt: 1, sell: 5 } }, 1e6);
    const delta = (id: string) => model.actions(ctx, state).find((action) => action.id === `build.${id}`)!.bulk!(ctx, state)[0]!.deltaIncomePerSec!.amount;
    const analysis = analyzeProductionChain(chain, { mine: 10, smelt: 1, sell: 5 });
    expect(delta("smelt")).toBeCloseTo(analysis.bottleneck!.marginalValuePerSec, 9);
    expect(delta("smelt")).toBeGreaterThan(delta("sell"));
  });

  it("builds every stage in the tutorial run", () => {
    const run = runScenario(compile(E, tutorial(TUTORIALS.productionChain)));
    for (const id of ["mine", "smelter", "assembler", "market"]) {
      expect(run.actionsLog?.some((entry) => entry.actionId === `build.${id}`)).toBe(true);
    }
  });
});

describe("model params JSON schemas", () => {
  it("match the committed docs/schemas/models files byte for byte", () => {
    for (const [id, schema] of Object.entries(builtinModelParamsJsonSchemas())) {
      const path = resolve(import.meta.dir, `../../../../docs/schemas/models/${id}.params.v1.schema.json`);
      expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).toBe(`${JSON.stringify(schema, null, 2)}\n`);
    }
  });
});
