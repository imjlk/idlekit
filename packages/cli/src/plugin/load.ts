import { realpathSync } from "fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import {
  builtinObjectiveFactories,
  builtinStrategyFactories,
  createBuiltinAnalyzerRegistry,
  createModelRegistry,
  createObjectiveRegistry,
  createStrategyRegistry,
  registerAnalyzerIsolated,
  type AnalyzerDefinition,
  type AnalyzerRegistry,
  type ModelFactory,
  type ModelRegistry,
  type ObjectiveFactory,
  type ObjectiveRegistry,
  type StrategyFactory,
  type StrategyRegistry,
} from "@idlekit/core";
import type { EconPluginModule } from "./types";
import { fileExists, readTextFile, sha256Hex } from "../runtime/bun";
import { recordInputRead } from "../runtime/invocation";
import { designObjectiveFactories } from "../lib/designObjectives";
import { createLinearFactory } from "./linearModel";
import { asPluginTrustError } from "./trust-error";

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


type PluginModule = {
  models?: ModelFactory[];
  strategies?: StrategyFactory[];
  objectives?: ObjectiveFactory[];
  analyzers?: readonly AnalyzerDefinition[];
  default?:
    | EconPluginModule
    | ModelFactory[]
    | {
        models?: ModelFactory[];
        strategies?: StrategyFactory[];
        objectives?: ObjectiveFactory[];
        analyzers?: readonly AnalyzerDefinition[];
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
    analyzers: mod.analyzers ?? fromDefault.analyzers,
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
  /** A parent loader's pluginDigest pins the entry and its local import closure. */
  requiredClosureSha256?: Readonly<Record<string, string>>;
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

export type AnalyzerLoadFailure = Readonly<{ path: string; message: string }>;

export type LoadedRegistries = Readonly<{
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  objectiveRegistry: ObjectiveRegistry;
  analyzerRegistry: AnalyzerRegistry;
  analyzerFailures: readonly AnalyzerLoadFailure[];
  pluginDigest: Readonly<Record<string, string>>;
  /** Model ids a plugin registered, in load order, including a plugin that replaces a built-in id. */
  pluginModelIds?: readonly string[];
  /** Strategy ids a plugin registered, in load order. */
  pluginStrategyIds?: readonly string[];
  /** Analyzer keys (id@version) a plugin registered, in load order. */
  pluginAnalyzerKeys?: readonly string[];
  /** Objective ids a plugin registered, in load order. */
  pluginObjectiveIds?: readonly string[];
}>;

export async function loadRegistries(
  pluginPaths: string[] = [],
  securityOptions: PluginSecurityOptions = {},
): Promise<LoadedRegistries> {
  const modelFactories: ModelFactory[] = [createLinearFactory()];
  const strategyFactories: StrategyFactory[] = [...builtinStrategyFactories];
  const objectiveFactories: ObjectiveFactory[] = [...builtinObjectiveFactories, ...designObjectiveFactories];
  const analyzerRegistry = createBuiltinAnalyzerRegistry();
  const analyzerFailures: AnalyzerLoadFailure[] = [];
  let allowedRoots: string[];
  let requiredSha256: Record<string, string>;
  let requiredClosureSha256: Record<string, string>;
  try {
    allowedRoots = (securityOptions.allowedRoots ?? []).map((x) => resolve(x));
    const trustFileSha256 = securityOptions.trustFile !== undefined ? await loadPluginTrustFile(securityOptions.trustFile) : {};
    requiredSha256 = mergeShaPolicies(trustFileSha256, securityOptions.requiredSha256 ?? {});
    requiredClosureSha256 = mergeShaPolicies({}, securityOptions.requiredClosureSha256 ?? {});
  } catch (error) { throw asPluginTrustError(error); }
  const hasShaPolicy = Object.keys(requiredSha256).length > 0;
  const hasClosurePolicy = Object.keys(requiredClosureSha256).length > 0;
  const pluginDigest: Record<string, string> = {};
  const pluginModelIds: string[] = [];
  const pluginStrategyIds: string[] = [];
  const pluginAnalyzerKeys: string[] = [];
  const pluginObjectiveIds: string[] = [];

  for (const p of pluginPaths) {
    let abs: string;
    let actualDigest: string;
    try {
      abs = await resolveAndValidatePluginPath(p, allowedRoots);
      actualDigest = await sha256File(abs);
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
      const closureDigest = await pluginClosureDigest(abs, actualDigest);
      if (hasClosurePolicy) {
        const expected = requiredClosureSha256[abs];
        if (!expected) throw new Error(`Missing closure sha256 for plugin path '${p}'`);
        if (closureDigest !== expected) {
          throw new Error(`Plugin closure sha256 mismatch for '${p}'. expected=${expected} actual=${closureDigest}`);
        }
      }
      // A repeated path loads last again, so its digest moves to the end.
      delete pluginDigest[abs];
      pluginDigest[abs] = closureDigest;
    } catch (error) { throw asPluginTrustError(error); }
    // Bun names the module by its realpath anyway. Importing through a symlinked directory can
    // miss a file created after Bun cached that directory (Bun 1.4.2), so import the realpath.
    const mod = (await import(realpathSync(abs))) as PluginModule;
    const parsed = parsePluginModule(mod);

    if (parsed.models) {
      modelFactories.push(...parsed.models);
      for (const factory of parsed.models) pluginModelIds.push(`${factory.id}@${factory.version}`);
    }
    if (parsed.strategies) {
      strategyFactories.push(...parsed.strategies);
      for (const factory of parsed.strategies) pluginStrategyIds.push(factory.id);
    }
    if (parsed.objectives) {
      objectiveFactories.push(...parsed.objectives);
      for (const factory of parsed.objectives) pluginObjectiveIds.push(factory.id);
    }
    // A plugin export is a runtime value: a non-array is one isolated failure, not a crash.
    if (parsed.analyzers !== undefined && parsed.analyzers !== null && !Array.isArray(parsed.analyzers)) {
      analyzerFailures.push({ path: abs, message: "plugin analyzers export must be an array" });
    } else if (parsed.analyzers) {
      for (const analyzer of parsed.analyzers) {
        const message = registerAnalyzerIsolated(analyzerRegistry, analyzer);
        if (message) analyzerFailures.push({ path: abs, message });
        else pluginAnalyzerKeys.push(`${analyzer.id}@${analyzer.version}`);
      }
    }
  }

  return {
    modelRegistry: createModelRegistry(modelFactories),
    strategyRegistry: createStrategyRegistry(strategyFactories),
    objectiveRegistry: createObjectiveRegistry(objectiveFactories),
    analyzerRegistry,
    analyzerFailures,
    pluginDigest,
    pluginModelIds,
    pluginStrategyIds,
    pluginAnalyzerKeys,
    pluginObjectiveIds,
  };
}

function existingRealpath(pathAbs: string): string {
  try {
    return realpathSync(pathAbs);
  } catch {
    return pathAbs;
  }
}

function isPathInsideRoot(pathAbs: string, rootAbs: string): boolean {
  const rel = relative(rootAbs, pathAbs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function sha256File(pathAbs: string): Promise<string> {
  recordInputRead(pathAbs);
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
    // The module is imported through its realpath, so the realpath must stay inside a root's realpath too.
    // A symlink inside a root that points outside it does not pass.
    const real = realpathSync(abs);
    const allowed = allowedRoots.some(
      (root) => isPathInsideRoot(abs, root) && isPathInsideRoot(real, existingRealpath(root)),
    );
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
