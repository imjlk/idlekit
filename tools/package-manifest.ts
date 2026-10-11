import { $ } from "bun";
import { resolve } from "path";

type PackageManifest = {
  name?: string;
  version?: string;
  types?: string;
  exports?: Record<string, Record<string, string>>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const ROOT = resolve(import.meta.dir, "..");
const BACKUP_FILE = ".package.json.prepack.backup";
const HOLD_FILE = resolve(ROOT, ".publish-manifests.hold");
const RELEASE_WORKSPACES = ["packages/money", "packages/core", "packages/cli"] as const;
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const PUBLISH_EXPORTS: Record<string, { types: string; bun: string }> = {
  "@idlekit/money": { types: "./dist/index.d.ts", bun: "./dist/index.js" },
  "@idlekit/core": { types: "./dist/index.d.ts", bun: "./dist/index.js" },
};

async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

async function readWorkspaceVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const pkgDir of RELEASE_WORKSPACES) {
    const manifest = await readJson<PackageManifest>(resolve(ROOT, pkgDir, "package.json"));
    if (manifest.name && manifest.version) {
      versions.set(manifest.name, manifest.version);
    }
  }
  return versions;
}

function normalizeWorkspaceRange(spec: string, version: string): string {
  if (!spec.startsWith("workspace:")) return spec;
  const range = spec.slice("workspace:".length);
  if (range === "*" || range === "") return version;
  if (range === "^") return `^${version}`;
  if (range === "~") return `~${version}`;
  return range;
}

function rewriteManifest(manifest: PackageManifest, versions: Map<string, string>): PackageManifest {
  const next: PackageManifest = { ...manifest };

  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (!deps) continue;

    let changed = false;
    const rewritten: Record<string, string> = {};
    for (const [name, spec] of Object.entries(deps)) {
      const version = versions.get(name);
      if (version && spec.startsWith("workspace:")) {
        rewritten[name] = normalizeWorkspaceRange(spec, version);
        changed = true;
      } else {
        rewritten[name] = spec;
      }
    }

    next[section] = changed ? rewritten : deps;
  }

  const publishTarget = manifest.name ? PUBLISH_EXPORTS[manifest.name] : undefined;
  if (publishTarget) {
    next.types = publishTarget.types;

    const rootExport = manifest.exports?.["."];
    if (rootExport) {
      next.exports = {
        ...manifest.exports,
        ".": {
          ...rootExport,
          types: publishTarget.types,
          bun: publishTarget.bun,
        },
      };
    }
  }

  return next;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function unresolvedWorkspaceSpecs(manifest: PackageManifest): string[] {
  return SECTIONS.flatMap((section) =>
    Object.entries(manifest[section] ?? {})
      .filter(([, spec]) => spec.startsWith("workspace:"))
      .map(([name, spec]) => `${section}.${name}=${spec}`),
  );
}

async function prepare(packageDir: string, versions: Map<string, string>): Promise<void> {
  const manifestPath = resolve(packageDir, "package.json");
  const backupPath = resolve(packageDir, BACKUP_FILE);
  const backup = Bun.file(backupPath);
  if (await backup.exists()) {
    const backupText = await backup.text();
    const manifestText = await Bun.file(manifestPath).text();
    if (manifestText !== backupText) {
      await Bun.write(manifestPath, backupText);
    }
    await $`rm -f ${backupPath}`.quiet();
  }

  const original = await readJson<PackageManifest>(manifestPath);
  const rewritten = rewriteManifest(original, versions);
  const unresolved = unresolvedWorkspaceSpecs(rewritten);
  if (unresolved.length > 0) {
    throw new Error(`${original.name ?? packageDir} keeps unresolved workspace: specs: ${unresolved.join(", ")}`);
  }
  const originalText = stableStringify(original);
  const rewrittenText = stableStringify(rewritten);

  if (originalText === rewrittenText) return;

  await Bun.write(backupPath, originalText);
  await Bun.write(manifestPath, rewrittenText);
}

async function restore(packageDir: string): Promise<void> {
  const manifestPath = resolve(packageDir, "package.json");
  const backupPath = resolve(packageDir, BACKUP_FILE);
  const backup = Bun.file(backupPath);
  if (!(await backup.exists())) return;
  await Bun.write(manifestPath, await backup.text());
  await $`rm -f ${backupPath}`.quiet();
}

/**
 * npm sends the manifest it read before prepack to the registry, so publishing rewrites every
 * release manifest first and keeps it rewritten until `release`. Pack lifecycles leave a held
 * manifest alone, including the postpack of the dry run Sampo runs before the real publish.
 */
async function hold(): Promise<void> {
  if (await Bun.file(HOLD_FILE).exists()) throw new Error(`publish manifests are already held: ${HOLD_FILE}`);
  const versions = await readWorkspaceVersions();
  await Bun.write(HOLD_FILE, `${new Date().toISOString()}\n`);
  try {
    for (const pkgDir of RELEASE_WORKSPACES) await prepare(resolve(ROOT, pkgDir), versions);
  } catch (error) {
    await release();
    throw error;
  }
}

async function release(): Promise<void> {
  for (const pkgDir of RELEASE_WORKSPACES) await restore(resolve(ROOT, pkgDir));
  await $`rm -f ${HOLD_FILE}`.quiet();
}

const mode = process.argv[2];
const packageDir = resolve(process.argv[3] ?? ".");
const held = await Bun.file(HOLD_FILE).exists();

if (mode === "prepare") {
  if (!held) await prepare(packageDir, await readWorkspaceVersions());
} else if (mode === "restore") {
  if (!held) await restore(packageDir);
} else if (mode === "hold") {
  await hold();
} else if (mode === "release") {
  await release();
} else {
  throw new Error("usage: bun tools/package-manifest.ts <prepare|restore> [packageDir] | <hold|release>");
}
