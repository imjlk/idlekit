import ttscPlugin from "@ttsc/unplugin/bun";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runCommand, ttscBin } from "./toolchain-host";
import { parseNpmPackEntries } from "./npm-pack";

const root = resolve(import.meta.dir, "..");
const results: Array<{ name: string; command: string; exitCode: number; expected: number }> = [];

function record(name: string, command: string, exitCode: number, expected = 0): void {
  results.push({ name, command, exitCode, expected });
  console.log(`${exitCode === expected ? "ok" : "fail"} ${name} exit=${exitCode}`);
}

function importsSpecifier(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${escaped}['"]`).test(source);
}

function expectExit(name: string, command: string, exitCode: number, expected: number): void {
  record(name, command, exitCode, expected);
  if (exitCode !== expected) throw new Error(`${name} exited ${exitCode}, expected ${expected}`);
}

function run(
  name: string,
  args: string[],
  cwd: string,
  expected = 0,
  accept?: (stdout: string, stderr: string) => string | undefined,
): void {
  const result = runCommand(args, { cwd });
  if (result.exitCode !== expected) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  expectExit(name, result.command, result.exitCode, expected);
  if (accept) {
    const problem = accept(result.stdout, result.stderr);
    if (problem) {
      console.error(result.stdout);
      console.error(result.stderr);
      throw new Error(`${name}: ${problem}`);
    }
  }
}

const probe = resolve(root, "packages/core/src/scenario/concreteValidator.probe.ts");
const probeOk = (stdout: string) => (stdout.includes("probe-ok") ? undefined : "missing probe-ok");
run(
  "source-root-preload",
  [process.execPath, "--preload", "@ttsc/unplugin/bun-register", probe],
  root,
  0,
  probeOk,
);
run("source-core-preload", [process.execPath, probe], resolve(root, "packages/core"), 0, probeOk);
run("source-cli-preload", [process.execPath, probe], resolve(root, "packages/cli"), 0, probeOk);
run(
  "source-nopreload",
  [process.execPath, probe],
  resolve(root, "fixtures/toolchain/bun-nopreload"),
  1,
  (stdout, stderr) => {
    const text = `${stdout}\n${stderr}`;
    if (text.includes("Cannot find module")) return "failed module resolution instead of the transform";
    if (!/transform|typia/i.test(text)) return "error did not mention the transform";
    return undefined;
  },
);

run(
  "bun-test",
  [process.execPath, "test", "src/scenario/concreteValidator.test.ts"],
  resolve(root, "packages/core"),
);

const typeErrorDir = resolve(root, "tmp/tc02-type-error");
await Bun.$`rm -rf ${typeErrorDir}`.quiet();
await Bun.$`mkdir -p ${typeErrorDir}`.quiet();
await Bun.write(join(typeErrorDir, "bad.ts"), 'export const value: number = "no";\n');
await Bun.write(
  join(typeErrorDir, "package.json"),
  `${JSON.stringify({ name: "idlekit-tc02-type-error", private: true }, null, 2)}\n`,
);
await Bun.write(
  join(typeErrorDir, "tsconfig.json"),
  `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, files: ["bad.ts"] }, null, 2)}\n`,
);
run(
  "check-type-error",
  [ttscBin, "--noEmit", "-p", join(typeErrorDir, "tsconfig.json"), "--cwd", typeErrorDir],
  typeErrorDir,
  1,
  (stdout, stderr) => (`${stdout}\n${stderr}`.includes("TS2322") ? undefined : "type error was not TS2322"),
);

const genericDir = resolve(root, "fixtures/toolchain/typia-generic");
const genericOut = resolve(root, "tmp/tc02-typia-generic");
await Bun.$`rm -rf ${genericOut}`.quiet();
run(
  "generic-unresolved",
  [ttscBin, "--noEmit", "-p", join(genericDir, "tsconfig.unresolved.json"), "--cwd", genericDir],
  genericDir,
  3,
  (stdout, stderr) =>
    `${stdout}\n${stderr}`.includes("non-specified generic argument")
      ? undefined
      : "missing non-specified generic argument",
);
run(
  "generic-concrete-emit",
  [ttscBin, "--emit", "-p", join(genericDir, "tsconfig.json"), "--cwd", genericDir, "--outDir", genericOut],
  genericDir,
);
const concreteJs = await Bun.file(join(genericOut, "concrete.js")).text();
if (concreteJs.includes("typia.createValidate")) {
  throw new Error("concrete emit still contains typia.createValidate");
}
record("generic-vs-concrete-emit", "read tmp/tc02-typia-generic/concrete.js", 0);

const bundleDir = resolve(root, "tmp/tc02-bundle");
await Bun.$`rm -rf ${bundleDir}`.quiet();
const bundled = await Bun.build({
  entrypoints: [probe],
  outdir: bundleDir,
  target: "bun",
  format: "esm",
  plugins: [ttscPlugin()],
});
if (!bundled.success) throw new Error(bundled.logs.join("\n"));
const bundleJsPath = bundled.outputs.find((output) => output.path.endsWith(".js"))?.path;
if (!bundleJsPath) throw new Error("bundle produced no js");
const bundleJs = await Bun.file(bundleJsPath).text();
if (bundleJs.includes("typia.createValidate") || bundleJs.includes("@ttsc/")) {
  throw new Error("bundle still references typia.createValidate or @ttsc");
}
const outsideBundle = join(tmpdir(), `idlekit-tc02-bundle-${crypto.randomUUID()}`);
await Bun.$`mkdir -p ${outsideBundle}`.quiet();
const outsideJs = join(outsideBundle, "entry.js");
await Bun.write(outsideJs, bundleJs);
run("bundle-outside", [process.execPath, outsideJs], outsideBundle, 0, probeOk);

run("core-build", [process.execPath, "run", "build"], resolve(root, "packages/core"));
const sourceMap = await Bun.file(resolve(root, "packages/core/dist/scenario/concreteValidator.js.map")).json();
const sources = (sourceMap as { sources?: string[] }).sources ?? [];
if (!sources.some((source) => source.endsWith("concreteValidator.ts"))) {
  throw new Error(`sourcemap sources do not include concreteValidator.ts: ${sources.join(", ")}`);
}
const emittedProbe = await Bun.file(resolve(root, "packages/core/dist/scenario/concreteValidator.js")).text();
if (emittedProbe.includes("typia.createValidate") || emittedProbe.includes("@ttsc/")) {
  throw new Error("emitted concrete validator still calls typia.createValidate or @ttsc");
}
record("sourcemap-and-emit", "packages/core/dist/scenario/concreteValidator.js.map", 0);

const workspaceManifest = await Bun.file(resolve(root, "packages/core/package.json")).json();
const workspaceBun = (workspaceManifest as { exports?: { "."?: { bun?: string } } }).exports?.["."]?.bun;
if (workspaceBun !== "./src/index.ts") throw new Error(`workspace bun export is ${workspaceBun}`);
record("workspace-bun-export", "packages/core/package.json", 0);

const packDir = join(tmpdir(), `idlekit-tc02-pack-${crypto.randomUUID()}`);
const consumerDir = join(tmpdir(), `idlekit-tc02-consumer-${crypto.randomUUID()}`);
await Bun.$`mkdir -p ${packDir} ${consumerDir}`.quiet();

function packTarball(name: string, packageDir: string): string {
  const pack = runCommand(["npm", "pack", "--json", "--pack-destination", packDir], { cwd: packageDir });
  if (pack.exitCode !== 0) {
    console.error(pack.stdout);
    console.error(pack.stderr);
  }
  expectExit(name, pack.command, pack.exitCode, 0);
  const packed = parseNpmPackEntries(pack.stdout);
  const filename = packed[0]?.filename;
  if (!filename) throw new Error(`${name} did not return a filename`);
  return join(packDir, filename);
}

const moneyTarball = packTarball("npm-pack-money", resolve(root, "packages/money"));
const tarball = packTarball("npm-pack-core", resolve(root, "packages/core"));
const listing = runCommand(["tar", "-xOf", tarball, "package/package.json"], { cwd: packDir });
expectExit("tarball-manifest", listing.command, listing.exitCode, 0);
const published = JSON.parse(listing.stdout) as {
  types?: string;
  exports?: { "."?: { bun?: string; types?: string; import?: string } };
};
const publishedRoot = published.exports?.["."];
if (published.types !== "./dist/index.d.ts" || publishedRoot?.bun !== "./dist/index.js" || publishedRoot.types !== "./dist/index.d.ts" || publishedRoot.import !== "./dist/index.js") {
  throw new Error(`published manifest does not point at dist: ${listing.stdout}`);
}
const emittedInPack = runCommand(["tar", "-xOf", tarball, "package/dist/scenario/concreteValidator.js"], { cwd: packDir });
expectExit("tarball-validator", emittedInPack.command, emittedInPack.exitCode, 0);
if (emittedInPack.stdout.includes("typia.createValidate") || emittedInPack.stdout.includes("@ttsc/")) {
  throw new Error("packed validator still contains a compiler call");
}
record("published-manifest", tarball, 0);

await Bun.write(
  join(consumerDir, "package.json"),
  `${JSON.stringify({ name: "idlekit-tc02-consumer", private: true, type: "module" }, null, 2)}\n`,
);
const installed = runCommand(
  ["npm", "install", "--no-audit", "--no-fund", moneyTarball, tarball, "typescript@7.0.2"],
  { cwd: consumerDir },
);
if (installed.exitCode !== 0) {
  console.error(installed.stdout);
  console.error(installed.stderr);
}
expectExit("consumer-install", installed.command, installed.exitCode, 0);
await Bun.write(
  join(consumerDir, "run.ts"),
  `import { validateConcreteQuota } from "@idlekit/core";
const accepted = validateConcreteQuota({ count: 2 });
const rejected = validateConcreteQuota({ count: "no" });
if (!accepted.success || rejected.success || accepted.data.count !== 2) throw new Error("published validator mismatch");
console.log("published-ok");
`,
);
run(
  "published-run",
  [process.execPath, "run.ts"],
  consumerDir,
  0,
  (stdout) => (stdout.includes("published-ok") ? undefined : "missing published-ok"),
);
await Bun.write(
  join(consumerDir, "types.ts"),
  `import { validateConcreteQuota } from "@idlekit/core";
const accepted = validateConcreteQuota({ count: 2 });
if (!accepted.success) throw new Error("types");
export const count: number = accepted.data.count;
`,
);
await Bun.write(
  join(consumerDir, "tsconfig.json"),
  `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
    files: ["types.ts"],
  }, null, 2)}\n`,
);
run("dts-consumer", [ttscBin, "--noEmit", "-p", join(consumerDir, "tsconfig.json"), "--cwd", consumerDir], consumerDir);

run("cli-build", [process.execPath, "run", "build"], resolve(root, "packages/cli"));
const cliBundle = await Bun.file(resolve(root, "packages/cli/dist/main.js")).text();
if (!cliBundle.startsWith("#!/usr/bin/env bun\n")) throw new Error("CLI bundle is missing the bun shebang");
if (/(@opentui|@bunli|react\/jsx-runtime)/.test(cliBundle)) {
  throw new Error("CLI bundle retained a removed UI or Bunli dependency");
}
if (!cliBundle.includes("reviewEvaluate") || !cliBundle.includes("reviewDoctor") || !cliBundle.includes("reviewCompare")) {
  throw new Error("CLI bundle dropped a review report alias");
}
record("shebang-gunshi-reports", "packages/cli/dist/main.js", 0);
run(
  "cli-dist-help",
  [process.execPath, "dist/main.js", "--help"],
  resolve(root, "packages/cli"),
  0,
  (stdout) => (stdout.includes('"cliName": "idk"') || stdout.includes("idk") ? undefined : "missing idk help"),
);

run(
  "plugin-load-test",
  [process.execPath, "test", "src/plugin/load.test.ts"],
  resolve(root, "packages/cli"),
);

const prepareArgs = ["prepare", "-p", "tsconfig.json", "--cwd", resolve(root, "packages/core")];
run("prepare-cold", [ttscBin, ...prepareArgs], resolve(root, "packages/core"));
run("prepare-warm", [ttscBin, ...prepareArgs], resolve(root, "packages/core"));
const cacheCold = runCommand([ttscBin, "cache", "paths", "--json", "--cwd", resolve(root, "packages/core")], {
  cwd: resolve(root, "packages/core"),
});
const cacheWarm = runCommand([ttscBin, "cache", "paths", "--json", "--cwd", resolve(root, "packages/core")], {
  cwd: resolve(root, "packages/core"),
});
expectExit("cache-paths-cold", cacheCold.command, cacheCold.exitCode, 0);
expectExit("cache-paths-warm", cacheWarm.command, cacheWarm.exitCode, 0);
if (cacheCold.stdout !== cacheWarm.stdout) throw new Error("cold and warm cache paths differ");
record("cache-paths-stable", "ttsc cache paths --json", 0);

await Bun.write(resolve(root, "tmp/transform-smoke.json"), `${JSON.stringify({ results }, null, 2)}\n`);
console.log("transform smoke passed");
