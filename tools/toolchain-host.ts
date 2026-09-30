import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { sha256Hex } from "./_bun";

export const root = resolve(import.meta.dir, "..");
export const pinsPath = join(root, "fixtures/toolchain/pins.json");
export const ttscBin = join(root, "node_modules/.bin/ttsc");
export const graphBin = join(root, "node_modules/.bin/ttsc-graph");

const require = createRequire(join(root, "package.json"));

export type PinFile = {
  bun: string;
  nodeLauncher: string;
  ciNode: string;
  publishNode: string;
  packages: Record<string, { version: string; integrity: string }>;
};

export type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function readPins(): PinFile {
  const pins = require(pinsPath) as PinFile;
  return pins;
}

export function nodeSatisfies(version: string, floor: string): boolean {
  const parse = (value: string) => value.replace(/^v/, "").split(".").map((part) => Number(part));
  const [major = 0, minor = 0, patch = 0] = parse(version);
  const [floorMajor = 0, floorMinor = 0, floorPatch = 0] = parse(floor.replace(/^>=/, ""));
  if (major !== floorMajor) return major > floorMajor;
  if (minor !== floorMinor) return minor > floorMinor;
  return patch >= floorPatch;
}

export function platformPackage(): string {
  return `@ttsc/${process.platform}-${process.arch}`;
}

export function resolvePlatformBinary(name: string): string {
  const ttscPackage = require.resolve("ttsc/package.json");
  const fromTtsc = createRequire(ttscPackage);
  return fromTtsc.resolve(`${platformPackage()}/bin/${name}`);
}

export function bundledGoBinary(): string {
  const goName = process.platform === "win32" ? "go.exe" : "go";
  return resolvePlatformBinary(`go/bin/${goName}`);
}

export function runCommand(
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
): CommandResult {
  const proc = Bun.spawnSync(args, {
    cwd: opts?.cwd ?? root,
    env: opts?.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    command: args.join(" "),
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export function fixtureEnv(cacheDir?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.TTSC_GRAPH_BINARY;
  delete env.TTSC_GO_BINARY;
  delete env.TTSC_TTSX_BINARY;
  if (cacheDir) env.TTSC_CACHE_DIR = cacheDir;
  else delete env.TTSC_CACHE_DIR;
  return env;
}

export function assertTtscArgv(args: string[]): void {
  const bin = args[0] ?? "";
  if (!bin.endsWith(`${join("node_modules", ".bin", "ttsc")}`) && !bin.endsWith(`${join("node_modules", ".bin", "ttsc-graph")}`)) {
    throw new Error(`refusing non-ttsc command: ${bin}`);
  }
}

export type DoctorReport = {
  ok: boolean;
  failures: string[];
  os: string;
  arch: string;
  bun: string;
  node: string;
  bunNodeCompat: string;
  packageManager: string;
  ttscVersion: string;
  typescriptPackage: string;
  go: string;
  nativeBinary: string;
  nativeSha256: string;
  lockfileSha256: string;
  cacheDirEnv: { set: boolean; path?: string; insideRepo?: boolean };
  graphBinaryEnv: { set: boolean; origin?: string; path?: string };
  goBinaryEnv: { set: boolean; origin?: string; path?: string };
  publishNode: { version: string; ttscLauncher: false; reason: string };
};

function samePath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function inspectOverride(
  name: "TTSC_GRAPH_BINARY" | "TTSC_GO_BINARY",
  pinned: string,
  failures: string[],
): { set: boolean; origin?: string; path?: string } {
  const value = process.env[name];
  if (!value) return { set: false };
  if (!isAbsolute(value)) {
    failures.push(`${name} is set to a non-absolute path`);
    return { set: true, origin: "external", path: value };
  }
  const origin = samePath(value, pinned) ? "pinned-platform-package" : "external";
  if (origin !== "pinned-platform-package") {
    failures.push(`${name} points outside the pinned ${platformPackage()} package`);
  }
  return { set: true, origin, path: value };
}

export function inspectToolchain(): DoctorReport {
  const failures: string[] = [];
  const pins = readPins();
  const rootPkg = require(join(root, "package.json")) as {
    packageManager?: string;
    devDependencies?: Record<string, string>;
  };
  const corePkg = require(join(root, "packages/core/package.json")) as {
    dependencies?: Record<string, string>;
  };
  const dev = rootPkg.devDependencies ?? {};
  for (const [name, pin] of Object.entries(pins.packages)) {
    const installed = require(join(root, "node_modules", name, "package.json")) as { version?: string };
    if (installed.version !== pin.version) {
      failures.push(`${name} installed ${installed.version ?? "missing"}, pin is ${pin.version}`);
    }
    if (name === "typia") {
      if (dev.typia !== pin.version) failures.push(`root typia is ${dev.typia}, pin is ${pin.version}`);
      if (corePkg.dependencies?.typia !== pin.version) {
        failures.push(`@idlekit/core typia is ${corePkg.dependencies?.typia}, pin is ${pin.version}`);
      }
      continue;
    }
    if (dev[name] !== pin.version) failures.push(`root ${name} is ${dev[name]}, pin is ${pin.version}`);
  }
  if (rootPkg.packageManager !== `bun@${pins.bun}`) {
    failures.push(`packageManager is ${rootPkg.packageManager}, pin is bun@${pins.bun}`);
  }
  if (Bun.version !== pins.bun) failures.push(`running Bun is ${Bun.version}, pin is ${pins.bun}`);
  const nodeLauncher = runCommand(["node", "-v"], { env: fixtureEnv() });
  const nodeVersion = nodeLauncher.stdout.trim();
  if (nodeLauncher.exitCode !== 0 || !nodeVersion.startsWith("v")) {
    failures.push(`node launcher failed: ${nodeLauncher.stderr || nodeLauncher.stdout}`);
  } else if (!nodeSatisfies(nodeVersion, pins.nodeLauncher)) {
    failures.push(`Node launcher ${nodeVersion} does not satisfy ${pins.nodeLauncher}`);
  }
  for (const workflow of ["ci.yml", "codeql.yml", "docs-verify.yml", "release.yml"]) {
    const body = readFileSync(join(root, ".github/workflows", workflow), "utf8");
    if (!body.includes('bun-version: "1.3.10"')) failures.push(`${workflow} does not pin Bun 1.3.10`);
    if (body.includes('bun-version: "1.3.9"')) failures.push(`${workflow} still pins Bun 1.3.9`);
  }
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  if (!ci.includes(`node-version: "${pins.ciNode}"`)) failures.push(`ci.yml does not pin Node ${pins.ciNode}`);
  if (!ci.includes("bun run toolchain:smoke")) failures.push("ci.yml does not run toolchain:smoke");
  const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  if (!release.includes(`node-version: "${pins.publishNode}"`)) {
    failures.push(`release.yml publish Node is not the recorded ${pins.publishNode}`);
  }

  const version = runCommand([ttscBin, "version"], { env: fixtureEnv() });
  if (version.exitCode !== 0) failures.push(`ttsc version failed: ${version.stderr || version.stdout}`);
  const versionText = `${version.stdout}\n${version.stderr}`;
  if (!versionText.includes(`ttsc ${pins.packages.ttsc?.version}`)) {
    failures.push(`ttsc version text does not name ${pins.packages.ttsc?.version}`);
  }
  if (!versionText.includes(pins.packages.typescript?.version ?? "")) {
    failures.push(`ttsc version text does not name typescript ${pins.packages.typescript?.version}`);
  }

  const nativeBinary = resolvePlatformBinary(process.platform === "win32" ? "ttsc.exe" : "ttsc");
  const nativeSha256 = sha256Hex(readFileSync(nativeBinary));
  const goBinary = bundledGoBinary();
  const go = runCommand([goBinary, "version"], { env: fixtureEnv() });
  if (go.exitCode !== 0) failures.push(`bundled Go failed: ${go.stderr || go.stdout}`);
  const lockfileSha256 = sha256Hex(readFileSync(join(root, "bun.lock")));
  const cacheValue = process.env.TTSC_CACHE_DIR;
  const graphBinary = resolvePlatformBinary(process.platform === "win32" ? "ttscgraph.exe" : "ttscgraph");
  const graphBinaryEnv = inspectOverride("TTSC_GRAPH_BINARY", graphBinary, failures);
  const goBinaryEnv = inspectOverride("TTSC_GO_BINARY", goBinary, failures);

  return {
    ok: failures.length === 0,
    failures,
    os: process.platform,
    arch: process.arch,
    bun: Bun.version,
    node: nodeVersion,
    bunNodeCompat: process.version,
    packageManager: rootPkg.packageManager ?? "",
    ttscVersion: versionText.trim(),
    typescriptPackage: pins.packages.typescript?.version ?? "",
    go: `${go.stdout}${go.stderr}`.trim(),
    nativeBinary,
    nativeSha256,
    lockfileSha256,
    cacheDirEnv: cacheValue
      ? { set: true, path: cacheValue, insideRepo: cacheValue.startsWith(`${root}/`) || cacheValue === root }
      : { set: false },
    graphBinaryEnv,
    goBinaryEnv,
    publishNode: {
      version: pins.publishNode,
      ttscLauncher: false,
      reason: `${pins.publishNode} is below ${pins.nodeLauncher}; the release job does not run ttsc`,
    },
  };
}
