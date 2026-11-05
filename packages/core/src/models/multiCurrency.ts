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

export const MULTI_CURRENCY_MODEL_ID = "multi-currency" as const;

const currencySchema = z.object({
  id: modelKey,
  /** Balance when `initial.vars.balances` does not name this currency. */
  initial: nonNegativeAmount.default("0"),
  /** Balance ceiling. Production above it overflows: converted by an `overflow` rule, otherwise lost. */
  cap: nonNegativeAmount.optional(),
  /** Primary-equivalent value of one unit, for net worth and purchase quotes. 0 leaves it out of net worth. */
  valueInPrimary: z.number().finite().nonnegative().default(1),
  /** Production per second with no generator. */
  idleIncome: nonNegativeAmount.default("0"),
});

const generatorSchema = z.object({
  id: modelKey,
  /** `primary` or a currency id. */
  produces: z.string().default(PRIMARY),
  incomePerLevel: nonNegativeAmount.default("1"),
  /** `primary` or a currency id. */
  costCurrency: z.string().default(PRIMARY),
  costBase: nonNegativeAmount.default("10"),
  costGrowth: growthFactor.default(1.15),
  maxLevel: z.number().int().positive().optional(),
});

const exchangeSchema = z.object({
  id: modelKey,
  from: z.string(),
  to: z.string(),
  /** Units of `to` per unit of `from`, before the fee. */
  rate: z.number().finite().positive(),
  /** Share of the converted amount lost, 0 to below 1. */
  fee: z.number().finite().min(0).lt(1).default(0),
  /** Amount of `from` one manual exchange action converts. */
  lot: nonNegativeAmount.refine((value) => Number(value) > 0, "lot must be > 0").default("1"),
});

const autoConvertSchema = z.object({
  exchange: z.string(),
  /** overflow: convert what the source cap would discard. surplus: convert everything above `keep` each tick. */
  mode: z.enum(["overflow", "surplus"]).default("overflow"),
  keep: nonNegativeAmount.default("0"),
});

export const multiCurrencyParamsSchema = z
  .object({
    primary: z
      .object({
        idleIncome: nonNegativeAmount.default("1"),
        cap: nonNegativeAmount.optional(),
      })
      .default({ idleIncome: "1" }),
    currencies: z.array(currencySchema).min(1),
    generators: z.array(generatorSchema).min(1),
    exchanges: z.array(exchangeSchema).default([]),
    autoConvert: z.array(autoConvertSchema).default([]),
  })
  .superRefine((params, issue) => {
    const currencies = new Set<string>();
    params.currencies.forEach((currency, index) => {
      if (currency.id === PRIMARY) issue.addIssue({ code: "custom", path: ["currencies", index, "id"], message: "'primary' is reserved for the wallet" });
      if (currencies.has(currency.id)) issue.addIssue({ code: "custom", path: ["currencies", index, "id"], message: `duplicate currency '${currency.id}'` });
      currencies.add(currency.id);
    });
    const known = (key: string) => key === PRIMARY || currencies.has(key);
    const generators = new Set<string>();
    params.generators.forEach((generator, index) => {
      if (generators.has(generator.id)) issue.addIssue({ code: "custom", path: ["generators", index, "id"], message: `duplicate generator '${generator.id}'` });
      generators.add(generator.id);
      if (!known(generator.produces)) issue.addIssue({ code: "custom", path: ["generators", index, "produces"], message: `unknown currency '${generator.produces}'` });
      if (!known(generator.costCurrency)) issue.addIssue({ code: "custom", path: ["generators", index, "costCurrency"], message: `unknown currency '${generator.costCurrency}'` });
    });
    const exchanges = new Set<string>();
    params.exchanges.forEach((exchange, index) => {
      if (exchanges.has(exchange.id)) issue.addIssue({ code: "custom", path: ["exchanges", index, "id"], message: `duplicate exchange '${exchange.id}'` });
      exchanges.add(exchange.id);
      if (!known(exchange.from)) issue.addIssue({ code: "custom", path: ["exchanges", index, "from"], message: `unknown currency '${exchange.from}'` });
      if (!known(exchange.to)) issue.addIssue({ code: "custom", path: ["exchanges", index, "to"], message: `unknown currency '${exchange.to}'` });
      if (exchange.from === exchange.to) issue.addIssue({ code: "custom", path: ["exchanges", index, "to"], message: "from and to must differ" });
    });
    params.autoConvert.forEach((rule, index) => {
      if (!exchanges.has(rule.exchange)) issue.addIssue({ code: "custom", path: ["autoConvert", index, "exchange"], message: `unknown exchange '${rule.exchange}'` });
    });
  });

export type MultiCurrencyParams = z.output<typeof multiCurrencyParamsSchema>;
export type MultiCurrencyParamsInput = z.input<typeof multiCurrencyParamsSchema>;

export const multiCurrencyVarsSchema = z
  .object({
    levels: z.record(z.string(), z.number().int().nonnegative()),
    balances: z.record(z.string(), nonNegativeAmount),
  })
  .partial();

export type MultiCurrencyVars = Readonly<{
  levels?: Readonly<Record<string, number>>;
  balances?: Readonly<Record<string, string>>;
}>;

export function parseMultiCurrencyParams(raw: unknown): MultiCurrencyParams {
  return multiCurrencyParamsSchema.parse(raw ?? {});
}

function levelsOf(state: Readonly<{ vars?: unknown }>): Readonly<Record<string, number>> {
  const raw = (state.vars as MultiCurrencyVars | undefined)?.levels;
  return raw && typeof raw === "object" ? raw : {};
}

/**
 * Production per second of one currency (`primary` included), with the prestige multiplier.
 * Every generator adds `incomePerLevel` per level.
 */
export function multiCurrencyRate<N>(
  E: Engine<N>,
  params: MultiCurrencyParams,
  levels: Readonly<Record<string, number>>,
  key: string,
  multiplier: N,
): N {
  const id = MULTI_CURRENCY_MODEL_ID;
  let rate =
    key === PRIMARY
      ? amountOf(E, params.primary.idleIncome, id, "primary.idleIncome")
      : amountOf(E, params.currencies.find((currency) => currency.id === key)?.idleIncome ?? "0", id, `${key} idleIncome`);
  for (const generator of params.generators) {
    if (generator.produces !== key) continue;
    const level = countOf(levels[generator.id]);
    if (level === 0) continue;
    rate = E.add(rate, E.mul(amountOf(E, generator.incomePerLevel, id, `${generator.id} incomePerLevel`), level));
  }
  return finiteAmount(E, E.mulN(rate, multiplier), id, `${key} income`);
}

/**
 * Built-in `multi-currency` model. The wallet holds the primary currency, and `vars.balances` holds the others.
 *
 * Generators produce one currency each and are bought with one currency each. A purchase paid in primary is an
 * ordinary priced action. A purchase paid in a secondary currency has `cost: null` for the wallet, checks the
 * balance in `canApply`, and deducts it in `apply`. Its quote carries the primary-equivalent cost and income, so
 * `greedy` can rank it. Secondary production, caps, and automatic conversion happen in `evolve`, in declared order.
 */
export function createMultiCurrencyModel<N, U extends string = string>(
  params: MultiCurrencyParamsInput,
): Model<N, U, MultiCurrencyVars> {
  const p = multiCurrencyParamsSchema.parse(params);
  const id = MULTI_CURRENCY_MODEL_ID;
  const ledger: Ledger = createLedger(
    id,
    "balances",
    p.currencies.map((currency) => ({
      id: currency.id,
      initial: currency.initial,
      ...(currency.cap !== undefined ? { cap: currency.cap } : {}),
      valueInPrimary: currency.valueInPrimary,
    })),
  );
  const exchangesById = new Map(p.exchanges.map((exchange) => [exchange.id, exchange]));

  type S = SimState<N, U, MultiCurrencyVars>;
  type C = SimContext<N, U, MultiCurrencyVars>;

  const remaining = (generator: MultiCurrencyParams["generators"][number], level: number): number =>
    generator.maxLevel === undefined ? Number.POSITIVE_INFINITY : Math.max(0, generator.maxLevel - level);

  const price = (E: Engine<N>, generator: MultiCurrencyParams["generators"][number], level: number, count: number): N =>
    finiteAmount(E, geometricSeries(E, amountOf(E, generator.costBase, id, `${generator.id} costBase`), generator.costGrowth, level, count), id, `${generator.id} cost`);

  const setLevel = (state: S, generatorId: string, level: number): S => ({
    ...state,
    vars: { ...(state.vars ?? {}), levels: { ...levelsOf(state), [generatorId]: level } },
  });

  const convert = (E: Engine<N>, exchange: MultiCurrencyParams["exchanges"][number], amount: N): N =>
    E.mul(amount, exchange.rate * (1 - exchange.fee));

  const buyAction = (ctx: C, generator: MultiCurrencyParams["generators"][number]): Action<N, U, MultiCurrencyVars> => {
    const E = ctx.E;
    const paidInPrimary = generator.costCurrency === PRIMARY;
    const costValue = ledger.valueOf(generator.costCurrency);
    const incomeValue = ledger.valueOf(generator.produces);
    const quote = (state: S, size: number): BulkQuote<N, U> => {
      const level = countOf(levelsOf(state)[generator.id]);
      const total = price(E, generator, level, size);
      const perLevel = amountOf(E, generator.incomePerLevel, id, `${generator.id} incomePerLevel`);
      return {
        size,
        cost: paidInPrimary ? { unit: ctx.unit, amount: total } : null,
        equivalentCost: { unit: ctx.unit, amount: E.mul(total, costValue) },
        deltaIncomePerSec: { unit: ctx.unit, amount: E.mulN(E.mul(perLevel, size * incomeValue), state.prestige.multiplier) },
      };
    };
    return {
      id: `buy.${generator.id}`,
      kind: "buy",
      label: `Buy ${generator.id}`,
      canApply(_ctx, state) {
        const level = countOf(levelsOf(state)[generator.id]);
        if (remaining(generator, level) < 1) return false;
        if (paidInPrimary) return true;
        return E.cmp(ledger.read(E, state, generator.costCurrency), price(E, generator, level, 1)) >= 0;
      },
      cost(_ctx, state) {
        if (!paidInPrimary) return null;
        return { unit: ctx.unit, amount: price(E, generator, countOf(levelsOf(state)[generator.id]), 1) };
      },
      equivalentCost(_ctx, state) {
        return { unit: ctx.unit, amount: E.mul(price(E, generator, countOf(levelsOf(state)[generator.id]), 1), costValue) };
      },
      bulk(_ctx, state) {
        const level = countOf(levelsOf(state)[generator.id]);
        const sizes = paidInPrimary ? bulkSizes(remaining(generator, level)) : remaining(generator, level) >= 1 ? [1] : [];
        return sizes.map((size) => quote(state, size));
      },
      apply(_ctx, state, bulkSize = 1) {
        const level = countOf(levelsOf(state)[generator.id]);
        let next = state;
        if (!paidInPrimary) {
          const owed = price(E, generator, level, bulkSize);
          const held = ledger.read(E, next, generator.costCurrency);
          if (E.cmp(held, owed) < 0) return state;
          next = ledger.write(E, next, generator.costCurrency, E.sub(held, owed)).state;
        }
        return setLevel(next, generator.id, level + bulkSize);
      },
    };
  };

  const exchangeAction = (ctx: C, exchange: MultiCurrencyParams["exchanges"][number]): Action<N, U, MultiCurrencyVars> => {
    const E = ctx.E;
    const lot = amountOf(E, exchange.lot, id, `${exchange.id} lot`);
    const fromPrimary = exchange.from === PRIMARY;
    return {
      id: `exchange.${exchange.id}`,
      kind: "custom",
      label: `Exchange ${exchange.from} to ${exchange.to}`,
      canApply(_ctx, state) {
        return fromPrimary || E.cmp(ledger.read(E, state, exchange.from), lot) >= 0;
      },
      cost() {
        return fromPrimary ? { unit: ctx.unit, amount: lot } : null;
      },
      equivalentCost() {
        return { unit: ctx.unit, amount: E.mul(lot, ledger.valueOf(exchange.from)) };
      },
      apply(_ctx, state) {
        let next = state;
        if (!fromPrimary) {
          const held = ledger.read(E, next, exchange.from);
          if (E.cmp(held, lot) < 0) return state;
          next = ledger.write(E, next, exchange.from, E.sub(held, lot)).state;
        }
        const target = ledger.read(E, next, exchange.to);
        return ledger.write(E, next, exchange.to, E.add(target, convert(E, exchange, lot))).state;
      },
    };
  };

  const capped = (E: Engine<N>, state: S, key: string): boolean => {
    const limit = key === PRIMARY ? (p.primary.cap !== undefined ? amountOf(E, p.primary.cap, id, "primary.cap") : undefined) : ledger.cap(E, key);
    return limit !== undefined && E.cmp(ledger.read(E, state, key), limit) >= 0;
  };

  return {
    id,
    version: 1,
    income(ctx, state) {
      return { unit: ctx.unit, amount: multiCurrencyRate(ctx.E, p, levelsOf(state), PRIMARY, state.prestige.multiplier) };
    },
    evolve(ctx, state, dt) {
      const E = ctx.E;
      let next = state;
      const overflow = new Map<string, N>();
      // Primary income was paid by the tick. Clamp it to its cap here.
      if (p.primary.cap !== undefined) {
        const limit = amountOf(E, p.primary.cap, id, "primary.cap");
        const held = ledger.read(E, next, PRIMARY);
        if (E.cmp(held, limit) > 0) {
          overflow.set(PRIMARY, E.sub(held, limit));
          next = ledger.write(E, next, PRIMARY, limit).state;
        }
      }
      for (const currency of p.currencies) {
        const rate = multiCurrencyRate(E, p, levelsOf(next), currency.id, next.prestige.multiplier);
        const written = ledger.write(E, next, currency.id, E.add(ledger.read(E, next, currency.id), E.mul(rate, dt)));
        next = written.state;
        if (E.cmp(written.overflow, E.zero()) > 0) overflow.set(currency.id, written.overflow);
      }
      for (const rule of p.autoConvert) {
        const exchange = exchangesById.get(rule.exchange);
        if (!exchange) continue;
        let amount: N;
        if (rule.mode === "overflow") {
          amount = overflow.get(exchange.from) ?? E.zero();
          overflow.delete(exchange.from);
        } else {
          const keep = amountOf(E, rule.keep, id, "autoConvert.keep");
          const held = ledger.read(E, next, exchange.from);
          if (E.cmp(held, keep) <= 0) continue;
          amount = E.sub(held, keep);
          next = ledger.write(E, next, exchange.from, keep).state;
        }
        if (E.cmp(amount, E.zero()) <= 0) continue;
        let proceeds = E.add(ledger.read(E, next, exchange.to), convert(E, exchange, amount));
        let spill = E.zero();
        // The primary clamp already ran and the ledger exempts primary from caps, so cap proceeds here.
        if (exchange.to === PRIMARY && p.primary.cap !== undefined) {
          const limit = amountOf(E, p.primary.cap, id, "primary.cap");
          if (E.cmp(proceeds, limit) > 0) {
            spill = E.sub(proceeds, limit);
            proceeds = limit;
          }
        }
        const converted = ledger.write(E, next, exchange.to, proceeds);
        next = converted.state;
        spill = E.add(spill, converted.overflow);
        // Overflow from conversion proceeds stays available to later overflow rules.
        if (E.cmp(spill, E.zero()) > 0) overflow.set(exchange.to, E.add(overflow.get(exchange.to) ?? E.zero(), spill));
      }
      return next;
    },
    actions(ctx) {
      return [
        ...p.generators.map((generator) => buyAction(ctx, generator)),
        ...p.exchanges.map((exchange) => exchangeAction(ctx, exchange)),
      ];
    },
    netWorth(ctx, state) {
      const E = ctx.E;
      let total = E.add(state.wallet.money.amount, ledger.value(E, state));
      const levels = levelsOf(state);
      for (const generator of p.generators) {
        const level = countOf(levels[generator.id]);
        if (level === 0) continue;
        total = E.add(total, E.mul(price(E, generator, 0, level), ledger.valueOf(generator.costCurrency)));
      }
      return { unit: ctx.unit, amount: finiteAmount(E, total, id, "net worth") };
    },
    milestones(ctx, prev, next) {
      const out: string[] = [];
      for (const key of [PRIMARY, ...p.currencies.map((currency) => currency.id)]) {
        if (!capped(ctx.E, prev, key) && capped(ctx.E, next, key)) out.push(`${id}.${key}.capped`);
      }
      return out;
    },
  };
}

/** Built-in `multi-currency@1`. */
export function createMultiCurrencyFactory(): ModelFactory {
  return defineModelFactory<unknown, string, MultiCurrencyVars>({
    id: MULTI_CURRENCY_MODEL_ID,
    version: 1,
    paramsSchema: optionalObjectSchema(multiCurrencyParamsSchema),
    varsSchema: optionalObjectSchema(multiCurrencyVarsSchema),
    create: (raw) => createMultiCurrencyModel(parseMultiCurrencyParams(raw)),
  });
}
