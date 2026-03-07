import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
}

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

function packPackage(pkgDir: string): Readonly<{ packageDir: string; tarballPath: string; pack: PackEntry }> {
  const absDir = resolve(ROOT, pkgDir);
  const raw = run("npm", ["pack", "--json"], absDir);
  const parsed = parsePackEntries(raw);
  const pack = parsed[0];
  if (!pack) throw new Error(`npm pack returned no entries for ${pkgDir}`);
  const sourceTarball = resolve(absDir, pack.filename);
  const targetTarball = resolve(PACKS_DIR, pack.filename);
  renameSync(sourceTarball, targetTarball);
  return {
    packageDir: absDir,
    tarballPath: targetTarball,
    pack,
  };
}

function writeConsumerPackageJson(): void {
  writeFileSync(
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
    "utf8",
  );
}

function runLibrarySmoke(): Readonly<{ money: string; core: string }> {
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

  const raw = run("bun", ["-e", script], CONSUMER_DIR).trim();
  return JSON.parse(raw) as { money: string; core: string };
}

function runCliSmoke(): Readonly<{ helpHasIdk: boolean; validateOk: boolean }> {
  const help = run(packageBinPath(), ["--help"], CONSUMER_DIR);
  const validateRaw = run(packageBinPath(), ["validate", resolve(ROOT, "examples", "tutorials", "11-my-game-v1.json")], CONSUMER_DIR);
  return {
    helpHasIdk: help.includes("idk"),
    validateOk: validateRaw.includes("OK:"),
  };
}

rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(PACKS_DIR, { recursive: true });
mkdirSync(CONSUMER_DIR, { recursive: true });

const packed = PACKAGES.map(packPackage);
writeConsumerPackageJson();
run("npm", ["install", "--no-audit", "--no-fund", ...packed.map((entry) => entry.tarballPath)], CONSUMER_DIR);

const librarySmoke = runLibrarySmoke();
const cliSmoke = runCliSmoke();

const out = {
  generatedAt: new Date().toISOString(),
  tarballs: packed.map((entry) => ({
    packageDir: entry.packageDir,
    tarballPath: entry.tarballPath,
    name: entry.pack.name,
    version: entry.pack.version,
  })),
  librarySmoke,
  cliSmoke,
};

const outPath = resolve(ROOT, "tmp", "install-smoke.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`install smoke wrote ${outPath}`);
