import { resolve } from "path";

export const releaseWorkspaces = ["packages/money", "packages/core", "packages/cli"] as const;

type Lockfile = Record<string, unknown> & { workspaces: Record<string, Record<string, unknown>> };
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseLockfile(text: string): Lockfile {
  const value = Bun.JSONC.parse(text);
  if (!isRecord(value) || !isRecord(value.workspaces) || !Object.values(value.workspaces).every(isRecord)) {
    throw new Error("Invalid release lockfile workspace metadata");
  }
  return value as Lockfile;
}

/** Release preparation may change workspace versions, but no other lockfile data. */
export function verifyReleaseLockfile(beforeText: string, afterText: string, versions: Readonly<Record<string, string>>): void {
  const before = parseLockfile(beforeText);
  const after = parseLockfile(afterText);
  for (const [workspace, version] of Object.entries(versions)) {
    const previous = before.workspaces[workspace];
    const next = after.workspaces[workspace];
    if (!previous || !next || next.version !== version) {
      throw new Error(`Release lockfile version does not match the manifest for ${workspace}`);
    }
    if (previous.version === undefined) delete next.version;
    else next.version = previous.version;
  }
  if (!Bun.deepEquals(before, after, true)) {
    throw new Error("Release preparation changed locked dependency data; dependency upgrades require a separate PR");
  }
}

function run(command: string[], projectRoot: string, env = process.env): void {
  const result = Bun.spawnSync(command, { cwd: projectRoot, env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} ${command[1]} failed (exit ${result.exitCode})`);
}

export async function refreshReleaseLockfile(snapshot: string | Uint8Array, projectRoot: string): Promise<void> {
  const beforeText = typeof snapshot === "string" ? snapshot : new TextDecoder().decode(snapshot);
  const lockPath = resolve(projectRoot, "bun.lock");
  await Bun.write(lockPath, snapshot);
  try {
    run([process.execPath, "install", "--lockfile-only", "--ignore-scripts"], projectRoot);
    const versions: Record<string, string> = {};
    for (const workspace of releaseWorkspaces) {
      const manifest = await Bun.file(resolve(projectRoot, workspace, "package.json")).json();
      if (typeof manifest.version !== "string") throw new Error(`Missing version in ${workspace}/package.json`);
      versions[workspace] = manifest.version;
    }
    verifyReleaseLockfile(beforeText, await Bun.file(lockPath).text(), versions);
    run([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], projectRoot);
  } catch (error) {
    await Bun.write(lockPath, snapshot);
    throw error;
  }
  console.log("Release lockfile preserves dependency resolutions and matches workspace versions");
}

/** Sampo skips its bun update when no lockfile is present. Always restore the snapshot on failure. */
export async function preserveReleaseLockfile(projectRoot: string, release: () => void | Promise<void>): Promise<void> {
  const lockPath = resolve(projectRoot, "bun.lock");
  const snapshot = new Uint8Array(await Bun.file(lockPath).arrayBuffer());
  await Bun.file(lockPath).delete();
  try {
    await release();
  } finally {
    await Bun.write(lockPath, snapshot);
  }
  await refreshReleaseLockfile(snapshot, projectRoot);
}

if (import.meta.main) {
  const projectRoot = resolve(import.meta.dir, "..");
  const mode = process.argv[2];
  if (mode === "release") {
    run([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], projectRoot);
    await preserveReleaseLockfile(projectRoot, () => {
      run(["sampo", "release", ...process.argv.slice(3)], projectRoot, { ...process.env, SAMPO_RELEASE_BRANCH: "main" });
    });
  } else if (mode === "publish") {
    // Without bun.lock, Sampo selects npm publish, which supports trusted publishing.
    await preserveReleaseLockfile(projectRoot, () => {
      run(["sampo", "publish", ...process.argv.slice(3)], projectRoot, { ...process.env, SAMPO_RELEASE_BRANCH: "main" });
    });
  } else if (mode === "refresh" && process.argv.length === 4) {
    await refreshReleaseLockfile(new Uint8Array(await Bun.file(process.argv[3]!).arrayBuffer()), projectRoot);
  } else {
    throw new Error("Usage: bun tools/release-lockfile.ts release|publish [--dry-run] | refresh <snapshot>");
  }
}
