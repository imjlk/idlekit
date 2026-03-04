import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  builtinObjectiveFactories,
  builtinStrategyFactories,
  createModelRegistry,
  createObjectiveRegistry,
  createStrategyRegistry,
  defineModelFactory,
  type ModelFactory,
  type ModelRegistry,
  type ObjectiveFactory,
  type ObjectiveRegistry,
  type StandardSchema,
  type StrategyFactory,
  type StrategyRegistry,
} from "@idlekit/core";
import { z } from "zod";
import type { EconPluginModule } from "./types";

const ALLOWED_PLUGIN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

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
            equivalentCost() {
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
  strategies?: StrategyFactory[];
  objectives?: ObjectiveFactory[];
  default?:
    | EconPluginModule
    | ModelFactory[]
    | {
        models?: ModelFactory[];
        strategies?: StrategyFactory[];
        objectives?: ObjectiveFactory[];
      };
};

function parsePluginModule(mod: PluginModule): EconPluginModule {
  const fromDefault = (() => {
    if (Array.isArray(mod.default)) {
      return { models: mod.default } satisfies EconPluginModule;
    }

    if (mod.default && typeof mod.default === "object") {
      return mod.default as EconPluginModule;
    }

    return {};
  })();

  return {
    models: mod.models ?? fromDefault.models,
    strategies: mod.strategies ?? fromDefault.strategies,
    objectives: mod.objectives ?? fromDefault.objectives,
  };
}

export function parsePluginPaths(input: unknown): string[] {
  if (typeof input !== "string" || input.trim().length === 0) return [];
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export type LoadedRegistries = Readonly<{
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;
}>;

export async function loadRegistries(pluginPaths: string[] = []): Promise<LoadedRegistries> {
  const modelFactories: ModelFactory[] = [createLinearFactory()];
  const strategyFactories: StrategyFactory[] = [...builtinStrategyFactories];
  const objectiveFactories: ObjectiveFactory[] = [...builtinObjectiveFactories];

  for (const p of pluginPaths) {
    const abs = await resolveAndValidatePluginPath(p);
    const mod = (await import(pathToFileURL(abs).href)) as PluginModule;
    const parsed = parsePluginModule(mod);

    if (parsed.models) modelFactories.push(...parsed.models);
    if (parsed.strategies) strategyFactories.push(...parsed.strategies);
    if (parsed.objectives) objectiveFactories.push(...parsed.objectives);
  }

  return {
    modelRegistry: createModelRegistry(modelFactories),
    strategyRegistry: createStrategyRegistry(strategyFactories),
    objectiveRegistry: createObjectiveRegistry(objectiveFactories),
  };
}

async function resolveAndValidatePluginPath(input: string): Promise<string> {
  if (input.includes("://")) {
    throw new Error(`Plugin path must be a local file path: ${input}`);
  }

  const abs = resolve(input);
  const ext = extname(abs).toLowerCase();
  if (!ALLOWED_PLUGIN_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported plugin extension '${ext}' for ${input}`);
  }

  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    throw new Error(`Plugin file not found: ${input}`);
  }

  return abs;
}

// Backward compatible helper.
export async function loadRegistry(pluginPaths: string[] = []): Promise<ModelRegistry> {
  const loaded = await loadRegistries(pluginPaths);
  return loaded.modelRegistry;
}
