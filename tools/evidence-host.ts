import { basename, join, resolve } from "path";
import { installedCompilerBin, ttsxLauncherPath } from "./compiler-bin";

export const root = resolve(import.meta.dir, "..");

/** Use the launcher installed by Bun or npm for this platform. */
export function compilerBinName(
  name: "ttsc" | "tsc",
  platform: NodeJS.Platform = process.platform,
): string {
  return basename(installedCompilerBin(root, name, platform));
}

export const ttscBin = join(root, "node_modules", ".bin", compilerBinName("ttsc"));

/** Windows needs the `.cmd` shim. The extensionless file is the POSIX launcher. */
export function ttsxUnderNodeName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "ttsx-under-node.cmd" : "ttsx-under-node";
}

export type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function evidenceEnv(cacheDir?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.TTSC_GRAPH_BINARY;
  delete env.TTSC_GO_BINARY;
  env.TTSC_TTSX_BINARY = ttsxLauncherPath(root);
  if (cacheDir) env.TTSC_CACHE_DIR = cacheDir;
  else delete env.TTSC_CACHE_DIR;
  return env;
}

export function runTtsc(args: string[], cwd = root, cacheDir?: string): CommandResult {
  const expectedBin = join("node_modules", ".bin", compilerBinName("ttsc"));
  if (!ttscBin.endsWith(expectedBin)) {
    throw new Error(`refusing non-ttsc command: ${ttscBin}`);
  }
  const commandArgs = [ttscBin, ...args];
  const proc = Bun.spawnSync(commandArgs, {
    cwd,
    env: evidenceEnv(cacheDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    command: commandArgs.join(" "),
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export function commandText(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}
