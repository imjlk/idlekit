import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageManifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const ROOT = resolve(import.meta.dir, "..");
const BACKUP_FILE = ".package.json.prepack.backup";
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readWorkspaceVersions(): Map<string, string> {
  const packageDirs = ["packages/money", "packages/core", "packages/cli"];
  const versions = new Map<string, string>();
  for (const pkgDir of packageDirs) {
    const manifest = readJson<PackageManifest>(resolve(ROOT, pkgDir, "package.json"));
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

  return next;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function prepare(): void {
  const manifestPath = resolve(process.cwd(), "package.json");
  const backupPath = resolve(process.cwd(), BACKUP_FILE);
  if (existsSync(backupPath)) {
    throw new Error(`prepack backup already exists: ${backupPath}`);
  }

  const original = readJson<PackageManifest>(manifestPath);
  const rewritten = rewriteManifest(original, readWorkspaceVersions());
  const originalText = stableStringify(original);
  const rewrittenText = stableStringify(rewritten);

  if (originalText === rewrittenText) return;

  writeFileSync(backupPath, originalText, "utf8");
  writeFileSync(manifestPath, rewrittenText, "utf8");
}

function restore(): void {
  const manifestPath = resolve(process.cwd(), "package.json");
  const backupPath = resolve(process.cwd(), BACKUP_FILE);
  if (!existsSync(backupPath)) return;
  writeFileSync(manifestPath, readFileSync(backupPath, "utf8"), "utf8");
  rmSync(backupPath);
}

const mode = process.argv[2];

if (mode === "prepare") {
  prepare();
} else if (mode === "restore") {
  restore();
} else {
  throw new Error("usage: bun tools/package-manifest.ts <prepare|restore>");
}
