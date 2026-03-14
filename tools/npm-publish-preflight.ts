import { resolve } from "path";
import { ROOT, pathExists, readJson, writeText } from "./_bun";

type PackageManifest = Readonly<{
  name: string;
  version: string;
}>;

type RegistryStatus = Readonly<{
  name: string;
  localVersion: string;
  publishedVersion: string | null;
  publishable: boolean;
}>;

const PACKAGE_DIRS = ["packages/money", "packages/core", "packages/cli"] as const;

function semverParts(version: string): [number, number, number, string?] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) throw new Error(`unsupported semver format: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? undefined];
}

function compareSemver(a: string, b: string): number {
  const ap = semverParts(a);
  const bp = semverParts(b);
  for (let i = 0; i < 3; i++) {
    if (ap[i] !== bp[i]) return ap[i] - bp[i];
  }
  if (ap[3] === bp[3]) return 0;
  if (!ap[3]) return 1;
  if (!bp[3]) return -1;
  return ap[3].localeCompare(bp[3]);
}

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
    const view = runNpm(["view", pkg.name, "version", "--json", "--registry", "https://registry.npmjs.org/"]);
    if (!view.ok) {
      const missing = view.stderr.includes("E404") || view.stdout.includes("E404");
      if (missing) {
        statuses.push({
          name: pkg.name,
          localVersion: pkg.version,
          publishedVersion: null,
          publishable: true,
        });
        continue;
      }
      throw new Error(`npm view failed for ${pkg.name}.\n${view.stderr || view.stdout}`);
    }

    const publishedVersion = JSON.parse(view.stdout) as string;
    statuses.push({
      name: pkg.name,
      localVersion: pkg.version,
      publishedVersion,
      publishable: compareSemver(pkg.version, publishedVersion) > 0,
    });
  }

  const blocked = statuses.filter((status) => !status.publishable);
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

await main();
