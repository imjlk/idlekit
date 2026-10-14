import {
  defineModelFactory,
  type Engine,
  type ModelFactory,
  type StandardSchema,
  zodStandardSchema,
} from "@idlekit/core";
import { z } from "zod";
import { cliError } from "../errors";

/** The built-in `linear` model. It needs no plugin file, so a caller can build it without the plugin loader. */
type LinearParams = {
  incomePerSec?: string;
  buyCostBase?: string;
  buyCostGrowth?: number;
  buyIncomeDelta?: string;
};

type LinearVars = {
  owned?: number;
};

function ownedCount(state: { vars?: LinearVars } | undefined): number {
  return Number(state?.vars?.owned ?? 0);
}

function finiteLinearAmount<N>(E: Engine<N>, value: N, label: string): N {
  if (!E.isFinite(value)) {
    throw cliError("SCENARIO_INVALID", `linear ${label} exceeds the selected engine's finite range. Use --engine breakInfinity with simulate/evaluate/experience/ltv for a large economy, or reduce the inputs.`, {
      hint: "Other commands, including report/compare/tune, use the number engine; reduce their inputs.",
    });
  }
  return value;
}

function linearAmount<N>(E: Engine<N>, raw: string, label: string): N {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) {
    throw new Error(`linear ${label} must be a decimal or scientific amount, received '${raw}'.`);
  }
  return finiteLinearAmount(E, E.from(raw), label);
}

/** Compute g^n and 1+g+...+g^(n-1) in O(log n), without overflowing a Number first. */
function geometricFactors<N>(E: Engine<N>, growth: number, count: number): { power: N; sum: N } {
  let power = E.from(1);
  let sum = E.zero();
  let blockPower = E.from(growth);
  let blockSum = E.from(1);
  for (let remaining = count; remaining > 0; remaining = Math.floor(remaining / 2)) {
    if (remaining % 2 === 1) {
      sum = E.add(sum, E.mulN(power, blockSum));
      power = E.mulN(power, blockPower);
    }
    if (remaining > 1) {
      blockSum = E.add(blockSum, E.mulN(blockPower, blockSum));
      blockPower = E.mulN(blockPower, blockPower);
    }
  }
  return { power, sum };
}

function geometricCost<N>(E: Engine<N>, base: N, growth: number, start: number, count: number): N {
  if (count <= 0) return E.zero();
  if (growth === 1) return finiteLinearAmount(E, E.mul(base, count), "cost");
  // Keep the inexpensive finite factors for ordinary economies. Never pass Infinity to E.from.
  const startNumber = Math.pow(growth, start);
  const sumNumber = (Math.pow(growth, count) - 1) / (growth - 1);
  const startFactor = Number.isFinite(startNumber) ? E.from(startNumber) : geometricFactors(E, growth, start).power;
  const sumFactor = Number.isFinite(sumNumber) ? E.from(sumNumber) : geometricFactors(E, growth, count).sum;
  return finiteLinearAmount(E, E.mulN(E.mulN(base, startFactor), sumFactor), "cost");
}

function asStandard<T>(schema: z.ZodType<T>): StandardSchema<T> {
  return zodStandardSchema(schema);
}

export function createLinearFactory(): ModelFactory {
  return defineModelFactory<number, string, LinearVars>({
    id: "linear",
    version: 1,
    paramsSchema: asStandard(
      z
        .object({
          incomePerSec: z.string().default("1"),
          buyCostBase: z.string().default("10"),
          buyCostGrowth: z.coerce.number().min(1).default(1.15),
          buyIncomeDelta: z.string().default("1"),
        })
        .partial(),
    ),
    varsSchema: asStandard(
      z
        .object({
          owned: z.coerce.number().int().nonnegative().default(0),
        })
        .partial(),
    ),
    create(rawParams): any {
      const p = {
        incomePerSec: "1",
        buyCostBase: "10",
        buyCostGrowth: 1.15,
        buyIncomeDelta: "1",
        ...(rawParams ?? {}),
      } satisfies LinearParams;

      return {
        id: "linear",
        version: 1,
        income(ctx: any, state: any) {
          const owned = Number((state.vars as LinearVars).owned ?? 0);
          const base = linearAmount(ctx.E, p.incomePerSec ?? "1", "incomePerSec");
          const perOwned = linearAmount(ctx.E, p.buyIncomeDelta ?? "1", "buyIncomeDelta");
          const amount = finiteLinearAmount(ctx.E, ctx.E.mulN(ctx.E.add(base, ctx.E.mul(perOwned, owned)), state.prestige.multiplier), "income");
          return { unit: ctx.unit, amount };
        },
        actions(ctx: any, state: any) {
          const base = linearAmount(ctx.E, p.buyCostBase ?? "10", "buyCostBase");
          const growth = Number(p.buyCostGrowth ?? 1.15);
          const perOwned = linearAmount(ctx.E, p.buyIncomeDelta ?? "1", "buyIncomeDelta");

          const action = {
            id: "buy.generator",
            kind: "buy",
            label: "Buy Generator",
            canApply() {
              return true;
            },
            cost(_ctx: any, priced: any) {
              const c = geometricCost(ctx.E, base, growth, ownedCount(priced ?? state), 1);
              return {
                unit: ctx.unit,
                amount: c,
              };
            },
            equivalentCost(_ctx: any, priced: any) {
              const c = geometricCost(ctx.E, base, growth, ownedCount(priced ?? state), 1);
              return {
                unit: ctx.unit,
                amount: c,
              };
            },
            bulk(_ctx: any, priced: any) {
              const owned = ownedCount(priced ?? state);
              const sizes = [1, 10, 25, 100];
              return sizes.map((size) => {
                const total = geometricCost(ctx.E, base, growth, owned, size);
                return {
                  size,
                  cost: { unit: ctx.unit, amount: total },
                  equivalentCost: { unit: ctx.unit, amount: total },
                  deltaIncomePerSec: {
                    unit: ctx.unit,
                    amount: finiteLinearAmount(ctx.E, ctx.E.mul(perOwned, size), "bulk income"),
                  },
                };
              });
            },
            apply(_ctx: any, nextState: any, bulkSize = 1) {
              const vars = (nextState.vars ?? {}) as LinearVars;
              return {
                ...nextState,
                vars: {
                  ...vars,
                  owned: Number(vars.owned ?? 0) + bulkSize,
                },
              };
            },
          };

          return [action];
        },
        netWorth(ctx: any, state: any) {
          const owned = Number((state.vars as LinearVars).owned ?? 0);
          const wallet = state.wallet.money.amount;
          const base = linearAmount(ctx.E, p.buyCostBase ?? "10", "buyCostBase");
          const growth = Number(p.buyCostGrowth ?? 1.15);
          const implied = geometricCost(ctx.E, base, growth, 0, owned);
          return {
            unit: ctx.unit,
            amount: finiteLinearAmount(ctx.E, ctx.E.add(wallet, implied), "net worth"),
          };
        },
        analytic(ctx: any) {
          return {
            incomeKind: "linear",
            generator: {
              ownedVarPath: "owned",
              incomePerOwned: {
                unit: ctx.unit,
                amount: ctx.E.from(p.buyIncomeDelta ?? "1"),
              },
              baseIncome: {
                unit: ctx.unit,
                amount: ctx.E.from(p.incomePerSec ?? "1"),
              },
            },
            costExp: {
              ownedVarPath: "owned",
              a: {
                unit: ctx.unit,
                amount: ctx.E.from(p.buyCostBase ?? "10"),
              },
              b: Number(p.buyCostGrowth ?? 1.15),
            },
          };
        },
      };
    },
  });
}
