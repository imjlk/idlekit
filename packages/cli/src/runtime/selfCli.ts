import { existsSync } from "fs";
import { dirname, resolve } from "path";

function currentEntry(): string {
  return Bun.main;
}

const CLI_ROOT = resolve(import.meta.dir, "../..");
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function isJavaScriptEntry(entry: string): boolean {
  return entry.endsWith(".js") || entry.endsWith(".mjs");
}

function isNativeEntry(entry: string): boolean {
  return entry.includes("$bunfs") || entry.includes("~BUN");
}

export function isBundledCliProcess(entry = currentEntry()): boolean {
  return isJavaScriptEntry(entry) || isNativeEntry(entry);
}

export function cliPackageRoot(entry = currentEntry()): string {
  // Native executables have no source package directory on the filesystem.
  if (isNativeEntry(entry)) return process.cwd();
  if (isBundledCliProcess(entry)) return resolve(dirname(entry), "..");
  return resolve(import.meta.dir, "../..");
}

function bundledCliConfig(entry: string): string | undefined {
  const config = resolve(dirname(entry), "../../../tools/bundled-cli-bunfig.toml");
  if (!existsSync(config)) return undefined;
  return config;
}

export function selfCliCommand(args: readonly string[], entry = currentEntry()) {
  if (isNativeEntry(entry)) return [process.execPath, ...args];
  const bun = process.argv[0] ?? "bun";
  if (isJavaScriptEntry(entry)) {
    const config = bundledCliConfig(entry);
    if (config) return [bun, `--config=${config}`, entry, ...args];
    return [bun, entry, ...args];
  }
  const bunfigApplies = resolve(process.cwd()) === CLI_ROOT;
  if (entry.endsWith(".ts") && !bunfigApplies) {
    return [bun, "--preload", "@ttsc/unplugin/bun-register", entry, ...args];
  }
  return [bun, entry, ...args];
}

export function runSelfCli(args: readonly string[]): Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawnSync(selfCliCommand(args), {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
    maxBuffer: MAX_CAPTURE_BYTES,
  });

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export function runSelfCliJson<T = unknown>(args: readonly string[]): T {
  const result = runSelfCli(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `CLI command failed with exit code ${result.exitCode}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    const excerpt = result.stdout.slice(0, 400);
    throw new Error(`JSON Parse error: ${error instanceof Error ? error.message : String(error)}\nSTDOUT:\n${excerpt}`);
  }
}
