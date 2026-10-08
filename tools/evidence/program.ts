import { readFileSync, realpathSync } from "fs";
import { dirname, join, relative } from "path";
import { compilerBinName } from "../evidence-host";

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function fail(failures: string[], message: string): void {
  failures.push(message);
}

export async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for await (const file of glob.scan({ cwd, onlyFiles: true })) matches.push(file.replaceAll("\\", "/"));
  matches.sort();
  return matches;
}

export async function assertNonEmptyGlobs(patterns: readonly string[], cwd: string): Promise<string[]> {
  const failures: string[] = [];
  for (const pattern of patterns) {
    if (pattern.trim().length === 0) {
      fail(failures, "evidence glob is empty");
      continue;
    }
    const matches = await expandGlob(pattern, cwd);
    if (matches.length === 0) fail(failures, `evidence glob matched no files: ${pattern}`);
  }
  return failures;
}

export async function includedSourceCount(tsconfigPath: string): Promise<number> {
  const project = readJson<{ include?: string[]; files?: string[] }>(tsconfigPath);
  const patterns = [...(project.files ?? []), ...(project.include ?? [])];
  if (patterns.length === 0) return 0;
  const cwd = dirname(tsconfigPath);
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.trim().length === 0) continue;
    for (const file of await expandGlob(pattern, cwd)) {
      if (file.endsWith(".ts") || file.endsWith(".tsx")) count += 1;
    }
  }
  return count;
}

export function omittedProgramHosts(programFiles: readonly string[], hosts: readonly string[]): string[] {
  const present = new Set(programFiles);
  return hosts.filter((host) => !present.has(host));
}

/** Source files of the evidence program, including imports of the included roots. */
export function evidenceProgramSourceFiles(tsconfigPath: string): string[] {
  const base = realpathSync(dirname(tsconfigPath));
  const tsc = join(base, "node_modules", ".bin", compilerBinName("tsc"));
  const proc = Bun.spawnSync(
    [tsc, "-p", tsconfigPath, "--listFilesOnly", "--noEmit", "--pretty", "false"],
    { cwd: base, stdout: "pipe", stderr: "pipe" },
  );
  const stdout = proc.stdout.toString();
  if ((proc.exitCode ?? 1) !== 0 && stdout.trim().length === 0) {
    throw new Error(proc.stderr.toString() || "tsc --listFilesOnly failed");
  }
  const files: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("/node_modules/") || trimmed.endsWith(".d.ts")) continue;
    const rel = relative(base, realpathSync(trimmed)).replaceAll("\\", "/");
    if (rel.startsWith("..")) continue;
    files.push(rel);
  }
  return files;
}
