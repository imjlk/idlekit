import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

import {
  argumentBoundary,
  insideSpan,
  readQuoted,
  readStaticTemplate,
  skipPair,
  skipSpaceAndComments,
  spanEndAt,
  stringSpans,
  wordBefore,
} from "./lex";

type LocalRequire = { kind: "static"; spec: string } | { kind: "dynamic" };

/** `require("./helper")` and `require(\`./helper\`)`. Package specifiers are static too. */
function localRequireCalls(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): LocalRequire[] {
  const found: LocalRequire[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (!body.startsWith("require", index)) {
      index += 1;
      continue;
    }
    const previous = body[index - 1];
    const tail = body[index + "require".length] ?? "";
    if (
      previous === "." ||
      (previous !== undefined && /[A-Za-z0-9_$]/.test(previous)) ||
      /[A-Za-z0-9_$]/.test(tail) ||
      wordBefore(body, index) === "function"
    ) {
      index += "require".length;
      continue;
    }
    const open = skipSpaceAndComments(body, index + "require".length);
    if (body[open] !== "(") {
      index += "require".length;
      continue;
    }
    const argAt = skipSpaceAndComments(body, open + 1);
    const quoted = readQuoted(body, argAt) ?? readStaticTemplate(body, argAt);
    if (quoted && argumentBoundary(body, quoted.end)) {
      found.push({ kind: "static", spec: quoted.value });
    } else found.push({ kind: "dynamic" });
    const close = skipPair(body, open);
    index = close < 0 ? open + 1 : close;
  }
  return found;
}

/** `import("./helper")` is static. `import("./" + "helper")` is not a resolvable local file. */
function importCalls(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): LocalRequire[] {
  const found: LocalRequire[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (!body.startsWith("import", index)) {
      index += 1;
      continue;
    }
    const previous = body[index - 1];
    const tail = body[index + "import".length] ?? "";
    if (
      previous === "." ||
      (previous !== undefined && /[A-Za-z0-9_$]/.test(previous)) ||
      /[A-Za-z0-9_$]/.test(tail)
    ) {
      index += "import".length;
      continue;
    }
    const open = skipSpaceAndComments(body, index + "import".length);
    if (body[open] !== "(") {
      index += "import".length;
      continue;
    }
    const argAt = skipSpaceAndComments(body, open + 1);
    const quoted = readQuoted(body, argAt) ?? readStaticTemplate(body, argAt);
    if (quoted && argumentBoundary(body, quoted.end)) {
      found.push({ kind: "static", spec: quoted.value });
    } else found.push({ kind: "dynamic" });
    const close = skipPair(body, open);
    index = close < 0 ? open + 1 : close;
  }
  return found;
}

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
const NON_RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["']([^."'][^"']*)["']/g;

function typescriptImportCandidates(base: string): string[] {
  const replacements = [
    [".mjs", [".mts"]],
    [".cjs", [".cts"]],
    [".jsx", [".tsx"]],
    [".js", [".ts", ".tsx"]],
  ] as const;
  for (const [extension, targets] of replacements) {
    if (!base.endsWith(extension)) continue;
    const stem = base.slice(0, -extension.length);
    return targets.map((target) => `${stem}${target}`);
  }
  return [];
}

function resolveExistingFile(base: string): string | undefined {
  const candidates = [
    base,
    ...typescriptImportCandidates(base),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function resolveRelativeImport(fromFile: string, spec: string): string | undefined {
  return resolveExistingFile(resolve(dirname(fromFile), spec));
}

type ResolvedSpec = { kind: "external" } | { kind: "file"; file: string } | { kind: "missing" };

type PathConfig = { baseDir: string; paths: Record<string, string[]> };

const pathConfigByFileDir = new Map<string, PathConfig | null>();
const nearestTsconfigByDir = new Map<string, string | undefined>();
const loadedPathConfig = new Map<string, PathConfig | null>();
const workspacePackagesByRoot = new Map<string, WorkspacePackage[]>();

type WorkspacePackage = {
  name: string;
  dir: string;
  exports?: unknown;
  types?: string;
  module?: string;
  main?: string;
};

function stripConfigComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function readConfigObject(
  file: string,
): { extends?: unknown; compilerOptions?: unknown } | undefined {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { extends?: unknown; compilerOptions?: unknown };
    return parsed;
  } catch {
    try {
      return JSON.parse(stripConfigComments(readFileSync(file, "utf8"))) as {
        extends?: unknown;
        compilerOptions?: unknown;
      };
    } catch {
      return undefined;
    }
  }
}

function nearestTsconfig(startDir: string): string | undefined {
  const seen: string[] = [];
  let dir = startDir;
  for (;;) {
    const known = nearestTsconfigByDir.get(dir);
    if (known !== undefined || nearestTsconfigByDir.has(dir)) {
      for (const item of seen) nearestTsconfigByDir.set(item, known);
      return known;
    }
    seen.push(dir);
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      for (const item of seen) nearestTsconfigByDir.set(item, candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const item of seen) nearestTsconfigByDir.set(item, undefined);
      return undefined;
    }
    dir = parent;
  }
}

function loadPathConfig(file: string, stack: Set<string>): PathConfig | null {
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  const cached = loadedPathConfig.get(real);
  if (cached !== undefined || loadedPathConfig.has(real)) return cached ?? null;
  if (stack.has(real)) return null;
  stack.add(real);
  const parsed = readConfigObject(real);
  if (!parsed) {
    loadedPathConfig.set(real, null);
    return null;
  }
  const dir = dirname(real);
  let baseDir = dir;
  let paths: Record<string, string[]> | undefined;
  let extendList: unknown[] = [];
  if (Array.isArray(parsed.extends)) extendList = parsed.extends;
  else if (parsed.extends !== undefined) extendList = [parsed.extends];
  for (const entry of extendList) {
    if (typeof entry !== "string" || !entry.startsWith(".")) continue;
    const resolved = resolve(dir, entry);
    let extended: string | undefined;
    if (existsSync(resolved)) extended = resolved;
    else if (existsSync(`${resolved}.json`)) extended = `${resolved}.json`;
    if (!extended) continue;
    const parent = loadPathConfig(extended, stack);
    if (!parent) continue;
    baseDir = parent.baseDir;
    paths = parent.paths;
  }
  const options =
    parsed.compilerOptions && typeof parsed.compilerOptions === "object"
      ? (parsed.compilerOptions as { baseUrl?: unknown; paths?: unknown })
      : undefined;
  if (options && typeof options.baseUrl === "string") baseDir = resolve(dir, options.baseUrl);
  const pathTable = options?.paths;
  if (pathTable && typeof pathTable === "object" && !Array.isArray(pathTable)) {
    const next: Record<string, string[]> = {};
    for (const [pattern, replacements] of Object.entries(pathTable)) {
      if (!Array.isArray(replacements)) continue;
      const targets = replacements.filter((item): item is string => typeof item === "string");
      if (targets.length > 0) next[pattern] = targets;
    }
    paths = next;
  }
  const config = paths ? { baseDir, paths } : null;
  loadedPathConfig.set(real, config);
  return config;
}

function pathsForFile(file: string): PathConfig | null {
  const dir = dirname(file);
  const cached = pathConfigByFileDir.get(dir);
  if (cached !== undefined || pathConfigByFileDir.has(dir)) return cached ?? null;
  const configPath = nearestTsconfig(dir);
  const config = configPath ? loadPathConfig(configPath, new Set()) : null;
  pathConfigByFileDir.set(dir, config);
  return config;
}

function substituteStar(pattern: string, wild: string): string {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern;
  return pattern.slice(0, star) + wild + pattern.slice(star + 1);
}

function mappedPathFile(spec: string, config: PathConfig): string | undefined {
  let winner: { score: number; wild: string; replacements: string[] } | undefined;
  for (const [pattern, replacements] of Object.entries(config.paths)) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern !== spec) continue;
      if (!winner || pattern.length > winner.score) {
        winner = { score: pattern.length, wild: "", replacements };
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    if (spec.length < prefix.length + suffix.length) continue;
    if (winner && prefix.length <= winner.score) continue;
    winner = {
      score: prefix.length,
      wild: spec.slice(prefix.length, spec.length - suffix.length),
      replacements,
    };
  }
  if (!winner) return undefined;
  for (const replacement of winner.replacements) {
    const target = substituteStar(replacement, winner.wild);
    const file = resolveExistingFile(resolve(config.baseDir, target));
    if (!file) continue;
    let real = file;
    try {
      real = realpathSync(file);
    } catch {
      real = file;
    }
    if (real.split(/[/\\]/).includes("node_modules")) continue;
    return file;
  }
  return undefined;
}

function pathAliasStatus(file: string, spec: string): "none" | "file" | "missing" {
  const config = pathsForFile(file);
  if (!config) return "none";
  let matched = false;
  for (const pattern of Object.keys(config.paths)) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern === spec) matched = true;
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        spec.startsWith(prefix) &&
        spec.endsWith(suffix) &&
        spec.length >= prefix.length + suffix.length
      ) {
        matched = true;
      }
    }
    if (matched) break;
  }
  if (!matched) return "none";
  return mappedPathFile(spec, config) ? "file" : "missing";
}

function workspaceGlobs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  const packages = (value as { packages?: unknown }).packages;
  if (!Array.isArray(packages)) return [];
  return packages.filter((item): item is string => typeof item === "string");
}

function workspacePackageDirs(rootDir: string, pattern: string): string[] {
  if (!pattern.includes("*")) {
    const dir = resolve(rootDir, pattern);
    return existsSync(join(dir, "package.json")) ? [dir] : [];
  }
  const star = pattern.indexOf("*");
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const parentRel = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const parent = resolve(rootDir, parentRel === "" ? "." : parentRel);
  let names: string[] = [];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    if (suffix.length > 0 && !name.endsWith(suffix)) continue;
    const dir = join(parent, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(dir, "package.json"))) found.push(dir);
  }
  return found;
}

function readWorkspacePackage(dir: string): WorkspacePackage | undefined {
  let parsed: {
    name?: unknown;
    exports?: unknown;
    types?: unknown;
    module?: unknown;
    main?: unknown;
  };
  try {
    parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as typeof parsed;
  } catch {
    return undefined;
  }
  if (typeof parsed.name !== "string" || parsed.name.length === 0) return undefined;
  return {
    name: parsed.name,
    dir,
    exports: parsed.exports,
    types: typeof parsed.types === "string" ? parsed.types : undefined,
    module: typeof parsed.module === "string" ? parsed.module : undefined,
    main: typeof parsed.main === "string" ? parsed.main : undefined,
  };
}

const workspaceRootByDir = new Map<string, string | undefined>();

function nearestWorkspaceRoot(startDir: string): string | undefined {
  const seen: string[] = [];
  let dir = startDir;
  for (;;) {
    if (workspaceRootByDir.has(dir)) {
      const known = workspaceRootByDir.get(dir);
      for (const item of seen) workspaceRootByDir.set(item, known);
      return known;
    }
    seen.push(dir);
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown };
        if (workspaceGlobs(parsed.workspaces).length > 0) {
          for (const item of seen) workspaceRootByDir.set(item, dir);
          return dir;
        }
      } catch {
        // A broken manifest does not hide a workspace root above it.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const item of seen) workspaceRootByDir.set(item, undefined);
      return undefined;
    }
    dir = parent;
  }
}

function workspacePackages(rootDir: string): WorkspacePackage[] {
  const cached = workspacePackagesByRoot.get(rootDir);
  if (cached) return cached;
  let globs: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
    globs = workspaceGlobs(parsed.workspaces);
  } catch {
    globs = [];
  }
  const packages: WorkspacePackage[] = [];
  for (const pattern of globs) {
    for (const dir of workspacePackageDirs(rootDir, pattern)) {
      const pkg = readWorkspacePackage(dir);
      if (pkg) packages.push(pkg);
    }
  }
  workspacePackagesByRoot.set(rootDir, packages);
  return packages;
}

function conditionTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  if (typeof record.bun === "string") return record.bun;
  if (typeof record.import === "string") return record.import;
  if (typeof record.default === "string") return record.default;
  if (typeof record.types === "string") return record.types;
  return undefined;
}

function exportTarget(exportsField: unknown, subpath: string): string | undefined {
  if (typeof exportsField === "string") return subpath === "." ? exportsField : undefined;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return undefined;
  }
  const table = exportsField as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(table, subpath)) return conditionTarget(table[subpath]);
  let winner: { score: number; target: string } | undefined;
  for (const key of Object.keys(table)) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    const raw = conditionTarget(table[key]);
    if (!raw) continue;
    const wild = subpath.slice(prefix.length, subpath.length - suffix.length);
    if (winner && prefix.length <= winner.score) continue;
    winner = { score: prefix.length, target: substituteStar(raw, wild) };
  }
  return winner?.target;
}

function packageEntry(pkg: WorkspacePackage, subpath: string): string | undefined {
  if (pkg.exports !== undefined) return exportTarget(pkg.exports, subpath);
  if (subpath !== ".") return undefined;
  return pkg.types ?? pkg.module ?? pkg.main;
}

function workspaceFile(startDir: string, spec: string): "none" | "file" | "missing" {
  const rootDir = nearestWorkspaceRoot(startDir);
  if (!rootDir) return "none";
  let owner: WorkspacePackage | undefined;
  let subpath = "";
  for (const pkg of workspacePackages(rootDir)) {
    if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) continue;
    if (owner && pkg.name.length <= owner.name.length) continue;
    owner = pkg;
    subpath = spec === pkg.name ? "." : `./${spec.slice(pkg.name.length + 1)}`;
  }
  if (!owner) return "none";
  const target = packageEntry(owner, subpath);
  if (!target) return "missing";
  const file = resolveExistingFile(resolve(owner.dir, target));
  if (!file) return "missing";
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    real = file;
  }
  if (real.split(/[/\\]/).includes("node_modules")) return "missing";
  return "file";
}

function resolveWorkspaceFile(startDir: string, spec: string): string | undefined {
  const rootDir = nearestWorkspaceRoot(startDir);
  if (!rootDir) return undefined;
  let owner: WorkspacePackage | undefined;
  let subpath = "";
  for (const pkg of workspacePackages(rootDir)) {
    if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) continue;
    if (owner && pkg.name.length <= owner.name.length) continue;
    owner = pkg;
    subpath = spec === pkg.name ? "." : `./${spec.slice(pkg.name.length + 1)}`;
  }
  if (!owner) return undefined;
  const target = packageEntry(owner, subpath);
  if (!target) return undefined;
  return resolveExistingFile(resolve(owner.dir, target));
}

function queueNonRelative(fromFile: string, spec: string, queue: string[], faults: string[]): void {
  const resolved = resolveNonRelative(fromFile, spec);
  if (resolved.kind === "file") queue.push(resolved.file);
  else if (resolved.kind === "missing") faults.push(spec);
}

/** Path aliases and workspace packages are local source. Other bare specifiers are packages. */
function resolveNonRelative(fromFile: string, spec: string): ResolvedSpec {
  if (spec.startsWith("bun:") || spec.startsWith("node:") || spec.startsWith("npm:")) {
    return { kind: "external" };
  }
  const alias = pathAliasStatus(fromFile, spec);
  if (alias === "missing") return { kind: "missing" };
  if (alias === "file") {
    const config = pathsForFile(fromFile);
    const file = config ? mappedPathFile(spec, config) : undefined;
    if (file) return { kind: "file", file };
    return { kind: "missing" };
  }
  const workspace = workspaceFile(dirname(fromFile), spec);
  if (workspace === "none") return { kind: "external" };
  if (workspace === "missing") return { kind: "missing" };
  const file = resolveWorkspaceFile(dirname(fromFile), spec);
  if (!file) return { kind: "missing" };
  return { kind: "file", file };
}

function typeOnlyImport(body: string, fromIndex: number): boolean {
  let depth = 0;
  let keywordAt = -1;
  for (let cursor = fromIndex - 1; cursor >= 0; cursor -= 1) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      const quote = char;
      cursor -= 1;
      while (cursor >= 0 && body[cursor] !== quote) {
        if (body[cursor] === "\\") cursor -= 1;
        cursor -= 1;
      }
      continue;
    }
    if (char === "}" || char === ")") {
      depth += 1;
      continue;
    }
    if (char === "{" || char === "(") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (char === ";") break;
    if (!/[A-Za-z0-9_$]/.test(char)) continue;
    let start = cursor;
    while (start > 0 && /[A-Za-z0-9_$]/.test(body[start - 1] ?? "")) start -= 1;
    const word = body.slice(start, cursor + 1);
    cursor = start;
    if (word === "import" || word === "export") {
      keywordAt = start;
      break;
    }
  }
  if (keywordAt < 0) return false;
  const clause = body.slice(keywordAt, fromIndex);
  const head = clause.trimStart();
  if (head.startsWith("import type") || head.startsWith("export type")) return true;
  const braceAt = clause.indexOf("{");
  if (braceAt < 0) return false;
  const beforeBrace = clause.slice(0, braceAt).replace(/^\s*(?:import|export)\s+/, "");
  if (/[A-Za-z_$]/.test(beforeBrace.replace(/\btype\b/g, ""))) return false;
  const inside = clause.slice(braceAt + 1).replace(/\}[\s\S]*$/, "");
  let sawSpecifier = false;
  for (const part of inside.split(",")) {
    const text = part.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (text.length === 0) continue;
    sawSpecifier = true;
    if (!/^type\s+[A-Za-z_$]/.test(text)) return false;
  }
  return sawSpecifier;
}

type SourceWalk = { bodies: string[]; faults: string[] };

function walkSources(files: readonly string[]): SourceWalk {
  const seen = new Set<string>();
  const bodies: string[] = [];
  const faults: string[] = [];
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || !existsSync(file)) continue;
    const real = realpathSync(file);
    if (seen.has(real)) continue;
    seen.add(real);
    if (real.split(/[/\\]/).includes("node_modules")) continue;
    const body = readFileSync(real, "utf8");
    bodies.push(body);
    const hidden = stringSpans(body);
    for (const match of body.matchAll(RELATIVE_IMPORT)) {
      if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
      const spec = match[1];
      if (!spec) continue;
      const matched = match[0] ?? "";
      if (
        /^import\s*\(/.test(matched) &&
        match.index !== undefined &&
        !argumentBoundary(body, match.index + matched.length)
      ) {
        continue;
      }
      const next = resolveRelativeImport(real, spec);
      if (next) queue.push(next);
    }
    for (const match of body.matchAll(NON_RELATIVE_IMPORT)) {
      if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
      const spec = match[1];
      if (!spec) continue;
      const matched = match[0] ?? "";
      if (/^import\s*\(/.test(matched)) continue;
      if (typeOnlyImport(body, match.index ?? 0)) continue;
      queueNonRelative(real, spec, queue, faults);
    }
    for (const required of localRequireCalls(body, hidden)) {
      if (required.kind === "dynamic") {
        faults.push("dynamic require");
        continue;
      }
      if (!required.spec.startsWith(".")) {
        queueNonRelative(real, required.spec, queue, faults);
        continue;
      }
      const next = resolveRelativeImport(real, required.spec);
      if (!next) {
        faults.push(required.spec);
        continue;
      }
      queue.push(next);
    }
    for (const imported of importCalls(body, hidden)) {
      if (imported.kind === "dynamic") {
        faults.push("dynamic import");
        continue;
      }
      if (!imported.spec.startsWith(".")) {
        queueNonRelative(real, imported.spec, queue, faults);
        continue;
      }
      const next = resolveRelativeImport(real, imported.spec);
      if (!next) {
        faults.push(imported.spec);
        continue;
      }
      queue.push(next);
    }
  }
  return { bodies, faults };
}

/** The file plus local import and `require("./...")` modules, so a helper stays visible. */
export function sourceGraph(files: readonly string[]): string[] {
  return walkSources(files).bodies;
}

/** Relative requires that do not resolve, and requires whose specifier is not a literal. */
export function unresolvedLocalRequires(files: readonly string[]): string[] {
  return walkSources(files).faults;
}
