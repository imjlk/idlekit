import { AsyncLocalStorage } from "async_hooks";

type Invocation = Readonly<{ positional: readonly string[]; flags: Readonly<Record<string, unknown>> }>;

// Flags that name files the command writes. Every other string flag may name an input.
const OUTPUT_FLAGS = new Set(["out", "out-dir", "state-out", "artifact-out", "tune-out", "trust-out"]);
const LIST_FLAGS = new Set(["plugin"]);

const storage = new AsyncLocalStorage<Invocation>();

/** Run a command handler with its parsed arguments visible to output writers. */
export function runWithInvocation<T>(invocation: Invocation, fn: () => T): T {
  return storage.run(invocation, fn);
}

/**
 * Paths the current command may have read: every positional and every string flag that is not an
 * output flag. Output writers protect the ones that exist, so a value that is not a path costs nothing.
 */
export function invocationInputCandidates(options: { allow?: readonly string[] } = {}): string[] {
  const invocation = storage.getStore();
  if (!invocation) return [];
  const allow = new Set(options.allow ?? []);
  const candidates = [...invocation.positional];
  for (const [key, value] of Object.entries(invocation.flags)) {
    if (OUTPUT_FLAGS.has(key) || allow.has(key) || typeof value !== "string" || !value.trim()) continue;
    if (LIST_FLAGS.has(key)) candidates.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    else candidates.push(value);
  }
  return candidates.filter((candidate) => candidate.length > 0);
}
