import { AsyncLocalStorage } from "async_hooks";
import { resolve } from "path";

type Invocation = Readonly<{
  positional: readonly string[];
  flags: Readonly<Record<string, unknown>>;
  /** Files the command has read so far, including ones named inside another input. */
  reads: Set<string>;
}>;

// Flags whose value names a file the command reads. A value of any other flag, such as --format json or
// --run-id, is never a path, so an existing file with that name stays writable.
const INPUT_FLAGS = new Set([
  "scenario", "baseline", "current", "baseline-artifact", "tune", "checks", "rubric", "cache", "resume", "rc",
  "plugin-trust-file",
]);
const LIST_FLAGS = new Set(["plugin"]);

const storage = new AsyncLocalStorage<Invocation>();

/** Run a command handler with its parsed arguments visible to output writers. */
export function runWithInvocation<T>(invocation: Omit<Invocation, "reads">, fn: () => T): T {
  return storage.run({ ...invocation, reads: new Set() }, fn);
}

/** Note a file the current command read, so no output of the same command replaces it. */
export function recordInputRead(path: string): void {
  storage.getStore()?.reads.add(resolve(path));
}

function flagPaths(key: string, value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  if (LIST_FLAGS.has(key)) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return INPUT_FLAGS.has(key) ? [value] : [];
}

/**
 * Note the inputs of a command this one runs in another process, such as the run a replay artifact records.
 * Paths resolve against `base`, the directory that command resolved them from.
 */
export function recordNestedInputs(base: string, positional: readonly string[], flags: Readonly<Record<string, unknown>>): void {
  for (const value of positional) if (value.length > 0) recordInputRead(resolve(base, value));
  for (const [key, value] of Object.entries(flags)) for (const path of flagPaths(key, value)) recordInputRead(resolve(base, path));
}

/**
 * Paths the current command may have read: every positional, every input flag, and every file read
 * through the CLI readers, such as a scenario named by an experiment spec or a plugin's local import.
 * Output writers protect the ones that exist. `allow` names input flags the output may replace on purpose.
 */
export function invocationInputCandidates(options: { allow?: readonly string[] } = {}): string[] {
  const invocation = storage.getStore();
  if (!invocation) return [];
  const allow = new Set(options.allow ?? []);
  const allowed = new Set<string>();
  const candidates = invocation.positional.filter((value) => value.length > 0);
  for (const [key, value] of Object.entries(invocation.flags)) {
    const paths = flagPaths(key, value);
    if (allow.has(key)) for (const path of paths) allowed.add(resolve(path));
    else candidates.push(...paths);
  }
  for (const path of invocation.reads) if (!allowed.has(path)) candidates.push(path);
  return candidates;
}
