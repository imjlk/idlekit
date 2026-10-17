import { $ } from "bun";
import { dirname, resolve } from "path";
import { copyFile } from "fs/promises";
import { withFileLock } from "./_bun";
import { parseNpmPackEntries } from "./npm-pack";
import { inspectTarballListing, type TarballCheck } from "./tarball-check";
import type { LibrarySmokeResult } from "./fixtures/consumers/time-boundaries-smoke";

type PackEntry = {
  filename: string;
  name: string;
  version: string;
};

const ROOT = process.cwd();
const TMP_ROOT = resolve(ROOT, "tmp", "install-smoke");
const PACKS_DIR = resolve(TMP_ROOT, "packs");
const CONSUMER_DIR = resolve(TMP_ROOT, "consumer");
const PACKAGES = ["packages/money", "packages/core", "packages/cli"] as const;

function packageBinPath(): string {
  return process.platform === "win32"
    ? resolve(CONSUMER_DIR, "node_modules", ".bin", "idk.cmd")
    : resolve(CONSUMER_DIR, "node_modules", ".bin", "idk");
}

function parsePackEntries(raw: string): PackEntry[] {
  return parseNpmPackEntries(raw);
}

async function packPackage(pkgDir: string): Promise<Readonly<{ packageDir: string; tarballPath: string; pack: PackEntry }>> {
  const absDir = resolve(ROOT, pkgDir);
  return withFileLock(`npm-pack-${pkgDir}`, async () => {
    const raw = await $`npm pack --json --pack-destination ${PACKS_DIR}`.cwd(absDir).text();
    const parsed = parsePackEntries(raw);
    const pack = parsed[0];
    if (!pack) throw new Error(`npm pack returned no entries for ${pkgDir}`);
    return {
      packageDir: absDir,
      tarballPath: resolve(PACKS_DIR, pack.filename),
      pack,
    };
  });
}

async function inspectTarball(tarballPath: string): Promise<TarballCheck> {
  const listing = await $`tar -tzf ${tarballPath}`.text();
  return inspectTarballListing(listing);
}

async function writeConsumerPackageJson(): Promise<void> {
  await Bun.write(
    resolve(CONSUMER_DIR, "package.json"),
    `${JSON.stringify(
      {
        name: "idlekit-install-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
}

async function runLibrarySmoke(): Promise<LibrarySmokeResult> {
  // Typecheck the source in the tools project, then exercise installed exports as plain ESM.
  const built = await Bun.build({
    entrypoints: [resolve(ROOT, "tools/fixtures/consumers/time-boundaries-smoke.ts")],
    outdir: CONSUMER_DIR,
    naming: "time-boundaries-smoke.mjs",
    target: "bun",
    format: "esm",
    packages: "external",
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const script = built.outputs.find((output) => output.path.endsWith(".mjs"))?.path;
  if (!script) throw new Error("Consumer smoke build did not emit JavaScript");
  const raw = await $`bun --config=${resolve(ROOT, "tools/bundled-cli-bunfig.toml")} ${script}`.cwd(CONSUMER_DIR).text();
  const report: unknown = JSON.parse(raw.trim());
  if (typeof report !== "object" || report === null
    || !("money" in report) || report.money !== "1000000"
    || !("core" in report) || report.core !== "5"
    || !("boundaryChecks" in report) || report.boundaryChecks !== 26
    || !("towerChecks" in report) || report.towerChecks !== 6) {
    throw new Error("Consumer smoke returned an invalid report");
  }
  return { money: report.money, core: report.core, boundaryChecks: report.boundaryChecks, towerChecks: report.towerChecks };
}

async function runCliSmoke(): Promise<Readonly<{ helpHasIdk: boolean; validateOk: boolean; pluginOk: boolean }>> {
  const help = await $`${packageBinPath()} --help`.cwd(CONSUMER_DIR).text();
  const validateRaw =
    await $`${packageBinPath()} validate ${resolve(ROOT, "examples", "tutorials", "11-my-game-v1.json")}`.cwd(CONSUMER_DIR).text();
  // Copy the original example unchanged: repository-relative imports must not leak into consumer examples.
  const plugin = resolve(CONSUMER_DIR, "custom-econ-plugin.ts");
  const scenario = resolve(CONSUMER_DIR, "orbital-foundry.json");
  await copyFile(resolve(ROOT, "examples/plugins/custom-econ-plugin.ts"), plugin);
  await copyFile(resolve(ROOT, "examples/tutorials/14-orbital-foundry-v1.json"), scenario);
  const pluginRaw = await $`${packageBinPath()} simulate ${scenario} --duration 30 --seed 19 --plugin ${plugin} --plugin-root ${CONSUMER_DIR} --allow-plugin true --format json`.cwd(CONSUMER_DIR).text();
  const pluginResult = JSON.parse(pluginRaw) as { endNetWorth?: unknown };
  if (typeof pluginResult.endNetWorth !== "string" || !Number.isFinite(Number(pluginResult.endNetWorth))) throw new Error("Consumer plugin did not simulate finite net worth");

  return {
    helpHasIdk: help.includes("idk"),
    validateOk: validateRaw.includes("OK:"),
    pluginOk: true,
  };
}

await $`rm -rf ${TMP_ROOT}`.quiet();
await $`mkdir -p ${PACKS_DIR} ${CONSUMER_DIR}`.quiet();

// Pack one package at a time, in dependency order. Each prepack rewrites its package.json, and a
// concurrent CLI bundle reads core's package.json while that rewrite is in flight.
const packed: Awaited<ReturnType<typeof packPackage>>[] = [];
for (const pkgDir of PACKAGES) packed.push(await packPackage(pkgDir));
await writeConsumerPackageJson();
await $`npm install --no-audit --no-fund ${packed.map((entry) => entry.tarballPath)}`.cwd(CONSUMER_DIR).quiet();

const librarySmoke = await runLibrarySmoke();
const cliSmoke = await runCliSmoke();

const tarballChecks = await Promise.all(
  packed.map(async (entry) => ({
    name: entry.pack.name,
    ...await inspectTarball(entry.tarballPath),
  })),
);

for (const check of tarballChecks) {
  if (!check.hasReadme) throw new Error(`tarball missing README.md: ${check.name}`);
  if (!check.hasLicense) throw new Error(`tarball missing LICENSE: ${check.name}`);
  if (check.hasTestArtifacts) throw new Error(`tarball still contains test artifacts: ${check.name}`);
}

const out = {
  generatedAt: new Date().toISOString(),
  tarballs: packed.map((entry) => ({
    packageDir: entry.packageDir,
    tarballPath: entry.tarballPath,
    name: entry.pack.name,
    version: entry.pack.version,
  })),
  tarballChecks,
  librarySmoke,
  cliSmoke,
};

const outPath = resolve(ROOT, "tmp", "install-smoke.json");
await $`mkdir -p ${dirname(outPath)}`.quiet();
await Bun.write(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`install smoke wrote ${outPath}`);
