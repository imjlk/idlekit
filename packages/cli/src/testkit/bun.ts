import { $ } from "bun";
import { dirname, resolve } from "path";

export const CLI_CWD = process.cwd();
export const REPO_ROOT = resolve(CLI_CWD, "../..");
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

type CliRunOptions = Readonly<{
  cwd?: string;
  env?: Record<string, string | undefined>;
  check?: boolean;
  entry?: string;
}>;

export type CliRunResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

function tempRoot(): string {
  return process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
}

export async function createTempDir(prefix: string): Promise<string> {
  const dir = resolve(tempRoot(), `${prefix}-${crypto.randomUUID()}`);
  await $`mkdir -p ${dir}`.quiet();
  return dir;
}

export async function removePath(path: string): Promise<void> {
  await $`rm -rf ${path}`.quiet();
}

export async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

export async function writeText(path: string, body: string): Promise<void> {
  await $`mkdir -p ${dirname(path)}`.quiet();
  await Bun.write(path, body);
}

export async function pathExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export function sha256Hex(value: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

export function runCli(args: string[], opts?: CliRunOptions): CliRunResult {
  const proc = Bun.spawnSync(["bun", opts?.entry ?? "src/main.ts", ...args], {
    cwd: opts?.cwd ?? CLI_CWD,
    env: opts?.env,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: MAX_CAPTURE_BYTES,
  });

  const result = {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  } satisfies CliRunResult;

  if ((opts?.check ?? true) && result.exitCode !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(detail || `CLI command failed with exit code ${result.exitCode}`);
  }

  return result;
}

export function runCliJson<T = any>(args: string[], opts?: CliRunOptions): T {
  return JSON.parse(runCli(args, opts).stdout) as T;
}

export function runCliFailure(args: string[], opts?: Omit<CliRunOptions, "check">): CliRunResult {
  const result = runCli(args, { ...opts, check: false });
  if (result.exitCode === 0) {
    throw new Error("Expected command to fail");
  }
  return result;
}

export async function readSchema(name: string): Promise<object> {
  return readJson<object>(resolve(REPO_ROOT, "docs", "schemas", name));
}

export function runCliJsonFromRepoRoot<T = any>(args: string[]): T {
  return JSON.parse(
    runCli(args, {
      cwd: REPO_ROOT,
      entry: "packages/cli/src/main.ts",
      env: process.env,
    }).stdout,
  ) as T;
}
