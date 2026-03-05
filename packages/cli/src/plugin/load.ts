import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
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
  zodStandardSchema,
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
  return zodStandardSchema(schema);
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

export function parsePluginPaths(input: unknown, allowPlugin = false): string[] {
  if (typeof input !== "string" || input.trim().length === 0) return [];
  const paths = input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (paths.length > 0 && !allowPlugin) {
    throw new Error("Plugin loading is disabled by default. Pass --allow-plugin true to enable local plugin modules.");
  }

  return paths;
}

function parseCommaSeparated(input: unknown): string[] {
  if (typeof input !== "string" || input.trim().length === 0) return [];
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeSha256(input: string): string {
  const x = input.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(x)) {
    throw new Error(`Invalid sha256 value '${input}'. Expected 64 lowercase/uppercase hex chars.`);
  }
  return x;
}

export function parsePluginRoots(input: unknown): string[] {
  const list = parseCommaSeparated(input).map((x) => resolve(x));
  return [...new Set(list)];
}

export function parsePluginSha256(input: unknown): Record<string, string> {
  const entries = parseCommaSeparated(input);
  const out: Record<string, string> = {};

  for (const entry of entries) {
    const idx = entry.indexOf("=");
    if (idx <= 0 || idx === entry.length - 1) {
      throw new Error(
        `Invalid --plugin-sha256 entry '${entry}'. Use '<path>=<sha256>' and separate multiple entries with commas.`,
      );
    }

    const key = entry.slice(0, idx)!.trim();
    const value = entry.slice(idx + 1)!.trim();
    const abs = resolve(key);
    const digest = normalizeSha256(value);

    if (out[abs] && out[abs] !== digest) {
      throw new Error(`Conflicting sha256 values for plugin path: ${key}`);
    }
    out[abs] = digest;
  }

  return out;
}

export type PluginSecurityOptions = Readonly<{
  allowedRoots?: readonly string[];
  requiredSha256?: Readonly<Record<string, string>>;
  trustFile?: string;
}>;

type PluginTrustFilePayload = {
  plugins?: Record<string, string>;
  [k: string]: unknown;
};

export function parsePluginSecurityOptions(input: {
  roots?: unknown;
  sha256?: unknown;
  trustFile?: unknown;
}): PluginSecurityOptions {
  const allowedRoots = parsePluginRoots(input.roots);
  const requiredSha256 = parsePluginSha256(input.sha256);
  const trustFile =
    typeof input.trustFile === "string" && input.trustFile.trim().length > 0
      ? resolve(input.trustFile)
      : undefined;
  return {
    allowedRoots,
    requiredSha256,
    trustFile,
  };
}

async function loadPluginTrustFile(pathAbs: string): Promise<Record<string, string>> {
  const raw = await readFile(pathAbs, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const baseDir = dirname(pathAbs);

  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PluginTrustFilePayload)
      : (() => {
          throw new Error(`Invalid plugin trust file format: ${pathAbs}`);
        })();

  const source = root.plugins && typeof root.plugins === "object" && !Array.isArray(root.plugins)
    ? root.plugins
    : (root as Record<string, unknown>);

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "plugins") continue;
    if (typeof v !== "string") continue;
    const digest = normalizeSha256(v);
    const absPath = isAbsolute(k) ? resolve(k) : resolve(baseDir, k);
    out[absPath] = digest;
  }
  return out;
}

export type LoadedRegistries = Readonly<{
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;
}>;

export async function loadRegistries(
  pluginPaths: string[] = [],
  securityOptions: PluginSecurityOptions = {},
): Promise<LoadedRegistries> {
  const modelFactories: ModelFactory[] = [createLinearFactory()];
  const strategyFactories: StrategyFactory[] = [...builtinStrategyFactories];
  const objectiveFactories: ObjectiveFactory[] = [...builtinObjectiveFactories];
  const allowedRoots = (securityOptions.allowedRoots ?? []).map((x) => resolve(x));
  const trustFileSha256 =
    securityOptions.trustFile !== undefined
      ? await loadPluginTrustFile(securityOptions.trustFile)
      : {};
  const requiredSha256 = { ...trustFileSha256, ...(securityOptions.requiredSha256 ?? {}) };
  const hasShaPolicy = Object.keys(requiredSha256).length > 0;

  for (const p of pluginPaths) {
    const abs = await resolveAndValidatePluginPath(p, allowedRoots);
    if (hasShaPolicy) {
      const expected = requiredSha256[abs];
      if (!expected) {
        throw new Error(
          `Missing sha256 for plugin path '${p}'. Add it via --plugin-sha256 '${p}=<sha256>'`,
        );
      }
      const actual = await sha256File(abs);
      if (actual !== expected) {
        throw new Error(`Plugin sha256 mismatch for '${p}'. expected=${expected} actual=${actual}`);
      }
    }
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

function isPathInsideRoot(pathAbs: string, rootAbs: string): boolean {
  const rel = relative(rootAbs, pathAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function sha256File(pathAbs: string): Promise<string> {
  const buffer = await readFile(pathAbs);
  return createHash("sha256").update(buffer).digest("hex");
}

async function resolveAndValidatePluginPath(input: string, allowedRoots: readonly string[]): Promise<string> {
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

  if (allowedRoots.length > 0) {
    const allowed = allowedRoots.some((root) => isPathInsideRoot(abs, root));
    if (!allowed) {
      throw new Error(`Plugin path is outside allowed roots: ${input}`);
    }
  }

  return abs;
}

// Backward compatible helper.
export async function loadRegistry(pluginPaths: string[] = []): Promise<ModelRegistry> {
  const loaded = await loadRegistries(pluginPaths);
  return loaded.modelRegistry;
}
