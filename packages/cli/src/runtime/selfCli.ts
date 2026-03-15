function currentEntry(): string {
  return Bun.main;
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export function selfCliCommand(args: readonly string[]) {
  return [process.argv[0] ?? "bun", currentEntry(), ...args];
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
