import { $ } from "bun";
import { dirname, resolve } from "path";

type PackEntry = {
  filename: string;
  name: string;
  version: string;
};

type TarballCheck = Readonly<{
  hasReadme: boolean;
  hasLicense: boolean;
  hasTestArtifacts: boolean;
}>;

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
  const match = raw.match(/(\[\s*{[\s\S]*}\s*\])\s*$/);
  if (!match) {
    throw new Error(`npm pack output did not include JSON payload:\n${raw}`);
  }
  return JSON.parse(match[1]) as PackEntry[];
}

async function packPackage(pkgDir: string): Promise<Readonly<{ packageDir: string; tarballPath: string; pack: PackEntry }>> {
  const absDir = resolve(ROOT, pkgDir);
  const raw = await $`npm pack --json`.cwd(absDir).text();
  const parsed = parsePackEntries(raw);
  const pack = parsed[0];
  if (!pack) throw new Error(`npm pack returned no entries for ${pkgDir}`);
  const sourceTarball = resolve(absDir, pack.filename);
  const targetTarball = resolve(PACKS_DIR, pack.filename);
  await $`mv ${sourceTarball} ${targetTarball}`.quiet();
  return {
    packageDir: absDir,
    tarballPath: targetTarball,
    pack,
  };
}

async function inspectTarball(tarballPath: string): Promise<TarballCheck> {
  const listing = await $`tar -tzf ${tarballPath}`.text();
  const files = listing.trim().split("\n").filter(Boolean);
  const hasReadme = files.some((file) => /package\/README\.md$/i.test(file));
  const hasLicense = files.some((file) => /package\/LICENSE$/i.test(file));
  const hasTestArtifacts = files.some((file) => /\.test\.(d\.ts|js|js\.map|ts|tsx)$/.test(file));
  return { hasReadme, hasLicense, hasTestArtifacts };
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

async function runLibrarySmoke(): Promise<Readonly<{ money: string; core: string }>> {
  const script = `
    import { createBreakInfinityEngine } from "@idlekit/money";
    import { createNumberEngine } from "@idlekit/core";

    const moneyEngine = createBreakInfinityEngine();
    const coreEngine = createNumberEngine();

    const out = {
      money: moneyEngine.toString(moneyEngine.from("1e6")),
      core: coreEngine.toString(coreEngine.add(2, 3)),
    };

    console.log(JSON.stringify(out));
  `;

  const raw = await $`bun -e ${script}`.cwd(CONSUMER_DIR).text();
  return JSON.parse(raw.trim()) as { money: string; core: string };
}

async function runCliSmoke(): Promise<Readonly<{ helpHasIdk: boolean; validateOk: boolean }>> {
  const help = await $`${packageBinPath()} --help`.cwd(CONSUMER_DIR).text();
  const validateRaw =
    await $`${packageBinPath()} validate ${resolve(ROOT, "examples", "tutorials", "11-my-game-v1.json")}`.cwd(CONSUMER_DIR).text();

  return {
    helpHasIdk: help.includes("idk"),
    validateOk: validateRaw.includes("OK:"),
  };
}

await $`rm -rf ${TMP_ROOT}`.quiet();
await $`mkdir -p ${PACKS_DIR} ${CONSUMER_DIR}`.quiet();

const packed = await Promise.all(PACKAGES.map(packPackage));
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
