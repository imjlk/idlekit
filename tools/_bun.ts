import { $ } from "bun";
import { dirname, resolve } from "path";

export const ROOT = process.cwd();
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export function runText(args: string[], opts?: { cwd?: string; env?: Record<string, string | undefined> }): string {
  const proc = Bun.spawnSync(args, {
    cwd: opts?.cwd ?? ROOT,
    env: opts?.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: MAX_CAPTURE_BYTES,
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    const stdout = proc.stdout.toString().trim();
    throw new Error(stderr || stdout || `command failed with exit code ${proc.exitCode}`);
  }

  return proc.stdout.toString();
}

export function runJson<T = unknown>(
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
): T {
  return JSON.parse(runText(args, opts)) as T;
}

export async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`.quiet();
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
  await ensureDir(dirname(path));
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

export async function createTempDir(prefix: string, baseDir = resolve(ROOT, "tmp")): Promise<string> {
  await ensureDir(baseDir);
  const path = resolve(baseDir, `${prefix}-${crypto.randomUUID()}`);
  await ensureDir(path);
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFileLock<T>(
  key: string,
  run: () => Promise<T>,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const pollMs = opts?.pollMs ?? 100;
  const lockDir = resolve(ROOT, "tmp", ".locks", key.replace(/[^a-zA-Z0-9._-]/g, "_"));
  const startedAt = Date.now();

  await ensureDir(dirname(lockDir));

  while (true) {
    const proc = Bun.spawnSync(["mkdir", lockDir], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
    if (proc.exitCode === 0) break;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for lock: ${key}`);
    }
    await sleep(pollMs);
  }

  try {
    return await run();
  } finally {
    await removePath(lockDir);
  }
}
