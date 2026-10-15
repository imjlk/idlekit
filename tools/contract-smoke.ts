import ttscPlugin from "@ttsc/unplugin/bun";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runCommand, ttscBin } from "./toolchain-host";

const root = resolve(import.meta.dir, "..");
const probe = resolve(root, "packages/core/src/scenario/scenarioContract.probe.ts");
const mode = process.argv[2] ?? "all";

function fail(message: string, stdout = "", stderr = ""): never {
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
  throw new Error(message);
}

function compilerCallLeft(source: string): boolean {
  const code = source
    .replace(/"(?:\\.|[^"\\])*"/g, "\"\"")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return /typia\.createValidate\s*[<(]/.test(code) || /typia\.json\.schema\s*[<(]/.test(code) || code.includes("@ttsc/");
}

function source(): void {
  const result = runCommand([process.execPath, probe], { cwd: resolve(root, "packages/core") });
  if (result.exitCode !== 0 || !result.stdout.includes("contract-ok")) {
    fail("source probe failed", result.stdout, result.stderr);
  }
  console.log("source contract-ok");
}

async function bundle(): Promise<void> {
  const outdir = join(tmpdir(), `idlekit-tc05-bundle-${crypto.randomUUID()}`);
  mkdirSync(outdir, { recursive: true });
  const built = await Bun.build({
    entrypoints: [probe],
    outdir,
    target: "bun",
    format: "esm",
    plugins: [ttscPlugin()],
  });
  if (!built.success) fail(built.logs.map(String).join("\n"));
  const jsPath = built.outputs.find((output) => output.path.endsWith(".js"))?.path;
  if (!jsPath) fail("bundle produced no js");
  const js = readFileSync(jsPath, "utf8");
  if (compilerCallLeft(js)) {
    fail("bundle still references the compiler");
  }
  const outside = join(tmpdir(), `idlekit-tc05-outside-${crypto.randomUUID()}`);
  mkdirSync(outside, { recursive: true });
  const outsideJs = join(outside, "entry.js");
  writeFileSync(outsideJs, js);
  const result = runCommand([process.execPath, outsideJs], { cwd: outside });
  if (result.exitCode !== 0 || !result.stdout.includes("contract-ok")) {
    fail("outside bundle failed", result.stdout, result.stderr);
  }
  console.log("bundle contract-ok");
}

function packTarball(name: string, packageDir: string, packDir: string): string {
  const pack = runCommand(["npm", "pack", "--json", "--pack-destination", packDir], { cwd: packageDir });
  if (pack.exitCode !== 0) fail(`${name} pack failed`, pack.stdout, pack.stderr);
  const packJson = pack.stdout.match(/(\[\s*{[\s\S]*}\s*\])\s*$/)?.[1];
  if (!packJson) fail(`${name} did not return JSON\n${pack.stdout}`);
  const packed = JSON.parse(packJson) as Array<{ filename: string }>;
  const filename = packed[0]?.filename;
  if (!filename) fail(`${name} did not return a filename`);
  return join(packDir, filename);
}

function pack(): void {
  const packDir = join(tmpdir(), `idlekit-tc05-pack-${crypto.randomUUID()}`);
  const consumerDir = join(tmpdir(), `idlekit-tc05-consumer-${crypto.randomUUID()}`);
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  const moneyTarball = packTarball("money", resolve(root, "packages/money"), packDir);
  const coreTarball = packTarball("core", resolve(root, "packages/core"), packDir);
  const emitted = runCommand(["tar", "-xOf", coreTarball, "package/dist/scenario/scenarioContract.js"], {
    cwd: packDir,
  });
  if (emitted.exitCode !== 0) fail("packed scenarioContract.js missing", emitted.stdout, emitted.stderr);
  if (compilerCallLeft(emitted.stdout)) {
    fail("packed validator still contains a compiler call");
  }
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "idlekit-tc05-consumer", private: true, type: "module" }, null, 2)}\n`,
  );
  const installed = runCommand(
    ["npm", "install", "--no-audit", "--no-fund", moneyTarball, coreTarball, "typescript@7.0.2"],
    { cwd: consumerDir },
  );
  if (installed.exitCode !== 0) fail("consumer install failed", installed.stdout, installed.stderr);
  copyFileSync(
    join(root, "tools/fixtures/consumers/scenario-runtime.ts"),
    join(consumerDir, "run.ts"),
  );
  const ran = runCommand([process.execPath, "run.ts"], { cwd: consumerDir });
  if (ran.exitCode !== 0 || !ran.stdout.includes("published-ok")) {
    fail("published consumer failed", ran.stdout, ran.stderr);
  }
  copyFileSync(
    join(root, "tools/fixtures/consumers/scenario-types.ts"),
    join(consumerDir, "types.ts"),
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
  );
  const checked = runCommand(
    [ttscBin, "--noEmit", "-p", join(consumerDir, "tsconfig.json"), "--cwd", consumerDir],
    { cwd: consumerDir },
  );
  if (checked.exitCode !== 0) fail("published d.ts consumer failed", checked.stdout, checked.stderr);
  console.log("pack published-ok");
}

if (mode === "source" || mode === "all") source();
if (mode === "bundle" || mode === "all") await bundle();
if (mode === "pack" || mode === "all") pack();
if (!["source", "bundle", "pack", "all"].includes(mode)) {
  console.error(`unknown contract smoke mode ${mode}`);
  process.exit(2);
}
