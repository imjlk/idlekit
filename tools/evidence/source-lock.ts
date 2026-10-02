import { chmodSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const GUARD = [
  'import fs from "fs";',
  "const locked = new Set();",
  'for (const line of (process.env.IDLEKIT_EVIDENCE_LOCK ?? "").split("\\n")) {',
  "  if (line.length === 0) continue;",
  "  try {",
  "    locked.add(fs.realpathSync(line));",
  "  } catch {",
  "    locked.add(line);",
  "  }",
  "}",
  "function pathOf(value) {",
  '  if (typeof value === "string" || value instanceof URL) return value;',
  '  if (value && typeof value === "object" && typeof value.name === "string") return value.name;',
  "  return undefined;",
  "}",
  "function lockedTarget(value) {",
  "  const target = pathOf(value);",
  "  if (target === undefined) return false;",
  "  try {",
  "    return locked.has(fs.realpathSync(target));",
  "  } catch {",
  "    return false;",
  "  }",
  "}",
  "function reject(value) {",
  '  if (lockedTarget(value)) throw new Error("evidence source is read-only");',
  "}",
  "const write = Bun.write.bind(Bun);",
  "Bun.write = (dest, input) => {",
  "  reject(dest);",
  "  return write(dest, input);",
  "};",
  "const names = [",
  '  "writeFileSync",',
  '  "writeFile",',
  '  "appendFileSync",',
  '  "appendFile",',
  '  "rmSync",',
  '  "unlinkSync",',
  '  "renameSync",',
  '  "copyFileSync",',
  "];",
  "for (const name of names) {",
  "  const original = fs[name];",
  '  if (typeof original !== "function") continue;',
  "  fs[name] = (...args) => {",
  "    reject(args[0]);",
  "    reject(args[1]);",
  "    return original.apply(fs, args);",
  "  };",
  "}",
  "",
].join("\n");

/** `--preload` sits with the test options, before a `--` pattern separator. */
export function preloadTestArgs(args: readonly string[], preload: string): string[] {
  const testAt = args.indexOf("test");
  const flag = ["--preload", preload];
  if (testAt < 0) return [...flag, ...args];
  return [...args.slice(0, testAt + 1), ...flag, ...args.slice(testAt + 1)];
}

export function installSourceLock(
  directory: string,
  files: readonly string[],
): { preload: string; env: string } {
  const preload = join(directory, "source-lock.mjs");
  writeFileSync(preload, GUARD);
  return { preload, env: files.join("\n") };
}

export function sourceDigests(files: readonly string[]): Map<string, string> {
  const digests = new Map<string, string>();
  for (const file of files) digests.set(file, Bun.hash(readFileSync(file)).toString());
  return digests;
}

export function changedSources(digests: ReadonlyMap<string, string>): string[] {
  const changed: string[] = [];
  for (const [file, digest] of digests) {
    let next = "";
    try {
      next = Bun.hash(readFileSync(file)).toString();
    } catch {
      next = "";
    }
    if (next !== digest) changed.push(file);
  }
  return changed;
}

/** Clear write bits so a test cannot replace a file the scanner already read. */
export function sealSources(files: readonly string[]): Map<string, number> {
  const modes = new Map<string, number>();
  try {
    for (const file of files) {
      const mode = statSync(file).mode;
      modes.set(file, mode);
      chmodSync(file, mode & ~0o222);
    }
  } catch (error) {
    unsealSources(modes);
    throw error;
  }
  return modes;
}

export function unsealSources(modes: ReadonlyMap<string, number>): void {
  for (const [file, mode] of modes) {
    try {
      chmodSync(file, mode);
    } catch {
      continue;
    }
  }
}
