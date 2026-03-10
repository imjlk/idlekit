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
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const PUBLISH_EXPORTS: Record<string, { types: string; bun: string }> = {
  "@idlekit/money": { types: "./dist/index.d.ts", bun: "./dist/index.js" },
  "@idlekit/core": { types: "./dist/index.d.ts", bun: "./dist/index.js" },
};

async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

async function readWorkspaceVersions(): Promise<Map<string, string>> {
  const packageDirs = ["packages/money", "packages/core", "packages/cli"];
  const versions = new Map<string, string>();
  for (const pkgDir of packageDirs) {
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

async function prepare(): Promise<void> {
  const manifestPath = resolve(process.cwd(), "package.json");
  const backupPath = resolve(process.cwd(), BACKUP_FILE);
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
  const rewritten = rewriteManifest(original, await readWorkspaceVersions());
  const originalText = stableStringify(original);
  const rewrittenText = stableStringify(rewritten);

  if (originalText === rewrittenText) return;

  await Bun.write(backupPath, originalText);
  await Bun.write(manifestPath, rewrittenText);
}

async function restore(): Promise<void> {
  const manifestPath = resolve(process.cwd(), "package.json");
  const backupPath = resolve(process.cwd(), BACKUP_FILE);
  const backup = Bun.file(backupPath);
  if (!(await backup.exists())) return;
  await Bun.write(manifestPath, await backup.text());
  await $`rm -f ${backupPath}`.quiet();
}

const mode = process.argv[2];

if (mode === "prepare") {
  await prepare();
} else if (mode === "restore") {
  await restore();
} else {
  throw new Error("usage: bun tools/package-manifest.ts <prepare|restore>");
}
