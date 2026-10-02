import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";

import { type InventoryTest } from "./model";

export function commandTargetsFile(test: InventoryTest): boolean {
  if (test.args[0] !== "test") return false;
  return commandedTestFiles(test.args).some((target) =>
    sameCommandFile(test.cwd, target, test.file),
  );
}

const PRELOAD_FLAGS = ["--preload", "--require", "--import"] as const;

function exactPreloadFlag(arg: string): boolean {
  return arg === "--preload" || arg === "--require" || arg === "--import" || arg === "-r";
}

/** `--preload=./setup`, `-r=./setup`, and the attached `-r./setup` form. */
function preloadValue(arg: string): string | undefined {
  for (const flag of PRELOAD_FLAGS) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  if (!arg.startsWith("-r") || arg.length < 3) return undefined;
  const marker = arg[2];
  if (marker === "=") return arg.slice(3);
  if (marker !== undefined && !/[A-Za-z0-9_]/.test(marker)) return arg.slice(2);
  return undefined;
}

/** Modules imported before the test files. They are not test targets. */
function preloadArguments(args: readonly string[]): string[] {
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    if (exactPreloadFlag(arg)) {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        files.push(next);
        index += 1;
      }
      continue;
    }
    const inline = preloadValue(arg);
    if (inline !== undefined) files.push(inline);
  }
  return files;
}

const TEST_VALUE_FLAGS = new Set([
  "-t",
  "--bail",
  "--coverage-dir",
  "--coverage-reporter",
  "--max-concurrency",
  "--reporter",
  "--reporter-outfile",
  "--rerun-each",
  "--retry",
  "--seed",
  "--test-name-pattern",
  "--timeout",
]);

const BLOCKED_TEST_FLAGS = new Set([
  "--watch",
  "-u",
  "--update-snapshots",
  "--cwd",
  "--inspect-wait",
  "--inspect-brk",
]);

/** Flags that hang the run, rewrite snapshots, or move Bun to another cwd. */
export function blockedTestArgs(args: readonly string[]): string | undefined {
  let patterns = false;
  for (const arg of args) {
    if (!patterns && arg === "--") {
      patterns = true;
      continue;
    }
    if (patterns) continue;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (BLOCKED_TEST_FLAGS.has(name)) return name;
  }
  return undefined;
}

/** `--flag value` consumes the value. `--flag=value` and boolean flags do not. */
function consumesTestValue(flag: string, next: string | undefined): boolean {
  if (next === undefined || !TEST_VALUE_FLAGS.has(flag)) return false;
  if (flag === "--bail") return /^\d+$/.test(next);
  return !next.startsWith("-");
}

function commandedTestFiles(args: readonly string[]): string[] {
  const files: string[] = [];
  let patterns = false;
  let skippedCommand = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!skippedCommand && !patterns && arg === "test") {
      skippedCommand = true;
      continue;
    }
    if (!patterns && arg === "--") {
      patterns = true;
      continue;
    }
    if (!patterns && (exactPreloadFlag(arg) || arg === "--config")) {
      index += 1;
      continue;
    }
    if (!patterns && (preloadValue(arg) !== undefined || arg.startsWith("--config="))) continue;
    if (!patterns && arg.startsWith("-")) {
      const equals = arg.indexOf("=");
      const flag = equals === -1 ? arg : arg.slice(0, equals);
      if (equals === -1 && consumesTestValue(flag, args[index + 1])) index += 1;
      continue;
    }
    files.push(arg.replaceAll("\\", "/"));
  }
  return files;
}

export function sameCommandFile(cwd: string, target: string, inventoried: string): boolean {
  const wanted = target.replaceAll("\\", "/").replace(/^\.\//, "");
  const file = inventoried.replaceAll("\\", "/");
  const fromCwd = relative(cwd, file).replaceAll("\\", "/");
  if (wanted === file || wanted === fromCwd) return true;
  if (!isAbsolute(target)) return false;
  return resolve(target) === resolve(cwd, fromCwd);
}

/** Test paths named by the command that are not already inventory entries for that command. */
export function uninventoriedCommandTargets(
  args: readonly string[],
  cwd: string,
  inventoried: readonly string[],
): string[] {
  return commandedTestFiles(args).filter(
    (target) => !inventoried.some((file) => sameCommandFile(cwd, target, file)),
  );
}

function configArgument(args: readonly string[]): string | undefined {
  let patterns = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!patterns && arg === "--") {
      patterns = true;
      continue;
    }
    if (patterns) continue;
    if (arg === "--config") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) return "";
      return next;
    }
    if (arg.startsWith("--config=")) return arg.slice("--config=".length);
  }
  return undefined;
}

function bunfigSelection(
  cwd: string,
  args: readonly string[],
): { path: string } | { missing: string } | undefined {
  const selected = configArgument(args);
  if (selected === undefined) {
    const path = join(cwd, "bunfig.toml");
    if (!existsSync(path)) return undefined;
    return { path };
  }
  if (selected.length === 0) return { missing: "--config" };
  const path = isAbsolute(selected) ? selected : resolve(cwd, selected);
  if (!existsSync(path)) return { missing: selected };
  return { path };
}

const PRELOAD_KEY = /(?:preload|"preload"|'preload')/;

function preloadNamesIn(text: string): string[] {
  const names: string[] = [];
  const listed = new RegExp(`${PRELOAD_KEY.source}\\s*=\\s*\\[([^\\]]*)\\]`, "g");
  const scalar = new RegExp(`${PRELOAD_KEY.source}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "g");
  for (const match of text.matchAll(listed)) {
    for (const item of match[1]?.matchAll(/"([^"]+)"|'([^']+)'/g) ?? []) {
      const value = item[1] ?? item[2];
      if (value) names.push(value);
    }
  }
  for (const match of text.matchAll(scalar)) {
    const value = match[1] ?? match[2];
    if (value) names.push(value);
  }
  return names;
}

function preloadNames(cwd: string, args: readonly string[]): string[] {
  const names = preloadArguments(args);
  const selected = bunfigSelection(cwd, args);
  if (!selected || "missing" in selected) return names;
  names.push(...preloadNamesIn(readFileSync(selected.path, "utf8")));
  return names;
}

function resolvePreload(cwd: string, name: string): string | undefined {
  const direct = resolve(cwd, name);
  if (existsSync(direct)) return direct;
  if (isAbsolute(name) || name.startsWith(".")) return undefined;
  try {
    return Bun.resolveSync(name, cwd);
  } catch {
    return undefined;
  }
}

/** Files Bun loads before the tests, including a package entry such as `test-setup`. */
export function localPreloadFiles(cwd: string, args: readonly string[]): string[] {
  const files: string[] = [];
  for (const name of preloadNames(cwd, args)) {
    const resolved = resolvePreload(cwd, name);
    if (resolved) files.push(resolved);
  }
  return files;
}

/** Preloads that do not resolve to a file, so their registrations cannot be scanned. */
export function unresolvedPreloadSpecifiers(cwd: string, args: readonly string[]): string[] {
  const missing = preloadNames(cwd, args).filter((name) => resolvePreload(cwd, name) === undefined);
  const selected = bunfigSelection(cwd, args);
  if (selected && "missing" in selected) missing.unshift(selected.missing);
  return missing;
}
