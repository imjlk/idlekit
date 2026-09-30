import { join, resolve } from "path";

export const root = resolve(import.meta.dir, "..");
export const ttscBin = join(root, "node_modules", ".bin", "ttsc");

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
  env.TTSC_TTSX_BINARY = join(root, "tools", "ttsx-under-node");
  if (cacheDir) env.TTSC_CACHE_DIR = cacheDir;
  else delete env.TTSC_CACHE_DIR;
  return env;
}

export function runTtsc(args: string[], cwd = root, cacheDir?: string): CommandResult {
  if (!ttscBin.endsWith(join("node_modules", ".bin", "ttsc"))) {
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
