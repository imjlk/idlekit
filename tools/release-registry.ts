import { appendFileSync, readdirSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { resolve } from "path";
import { releaseWorkspaces } from "./release-lockfile";

const ROOT = resolve(import.meta.dir, "..");
const REGISTRY = "https://registry.npmjs.org";
const DEPENDENCY_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
/** Versions published locally before the package could trust this workflow carry no provenance. */
export const PROVENANCE_EXEMPT: ReadonlySet<string> = new Set(["@idlekit/money@0.2.0"]);

function semverParts(version: string): [number, number, number, string?] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) throw new Error(`unsupported semver format: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? undefined];
}

export function compareSemver(a: string, b: string): number {
  const ap = semverParts(a);
  const bp = semverParts(b);
  for (const i of [0, 1, 2] as const) {
    if (ap[i] !== bp[i]) return ap[i] - bp[i];
  }
  if (ap[3] === bp[3]) return 0;
  if (!ap[3]) return 1;
  if (!bp[3]) return -1;
  return comparePrerelease(ap[3].slice(1), bp[3].slice(1));
}

/** SemVer 2.0.0 §11: numeric identifiers compare numerically and sort before alphanumeric ones. */
function comparePrerelease(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const [x, y] = [as[i]!, bs[i]!];
    if (x === y) continue;
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return as.length - bs.length;
}

/** `latest` is the registry's `latest` dist-tag, or null for a package npm does not have yet. */
export type ReleaseVersion = Readonly<{ name: string; version: string; published: boolean; latest: string | null }>;
export type PublishPlan = Readonly<{ publish: boolean; verify: boolean; reason: string }>;

/**
 * A push to main publishes once the release PR has consumed every changeset and some
 * package version is not on npm yet. A push that still has changesets, or whose commit
 * is no longer the head of main, leaves publication to a later run. A manual run is an
 * explicit request, so the same conditions fail it; when npm already has every version,
 * for example after a run that uploaded and then failed, it only verifies the registry.
 */
export function planPublication(input: Readonly<{
  manual: boolean;
  pendingChangesets: number;
  selectedIsMain: boolean;
  versions: readonly ReleaseVersion[];
}>): PublishPlan {
  const skip = (reason: string): PublishPlan => {
    if (input.manual) throw new Error(reason);
    return { publish: false, verify: false, reason };
  };
  if (input.pendingChangesets > 0) {
    return skip(`${input.pendingChangesets} pending changeset(s); merge the release PR to publish.`);
  }
  if (!input.selectedIsMain) return skip("main moved past this commit; the newer run decides publication.");
  const pending = input.versions.filter((entry) => !entry.published);
  // npm tags a publish `latest` by default, so an older unpublished version would move it backward.
  const older = pending.filter((entry) => entry.latest !== null && compareSemver(entry.version, entry.latest) < 0);
  if (older.length > 0) {
    throw new Error(older.map((entry) => `${entry.name}@${entry.version} is older than npm latest ${entry.latest}`).join("\n"));
  }
  if (pending.length === 0) {
    if (input.manual) return { publish: false, verify: true, reason: "every package version is already on npm; verifying the registry only." };
    return skip("every package version is already on npm.");
  }
  return { publish: true, verify: true, reason: `publishing ${pending.map((entry) => `${entry.name}@${entry.version}`).join(", ")}` };
}

type RegistryManifest = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, string>>> & {
  dist?: { attestations?: { provenance?: { predicateType?: string } } };
};

/** What installers read from the registry, not the tarball: workspace specs here break installs. */
export function checkRegistryManifest(id: string, manifest: RegistryManifest, requireProvenance: boolean): string[] {
  const problems = DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(manifest[section] ?? {})
      .filter(([, spec]) => spec.startsWith("workspace:"))
      .map(([name, spec]) => `${id} lists ${section}.${name}=${spec} in its registry metadata`),
  );
  if (requireProvenance && !manifest.dist?.attestations?.provenance?.predicateType) {
    problems.push(`${id} has no provenance attestation`);
  }
  return problems;
}

async function releaseManifests(): Promise<Array<{ name: string; version: string }>> {
  const out: Array<{ name: string; version: string }> = [];
  for (const workspace of releaseWorkspaces) {
    const manifest = await Bun.file(resolve(ROOT, workspace, "package.json")).json();
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error(`Missing name or version in ${workspace}/package.json`);
    }
    out.push({ name: manifest.name, version: manifest.version });
  }
  return out;
}

function registryPath(name: string): string {
  return name.replaceAll("/", "%2f");
}

async function fetchPackage(name: string): Promise<{ versions: string[]; latest: string | null } | null> {
  const response = await fetch(`${REGISTRY}/${registryPath(name)}`, {
    headers: { accept: "application/vnd.npm.install-v1+json", "cache-control": "no-cache" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}`);
  const packument = (await response.json()) as { versions?: Record<string, unknown>; "dist-tags"?: { latest?: string } };
  return { versions: Object.keys(packument.versions ?? {}), latest: packument["dist-tags"]?.latest ?? null };
}

async function fetchVersion(name: string, version: string): Promise<RegistryManifest | null> {
  const response = await fetch(`${REGISTRY}/${registryPath(name)}/${version}`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}@${version}`);
  return (await response.json()) as RegistryManifest;
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function writeOutputs(values: Record<string, string>): void {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(lines);
}

async function plan(): Promise<void> {
  const selected = process.env.SELECTED_SHA || git(["rev-parse", "HEAD"]);
  const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
  const pendingChangesets = readdirSync(resolve(ROOT, ".sampo/changesets")).filter((file) => file.endsWith(".md")).length;
  const versions: ReleaseVersion[] = [];
  for (const { name, version } of await releaseManifests()) {
    const registry = await fetchPackage(name);
    versions.push({ name, version, published: registry?.versions.includes(version) ?? false, latest: registry?.latest ?? null });
  }
  const result = planPublication({
    manual: process.env.RELEASE_EVENT === "workflow_dispatch",
    pendingChangesets,
    selectedIsMain: remoteMain === selected,
    versions,
  });
  console.log(result.reason);
  writeOutputs({ publish: String(result.publish), verify: String(result.verify) });
}

async function verify(): Promise<void> {
  const deadline = Date.now() + Number(process.env.REGISTRY_WAIT_SEC ?? 900) * 1000;
  const manifests = await releaseManifests();
  const problems: string[] = [];
  for (const { name, version } of manifests) {
    const id = `${name}@${version}`;
    let manifest = await fetchVersion(name, version);
    // A new version can take minutes to appear in the registry's read path.
    while (!manifest && Date.now() < deadline) {
      await Bun.sleep(20_000);
      manifest = await fetchVersion(name, version);
    }
    if (!manifest) throw new Error(`${id} did not appear on the npm registry`);
    // Every current version is checked, so a retry also covers uploads from a failed earlier attempt.
    problems.push(...checkRegistryManifest(id, manifest, !PROVENANCE_EXEMPT.has(id)));
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const project = await mkdtemp(resolve(tmpdir(), "idlekit-registry-smoke-"));
  try {
    await Bun.write(resolve(project, "package.json"), `${JSON.stringify({ name: "registry-smoke", private: true })}\n`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const install = Bun.spawnSync(
      [npm, "install", "--no-audit", "--no-fund", "--prefer-online", ...manifests.map(({ name, version }) => `${name}@${version}`)],
      { cwd: project, stdout: "inherit", stderr: "inherit" },
    );
    if (install.exitCode !== 0) throw new Error(`npm install of the published versions failed (exit ${install.exitCode})`);
    const cli = manifests.find(({ name }) => name === "@idlekit/cli");
    if (cli) {
      const cliDir = resolve(project, "node_modules/@idlekit/cli");
      const bin = (await Bun.file(resolve(cliDir, "package.json")).json()).bin.idk as string;
      const run = Bun.spawnSync([process.execPath, resolve(cliDir, bin), "--version"], { cwd: project, stdout: "pipe", stderr: "pipe" });
      const printed = run.stdout.toString().trim();
      if (run.exitCode !== 0 || printed !== cli.version) {
        throw new Error(`idk --version printed '${printed}' (exit ${run.exitCode}), expected ${cli.version}\n${run.stderr.toString()}`);
      }
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
  console.log(`registry smoke passed: ${manifests.map(({ name, version }) => `${name}@${version}`).join(", ")}`);
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode === "plan") await plan();
  else if (mode === "verify") await verify();
  else throw new Error("Usage: bun tools/release-registry.ts plan|verify");
}
