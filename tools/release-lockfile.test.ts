import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { preserveReleaseLockfile, releaseWorkspaces, verifyReleaseLockfile } from "./release-lockfile";

const snapshot: Record<string, any> = {
  lockfileVersion: 1,
  configVersion: 1,
  workspaces: {
    "": { name: "fixture", dependencies: { dependency: "^1.0.0" } },
    ...Object.fromEntries(releaseWorkspaces.map((path) => [path, { name: path, version: "0.1.1", dependencies: { dependency: "^1.0.0" } }])),
  },
  packages: { dependency: ["dependency@1.0.0", "", { dependencies: { nested: "^1.0.0" } }, "sha512-fixture"] },
};
const versions = Object.fromEntries(releaseWorkspaces.map((path) => [path, "0.2.0"]));
function prepared(): any {
  const next = structuredClone(snapshot);
  for (const workspace of releaseWorkspaces) next.workspaces[workspace]!.version = versions[workspace]!;
  return next;
}
function verify(next: unknown): void {
  verifyReleaseLockfile(JSON.stringify(snapshot), JSON.stringify(next), versions);
}

it("allows workspace version updates while preserving every resolved package", () => {
  expect(() => verify(prepared())).not.toThrow();
});

it("rejects changed versions, integrity, dependency edges, added packages, and removed packages", () => {
  for (const mutate of [
    (next: any) => { next.packages.dependency[0] = "dependency@1.1.0"; },
    (next: any) => { next.packages.dependency[3] = "sha512-other"; },
    (next: any) => { next.packages.dependency[2].dependencies.nested = "^2.0.0"; },
    (next: any) => { next.packages.extra = ["extra@1.0.0"]; },
    (next: any) => { delete next.packages.dependency; },
  ]) {
    const next = prepared();
    mutate(next);
    expect(() => verify(next)).toThrow("dependency upgrades require a separate PR");
  }
});

it("rejects changes outside workspace versions and a manifest/version mismatch", () => {
  const changedRoot = prepared();
  changedRoot.workspaces[""].dependencies.dependency = "^2.0.0";
  expect(() => verify(changedRoot)).toThrow("locked dependency data");
  const changedWorkspace = prepared();
  changedWorkspace.workspaces[releaseWorkspaces[0]].dependencies.dependency = "^2.0.0";
  expect(() => verify(changedWorkspace)).toThrow("locked dependency data");
  const mismatchedVersion = prepared();
  mismatchedVersion.workspaces[releaseWorkspaces[0]].version = "0.3.0";
  expect(() => verify(mismatchedVersion)).toThrow("version does not match");
});

it("rejects malformed workspace metadata", () => {
  for (const next of [null, [], { workspaces: null }, { workspaces: { "packages/core": "invalid" } }]) {
    expect(() => verify(next)).toThrow("Invalid release lockfile workspace metadata");
  }
});

it("hides the lockfile from Sampo and restores it byte-for-byte if release preparation fails", async () => {
  const prefix = resolve(tmpdir(), "idlekit-release-lock-");
  const fixture = await mkdtemp(prefix);
  const lockPath = resolve(fixture, "bun.lock");
  const original = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(snapshot))]);
  try {
    await Bun.write(lockPath, original);
    await expect(preserveReleaseLockfile(fixture, async () => {
      expect(await Bun.file(lockPath).exists()).toBeFalse();
      await Bun.write(lockPath, "partial lockfile from a failed release");
      throw new Error("fixture release failed");
    })).rejects.toThrow("fixture release failed");
    expect(new Uint8Array(await Bun.file(lockPath).arrayBuffer())).toEqual(original);
  } finally {
    if (!resolve(fixture).startsWith(prefix)) throw new Error("Unexpected release fixture path");
    await rm(fixture, { recursive: true, force: true });
  }
});
