import { $ } from "bun";
import { dirname } from "path";

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export async function readTextFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

export async function writeTextFile(path: string, body: string): Promise<void> {
  await ensureDir(dirname(path));
  await Bun.write(path, body);
}

export async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`.quiet();
}

export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export async function removePath(path: string): Promise<void> {
  await $`rm -rf ${path}`.quiet();
}

export async function createTempDir(prefix: string): Promise<string> {
  const root = process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  const path = `${root.replace(/\/$/, "")}/${prefix}-${crypto.randomUUID()}`;
  await ensureDir(path);
  return path;
}

export function sha256Hex(value: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

export function runText(args: string[], opts?: { cwd?: string; env?: Record<string, string | undefined> }): string {
  const proc = Bun.spawnSync(args, {
    cwd: opts?.cwd,
    env: opts?.env,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: MAX_CAPTURE_BYTES,
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    const stdout = proc.stdout.toString().trim();
    const detail = stderr || stdout || `command failed with exit code ${proc.exitCode}`;
    throw new Error(detail);
  }

  return proc.stdout.toString();
}
