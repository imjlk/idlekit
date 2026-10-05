import { realpathSync } from "fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import {
  builtinObjectiveFactories,
  builtinStrategyFactories,
  createModelRegistry,
  createObjectiveRegistry,
  createStrategyRegistry,
  defineModelFactory,
  type ModelFactory,
  type Engine,
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
import { fileExists, readTextFile, sha256Hex } from "../runtime/bun";
import { designObjectiveFactories } from "../lib/designObjectives";
import { cliError } from "../errors";

const ALLOWED_PLUGIN_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
// Files whose imports the digest follows. Bun lets a .js file hold JSX, so JS scans as jsx.
const SCAN_LOADERS: Readonly<Record<string, "jsx" | "ts" | "tsx">> = {
  ".js": "jsx",
  ".mjs": "jsx",
  ".cjs": "jsx",
  ".jsx": "jsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
};

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
  const raw = await readTextFile(pathAbs);
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

function mergeShaPolicies(
  trustFileSha256: Readonly<Record<string, string>>,
  cliSha256: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = { ...trustFileSha256 };
  for (const [pathAbs, digest] of Object.entries(cliSha256)) {
    const existing = out[pathAbs];
    if (existing && existing !== digest) {
      throw new Error(
        `Conflicting sha256 policy for plugin path '${pathAbs}': trust-file=${existing}, cli=${digest}`,
      );
    }
    out[pathAbs] = digest;
  }
  return out;
}

export type LoadedRegistries = Readonly<{
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;
  pluginDigest: Readonly<Record<string, string>>;
}>;

export async function loadRegistries(
  pluginPaths: string[] = [],
  securityOptions: PluginSecurityOptions = {},
): Promise<LoadedRegistries> {
  const modelFactories: ModelFactory[] = [createLinearFactory()];
  const strategyFactories: StrategyFactory[] = [...builtinStrategyFactories];
  const objectiveFactories: ObjectiveFactory[] = [...builtinObjectiveFactories, ...designObjectiveFactories];
  const allowedRoots = (securityOptions.allowedRoots ?? []).map((x) => resolve(x));
  const trustFileSha256 =
    securityOptions.trustFile !== undefined
      ? await loadPluginTrustFile(securityOptions.trustFile)
      : {};
  const requiredSha256 = mergeShaPolicies(trustFileSha256, securityOptions.requiredSha256 ?? {});
  const hasShaPolicy = Object.keys(requiredSha256).length > 0;
  const pluginDigest: Record<string, string> = {};

  for (const p of pluginPaths) {
    const abs = await resolveAndValidatePluginPath(p, allowedRoots);
    const actualDigest = await sha256File(abs);
    if (hasShaPolicy) {
      const expected = requiredSha256[abs];
      if (!expected) {
        throw new Error(
          `Missing sha256 for plugin path '${p}'. Add it via --plugin-sha256 '${p}=<sha256>'`,
        );
      }
      if (actualDigest !== expected) {
        throw new Error(`Plugin sha256 mismatch for '${p}'. expected=${expected} actual=${actualDigest}`);
      }
    }
    // A repeated path loads last again, so its digest moves to the end.
    delete pluginDigest[abs];
    pluginDigest[abs] = await pluginClosureDigest(abs, actualDigest);
    const mod = (await import(abs)) as PluginModule;
    const parsed = parsePluginModule(mod);

    if (parsed.models) modelFactories.push(...parsed.models);
    if (parsed.strategies) strategyFactories.push(...parsed.strategies);
    if (parsed.objectives) objectiveFactories.push(...parsed.objectives);
  }

  return {
    modelRegistry: createModelRegistry(modelFactories),
    strategyRegistry: createStrategyRegistry(strategyFactories),
    objectiveRegistry: createObjectiveRegistry(objectiveFactories),
    pluginDigest,
  };
}

function isPathInsideRoot(pathAbs: string, rootAbs: string): boolean {
  const rel = relative(rootAbs, pathAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function sha256File(pathAbs: string): Promise<string> {
  const buffer = await Bun.file(pathAbs).bytes();
  return sha256Hex(buffer);
}

/** A local file Bun would load: relative, absolute, or a file: URL. Package imports are not followed. */
function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("file:") ||
    isAbsolute(specifier)
  );
}

/**
 * Digest of the plugin and every module it reaches through relative specifiers: static and
 * re-export imports, dynamic import and require with a string literal, resolved the way Bun
 * resolves them. Each file adds its path from the entry directory and its sha256, sorted by
 * path, so a changed helper changes the digest and a copied tree in another directory keeps it.
 * A plugin without relative imports keeps the entry file sha256. Package specifiers are not
 * followed, so installed packages are not hashed. The trust policy still pins the entry file.
 */
async function pluginClosureDigest(entryAbs: string, entryDigest: string): Promise<string> {
  const entryReal = realpathSync(entryAbs);
  const baseDir = dirname(entryReal);
  const files = new Map<string, string>([[entryReal, entryDigest]]);
  const queue = [entryReal];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const loader = SCAN_LOADERS[extname(file).toLowerCase()];
    if (!loader) continue;
    const imports = new Bun.Transpiler({ loader }).scanImports(await readTextFile(file));
    for (const { path: specifier } of imports) {
      if (!isLocalSpecifier(specifier)) continue;
      let target: string;
      try {
        const local = specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier;
        target = realpathSync(Bun.resolveSync(local, dirname(file)));
      } catch {
        // An unresolved import fails when the plugin loads, or is guarded by the plugin.
        continue;
      }
      if (files.has(target)) continue;
      files.set(target, await sha256File(target));
      queue.push(target);
    }
  }
  if (files.size === 1) return entryDigest;
  const listing = [...files]
    .map(([file, digest]) => `${relative(baseDir, file).split(sep).join("/")}\0${digest}`)
    .sort();
  return sha256Hex(listing.join("\n"));
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

  if (!(await fileExists(abs))) {
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
