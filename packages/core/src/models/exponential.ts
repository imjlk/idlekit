import { z } from "zod";
import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { defineModelFactory, type ModelFactory } from "../scenario/registry";
import { stochasticIncomeFactor, stochasticSpecActive, stochasticSpecSchema } from "../sim/stochastic";
import type { Action, AnalyticHints, BulkQuote, Model, SimContext, SimState } from "../sim/types";
import {
  amountOf,
  applySoftCap,
  bulkSizes,
  countOf,
  finiteAmount,
  geometricPower,
  geometricSeries,
  growthFactor,
  nonNegativeAmount,
  optionalObjectSchema,
  softCapSchema,
} from "./shared";

export const EXPONENTIAL_MODEL_ID = "exponential" as const;

/**
 * Parameters of the built-in `exponential` model.
 *
 * Level `L` of the generator produces `idleIncome + baseIncome * (1 + g + ... + g^(L-1))` per second, where
 * `g = growthRate`. `growthRate: 1` is the linear generator. The next level costs `costBase * costGrowth^L`.
 * `softCap` compresses production above `softCap.startsAt`. `maxLevel` stops further purchases.
 * `stochastic` adds seeded critical ticks, drops, and timed events on top of that income (see `sim/stochastic`).
 */
export const exponentialParamsSchema = z.object({
  idleIncome: nonNegativeAmount.default("1"),
  baseIncome: nonNegativeAmount.default("1"),
  growthRate: growthFactor.default(1.07),
  costBase: nonNegativeAmount.default("10"),
  costGrowth: growthFactor.default(1.15),
  maxLevel: z.number().int().positive().optional(),
  softCap: softCapSchema.optional(),
  stochastic: stochasticSpecSchema.optional(),
});

export type ExponentialParams = z.output<typeof exponentialParamsSchema>;
export type ExponentialParamsInput = z.input<typeof exponentialParamsSchema>;

export const exponentialVarsSchema = z
  .object({
    level: z.number().int().nonnegative().default(0),
  })
  .partial();

export type ExponentialVars = Readonly<{ level?: number }>;

const LEVEL_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const;

export function parseExponentialParams(raw: unknown): ExponentialParams {
  return exponentialParamsSchema.parse(raw ?? {});
}

/**
 * The generator shared by `exponential` and `prestige`. `modelId` names the model in error messages,
 * action ids, and milestone keys.
 */
export type GeneratorCore = Readonly<{
  params: ExponentialParams;
  levelOf: (state: Readonly<{ vars?: unknown }>) => number;
  /** Production before the prestige multiplier, after the soft cap. */
  production: <N>(E: Engine<N>, level: number) => N;
  /** Production times the state's prestige multiplier. Deterministic: purchase quotes read this. */
  income: <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>, level?: number) => Money<N, U>;
  /**
   * Income the runner credits: `income` times this tick's seeded stochastic factor, read from `ctx.seed` (0 when unset)
   * and `state.t`. Without an active `stochastic` spec it is `income`.
   */
  realizedIncome: <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => Money<N, U>;
  /** True when a `stochastic` spec can change a tick's income. */
  stochastic: boolean;
  /** Price of `count` levels from `level`. */
  price: <N>(E: Engine<N>, level: number, count: number) => N;
  /** Every level's purchase price summed. */
  investedValue: <N>(E: Engine<N>, level: number) => N;
  remainingLevels: (level: number) => number;
  buyAction: <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>) => Action<N, U, Vars>;
  milestones: <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, prev: SimState<N, U, Vars>, next: SimState<N, U, Vars>) => string[];
  analytic: <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>) => AnalyticHints<N, U, Vars>;
}>;

export function createGeneratorCore(modelId: string, params: ExponentialParams): GeneratorCore {
  const p = params;
  const levelOf = (state: Readonly<{ vars?: unknown }>): number =>
    countOf((state.vars as ExponentialVars | undefined)?.level);
  const remainingLevels = (level: number): number =>
    p.maxLevel === undefined ? Number.POSITIVE_INFINITY : Math.max(0, p.maxLevel - level);

  const rawProduction = <N>(E: Engine<N>, level: number): N => {
    const idle = amountOf(E, p.idleIncome, modelId, "idleIncome");
    const base = amountOf(E, p.baseIncome, modelId, "baseIncome");
    return finiteAmount(E, E.add(idle, geometricSeries(E, base, p.growthRate, 0, level)), modelId, "income");
  };

  const production = <N>(E: Engine<N>, level: number): N => {
    const raw = rawProduction(E, level);
    const startsAt = p.softCap ? amountOf(E, p.softCap.startsAt, modelId, "softCap.startsAt") : undefined;
    return finiteAmount(E, applySoftCap(E, raw, p.softCap, startsAt), modelId, "income");
  };

  const income = <N, U extends string, Vars>(
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
    level: number = levelOf(state),
  ): Money<N, U> => ({
    unit: ctx.unit,
    amount: finiteAmount(ctx.E, ctx.E.mulN(production(ctx.E, level), state.prestige.multiplier), modelId, "income"),
  });

  const stochastic = stochasticSpecActive(p.stochastic);
  const realizedIncome = <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, state: SimState<N, U, Vars>): Money<N, U> => {
    const base = income(ctx, state);
    if (!stochastic || !p.stochastic) return base;
    const factor = stochasticIncomeFactor(p.stochastic, ctx.seed ?? 0, state.t, ctx.stepSec ?? 1);
    if (factor === 1) return base;
    return { unit: base.unit, amount: finiteAmount(ctx.E, ctx.E.mul(base.amount, factor), modelId, "income") };
  };

  const price = <N>(E: Engine<N>, level: number, count: number): N => {
    const base = amountOf(E, p.costBase, modelId, "costBase");
    return finiteAmount(E, geometricSeries(E, base, p.costGrowth, level, count), modelId, "cost");
  };

  const investedValue = <N>(E: Engine<N>, level: number): N => price(E, 0, level);

  const buyAction = <N, U extends string, Vars>(ctx: SimContext<N, U, Vars>): Action<N, U, Vars> => {
    const quote = (state: SimState<N, U, Vars>, size: number): BulkQuote<N, U> => {
      const level = levelOf(state);
      const total = price(ctx.E, level, size);
      const before = income(ctx, state, level).amount;
      const after = income(ctx, state, level + size).amount;
      return {
        size,
        cost: { unit: ctx.unit, amount: total },
        equivalentCost: { unit: ctx.unit, amount: total },
        deltaIncomePerSec: { unit: ctx.unit, amount: ctx.E.sub(after, before) },
      };
    };
    return {
      id: "buy.generator",
      kind: "buy",
      label: "Buy Generator Level",
      canApply(_ctx, state) {
        return remainingLevels(levelOf(state)) >= 1;
      },
      cost(_ctx, state) {
        return { unit: ctx.unit, amount: price(ctx.E, levelOf(state), 1) };
      },
      equivalentCost(_ctx, state) {
        return { unit: ctx.unit, amount: price(ctx.E, levelOf(state), 1) };
      },
      bulk(_ctx, state) {
        return bulkSizes(remainingLevels(levelOf(state))).map((size) => quote(state, size));
      },
      apply(_ctx, state, bulkSize = 1) {
        const vars = (state.vars ?? {}) as Vars & ExponentialVars;
        return { ...state, vars: { ...vars, level: levelOf(state) + bulkSize } };
      },
    };
  };

  const milestones = <N, U extends string, Vars>(
    ctx: SimContext<N, U, Vars>,
    prev: SimState<N, U, Vars>,
    next: SimState<N, U, Vars>,
  ): string[] => {
    const before = levelOf(prev);
    const after = levelOf(next);
    const out: string[] = [];
    if (after <= before) return out;
    for (const threshold of LEVEL_MILESTONES) {
      if (before < threshold && after >= threshold) out.push(`${modelId}.level-${threshold}`);
    }
    if (p.maxLevel !== undefined && before < p.maxLevel && after >= p.maxLevel) out.push(`${modelId}.max-level`);
    if (p.softCap) {
      const startsAt = amountOf(ctx.E, p.softCap.startsAt, modelId, "softCap.startsAt");
      if (ctx.E.cmp(rawProduction(ctx.E, before), startsAt) <= 0 && ctx.E.cmp(rawProduction(ctx.E, after), startsAt) > 0) {
        out.push(`${modelId}.softcap-reached`);
      }
    }
    return out;
  };

  const analytic = <N, U extends string, Vars>(
    ctx: SimContext<N, U, Vars>,
    state: SimState<N, U, Vars>,
  ): AnalyticHints<N, U, Vars> => {
    const E = ctx.E;
    const multiplier = state.prestige.multiplier;
    const costExp = {
      ownedVarPath: "level",
      a: { unit: ctx.unit, amount: amountOf(E, p.costBase, modelId, "costBase") },
      b: p.costGrowth,
    };
    const softcap = p.softCap
      ? {
          softcap: {
            kind: p.softCap.kind,
            startsAt: { unit: ctx.unit, amount: amountOf(E, p.softCap.startsAt, modelId, "softCap.startsAt") },
            ...(p.softCap.strength !== undefined ? { strength: p.softCap.strength } : {}),
          },
        }
      : {};
    if (p.growthRate === 1 && !p.softCap) {
      return {
        incomeKind: "linear",
        generator: {
          ownedVarPath: "level",
          incomePerOwned: { unit: ctx.unit, amount: E.mulN(amountOf(E, p.baseIncome, modelId, "baseIncome"), multiplier) },
          baseIncome: { unit: ctx.unit, amount: E.mulN(amountOf(E, p.idleIncome, modelId, "idleIncome"), multiplier) },
        },
        costExp,
      };
    }
    return { incomeKind: "custom", costExp, ...softcap };
  };

  return {
    params: p,
    levelOf,
    production,
    income,
    realizedIncome,
    stochastic,
    price,
    investedValue,
    remainingLevels,
    buyAction,
    milestones,
    analytic,
  };
}

/** Next-level income increment `baseIncome * growthRate^level`, before the soft cap and multiplier. */
export function exponentialLevelIncrement<N>(E: Engine<N>, params: ExponentialParams, level: number): N {
  return E.mulN(E.from(params.baseIncome), geometricPower(E, params.growthRate, level));
}

export function createExponentialModel<N, U extends string = string>(
  params: ExponentialParamsInput = {},
): Model<N, U, ExponentialVars> {
  const core = createGeneratorCore(EXPONENTIAL_MODEL_ID, exponentialParamsSchema.parse(params));
  return {
    id: EXPONENTIAL_MODEL_ID,
    version: 1,
    income: (ctx, state) => core.realizedIncome(ctx, state),
    actions: (ctx) => [core.buyAction(ctx)],
    netWorth(ctx, state) {
      return {
        unit: ctx.unit,
        amount: finiteAmount(
          ctx.E,
          ctx.E.add(state.wallet.money.amount, core.investedValue(ctx.E, core.levelOf(state))),
          EXPONENTIAL_MODEL_ID,
          "net worth",
        ),
      };
    },
    // A seeded tick factor is not a closed-form income, so analytic ETA and advance get no hint.
    analytic: (ctx, state) => (core.stochastic ? null : core.analytic(ctx, state)),
    milestones: (ctx, prev, next) => core.milestones(ctx, prev, next),
  };
}

/**
 * Built-in `exponential@1`: one geometric generator with an optional level cap and soft cap.
 */
export function createExponentialFactory(): ModelFactory {
  return defineModelFactory<unknown, string, ExponentialVars>({
    id: EXPONENTIAL_MODEL_ID,
    version: 1,
    paramsSchema: optionalObjectSchema(exponentialParamsSchema),
    varsSchema: optionalObjectSchema(exponentialVarsSchema),
    create: (raw) => createExponentialModel(parseExponentialParams(raw)),
  });
}
