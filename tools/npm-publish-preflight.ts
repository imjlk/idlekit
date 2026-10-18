import { resolve } from "path";
import { ROOT, pathExists, readJson, writeText } from "./_bun";
import { compareSemver, fetchPackage } from "./release-registry";

type PackageManifest = Readonly<{
  name: string;
  version: string;
}>;

export type RegistryStatus = Readonly<{
  name: string;
  localVersion: string;
  /** The registry's `latest` dist-tag, or null when npm has no such tag or no such package. */
  publishedVersion: string | null;
  publishable: boolean;
  /** The registry already has this exact version; Sampo skips it, so it does not block a publish. */
  alreadyPublished: boolean;
}>;

/** Every version npm lists for a package, tagged or not, and its `latest` dist-tag. */
export type RegistryPackage = Readonly<{ versions: readonly string[]; latest: string | null }>;

/**
 * A version is already published when npm lists it at all, so one behind `latest` or under
 * another tag is skipped rather than retried. A new version must be newer than `latest`,
 * because npm tags a publish `latest` by default and would move it backward.
 */
export function registryStatus(pkg: PackageManifest, registry: RegistryPackage | null): RegistryStatus {
  const alreadyPublished = registry?.versions.includes(pkg.version) ?? false;
  const latest = registry?.latest ?? null;
  return {
    name: pkg.name,
    localVersion: pkg.version,
    publishedVersion: latest,
    publishable: !alreadyPublished && (latest === null || compareSemver(pkg.version, latest) > 0),
    alreadyPublished,
  };
}

const PACKAGE_DIRS = ["packages/money", "packages/core", "packages/cli"] as const;

function npmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (env.NPM_CONFIG_USERCONFIG) {
    env.NPM_CONFIG_USERCONFIG = resolve(ROOT, env.NPM_CONFIG_USERCONFIG);
  }
  return env;
}

function runNpm(args: string[]): { ok: boolean; stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["npm", ...args], {
    cwd: ROOT,
    env: npmEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
  };
}

async function loadPackages(): Promise<PackageManifest[]> {
  const manifests: PackageManifest[] = [];
  for (const pkgDir of PACKAGE_DIRS) {
    manifests.push(await readJson<PackageManifest>(resolve(ROOT, pkgDir, "package.json")));
  }
  return manifests;
}

async function main(): Promise<void> {
  const userConfig = process.env.NPM_CONFIG_USERCONFIG
    ? resolve(ROOT, process.env.NPM_CONFIG_USERCONFIG)
    : null;

  if (userConfig && !(await pathExists(userConfig))) {
    throw new Error(`NPM_CONFIG_USERCONFIG does not exist: ${userConfig}`);
  }

  const whoami = runNpm(["whoami"]);
  if (!whoami.ok) {
    throw new Error(
      [
        "npm authentication check failed.",
        "Set NPM_CONFIG_USERCONFIG to a local .npmrc that contains a valid npm token for the @idlekit scope.",
        userConfig ? `Resolved NPM_CONFIG_USERCONFIG: ${userConfig}` : "NPM_CONFIG_USERCONFIG is not set.",
        whoami.stderr || whoami.stdout,
      ].join("\n"),
    );
  }

  const ping = runNpm(["ping", "--registry", "https://registry.npmjs.org/"]);
  if (!ping.ok) {
    throw new Error(`npm registry ping failed.\n${ping.stderr || ping.stdout}`);
  }

  const registry = runNpm(["config", "get", "registry"]);
  const scopedRegistry = runNpm(["config", "get", "@idlekit:registry"]);

  const statuses: RegistryStatus[] = [];
  for (const pkg of await loadPackages()) {
    // Read the packument, as the Release workflow does: `npm view` resolves through `latest`,
    // prints nothing for a package without that tag, and npm 12 changes its JSON shape.
    statuses.push(registryStatus(pkg, await fetchPackage(pkg.name)));
  }

  const blocked = statuses.filter((status) => !status.publishable && !status.alreadyPublished);
  if (blocked.length > 0) {
    throw new Error(
      [
        "one or more package versions are not publishable.",
        ...blocked.map((status) =>
          `- ${status.name}: local=${status.localVersion}, published=${status.publishedVersion ?? "none"}`,
        ),
      ].join("\n"),
    );
  }

  if (!statuses.some((status) => status.publishable)) {
    throw new Error("every package version is already published; there is nothing to publish.");
  }

  const out = {
    ok: true,
    checkedAt: new Date().toISOString(),
    npmUser: whoami.stdout,
    npmUserConfig: userConfig,
    registry: registry.ok ? registry.stdout : null,
    scopedRegistry: scopedRegistry.ok ? scopedRegistry.stdout : null,
    statuses,
  };

  const outPath = resolve(ROOT, "tmp", "npm-publish-preflight.json");
  await writeText(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`npm publish preflight passed: ${outPath}`);
}

if (import.meta.main) await main();
