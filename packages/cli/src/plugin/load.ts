import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createModelRegistry,
  defineModelFactory,
  type ModelFactory,
  type ModelRegistry,
  type StandardSchema,
} from "@idlekit/core";
import { z } from "zod";

type LinearParams = {
  incomePerSec?: string;
  buyCostBase?: string;
  buyCostGrowth?: number;
  buyIncomeDelta?: string;
};

type LinearVars = {
  owned?: number;
};

function geometricCost(base: number, growth: number, start: number, count: number): number {
  if (count <= 0) return 0;
  if (growth === 1) return base * count;
  const startFactor = Math.pow(growth, start);
  return (base * startFactor * (Math.pow(growth, count) - 1)) / (growth - 1);
}

function asStandard<T>(schema: z.ZodType<T>): StandardSchema<T> {
  return schema as unknown as StandardSchema<T>;
}

function createLinearFactory(): ModelFactory {
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
          const base = ctx.E.from(p.incomePerSec ?? "1");
          const perOwned = ctx.E.from(p.buyIncomeDelta ?? "1");
          const amount = ctx.E.mulN(ctx.E.add(base, ctx.E.mul(perOwned, owned)), state.prestige.multiplier);
          return { unit: ctx.unit, amount };
        },
        actions(ctx: any, state: any) {
          const owned = Number((state.vars as LinearVars).owned ?? 0);
          const base = Number(p.buyCostBase ?? "10");
          const growth = Number(p.buyCostGrowth ?? 1.15);
          const perOwned = Number(p.buyIncomeDelta ?? "1");

          const action = {
            id: "buy.generator",
            kind: "buy",
            label: "Buy Generator",
            canApply() {
              return true;
            },
            cost() {
              const c = base * Math.pow(growth, owned);
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(c)),
              };
            },
            equivalentCost(_ctx: any, _state: any) {
              const c = base * Math.pow(growth, owned);
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(c)),
              };
            },
            bulk() {
              const sizes = [1, 10, 25, 100];
              return sizes.map((size) => {
                const total = geometricCost(base, growth, owned, size);
                return {
                  size,
                  cost: { unit: ctx.unit, amount: ctx.E.from(String(total)) },
                  equivalentCost: { unit: ctx.unit, amount: ctx.E.from(String(total)) },
                  deltaIncomePerSec: {
                    unit: ctx.unit,
                    amount: ctx.E.from(String(perOwned * size)),
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
          const base = Number(p.buyCostBase ?? "10");
          const growth = Number(p.buyCostGrowth ?? 1.15);
          const implied = geometricCost(base, growth, 0, owned);
          return {
            unit: ctx.unit,
            amount: ctx.E.add(wallet, ctx.E.from(String(implied))),
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

type PluginModule = {
  models?: ModelFactory[];
  default?: ModelFactory[] | { models?: ModelFactory[] };
};

function parsePluginModule(mod: PluginModule): ModelFactory[] {
  if (Array.isArray(mod.models)) return mod.models;
  if (Array.isArray(mod.default)) return mod.default;
  if (mod.default && Array.isArray((mod.default as any).models)) {
    return (mod.default as any).models;
  }
  return [];
}

export function parsePluginPaths(input: unknown): string[] {
  if (typeof input !== "string" || input.trim().length === 0) return [];
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function loadRegistry(pluginPaths: string[] = []): Promise<ModelRegistry> {
  const factories: ModelFactory[] = [createLinearFactory()];

  for (const p of pluginPaths) {
    const abs = resolve(p);
    const mod = (await import(pathToFileURL(abs).href)) as PluginModule;
    factories.push(...parsePluginModule(mod));
  }

  return createModelRegistry(factories);
}
