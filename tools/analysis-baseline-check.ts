/**
 * PR-00 inventory gate.
 *
 * Confirms the source-audit paths exist and the planned toolchain names do not.
 * TC-01 updates the host pins in this file when it changes Bun, TypeScript, or typia.
 * Evidence and Graph are intentionally absent here.
 */
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

function entryExists(path: string): boolean {
  return Bun.spawnSync(["test", "-e", path], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

const mustExist = [
  "docs/adr/analysis-contracts.md",
  "docs/adr/analysis-contracts_ko.md",
  "docs/implementation/source-audit.md",
  "docs/implementation/source-audit_ko.md",
  "docs/roadmap.md",
  "docs/roadmap_ko.md",
  "docs/testing.md",
  "docs/testing_ko.md",
  "package.json",
  "tsconfig.base.json",
  "packages/money/package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/core/src/index.ts",
  "packages/core/src/scenario/types.ts",
  "packages/core/src/sim/types.ts",
  "packages/core/src/sim/step.ts",
  "packages/core/src/sim/simulator.ts",
  "packages/core/src/sim/offline.ts",
  "packages/core/src/sim/session.ts",
  "packages/core/src/sim/monteCarlo.ts",
  "packages/core/src/sim/analysis/eta.ts",
  "packages/core/src/sim/analysis/prestigeCycle.ts",
  "packages/core/src/sim/analysis/growth.ts",
  "packages/core/src/sim/strategy/planner.ts",
  "packages/core/src/sim/strategy/opt/tuneSpec.ts",
  "packages/money/src/engine/breakInfinity.ts",
  "packages/money/src/engine/breakEternity.ts",
  "packages/cli/src/main.ts",
  "packages/cli/src/io/outputMeta.ts",
  "packages/cli/src/commands/evaluate.ts",
  "packages/cli/src/commands/doctor.ts",
  "packages/cli/src/commands/eta.ts",
  "packages/cli/src/commands/prestigeCycle.ts",
  "packages/cli/src/commands/growth.ts",
  "packages/cli/src/commands/experience.ts",
  "packages/cli/src/commands/kpiRegress.ts",
  "packages/cli/src/commands/groups/review.ts",
  "packages/cli/src/commands/groups/replay.ts",
  "packages/cli/src/commands/groups/kpi.ts",
  "packages/cli/src/lib/experience.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/docs-verify.yml",
  ".github/workflows/release.yml",
];

const mustBeAbsent = [
  "docs/requirements",
  "ttsc.config.ts",
  "ttsc.config.json",
  "tsconfig.json",
];

const absentRootScripts = [
  "toolchain:doctor",
  "toolchain:prepare",
  "evidence:check",
  "evidence:smoke",
  "graph:check",
  "contracts:generate",
  "contracts:check",
  "test:conformance",
];

const cliCommandFiles = [
  "inspect.ts",
  "analyze.ts",
];

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return (await Bun.file(path).json()) as Record<string, unknown>;
}

for (const rel of mustExist) {
  if (!entryExists(resolve(root, rel))) fail(`missing baseline path: ${rel}`);
}

for (const rel of mustBeAbsent) {
  if (entryExists(resolve(root, rel))) fail(`planned or unexpected path is present: ${rel}`);
}

for (const name of cliCommandFiles) {
  const rel = `packages/cli/src/commands/${name}`;
  if (entryExists(resolve(root, rel))) fail(`planned CLI command file is present: ${rel}`);
}

const rootPkg = await readJson(resolve(root, "package.json"));
if (rootPkg.packageManager !== "bun@1.3.10") {
  fail(`root packageManager is ${String(rootPkg.packageManager)}, baseline is bun@1.3.10`);
}
const rootDev = (rootPkg.devDependencies ?? {}) as Record<string, string>;
if (rootDev.typescript !== "^5.8.3") {
  fail(`root typescript is ${String(rootDev.typescript)}, baseline is ^5.8.3`);
}
if (rootDev["@types/node"] !== "^24.3.0") {
  fail(`root @types/node is ${String(rootDev["@types/node"])}, baseline is ^24.3.0`);
}

const scripts = (rootPkg.scripts ?? {}) as Record<string, string>;
for (const name of absentRootScripts) {
  if (name in scripts) fail(`planned script is already defined: ${name}`);
}

const corePkg = await readJson(resolve(root, "packages/core/package.json"));
const coreDeps = (corePkg.dependencies ?? {}) as Record<string, string>;
if (coreDeps.typia !== "^9.7.2") {
  fail(`@idlekit/core typia is ${String(coreDeps.typia)}, baseline is ^9.7.2`);
}

for (const rel of ["package.json", "packages/money/package.json", "packages/core/package.json", "packages/cli/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const names = Object.keys({
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  });
  for (const name of names) {
    if (name === "ttsc" || name.startsWith("@ttsc/")) fail(`${rel} depends on ${name}`);
  }
}

for (const rel of ["packages/money/package.json", "packages/core/package.json", "packages/cli/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const pkgScripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (!pkgScripts.typecheck?.includes("tsc")) fail(`${rel} typecheck does not call tsc`);
}
for (const rel of ["packages/money/package.json", "packages/core/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const pkgScripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (!pkgScripts.build?.includes("tsc")) fail(`${rel} build does not call tsc`);
}

const outputMeta = await readText(resolve(root, "packages/cli/src/io/outputMeta.ts"));
if (!outputMeta.includes('OUTPUT_CONTRACT_VERSION = "1.4.0"')) {
  fail("OUTPUT_CONTRACT_VERSION is not 1.4.0");
}

const scenarioTypes = await readText(resolve(root, "packages/core/src/scenario/types.ts"));
if (!scenarioTypes.includes("schemaVersion: 1")) fail("ScenarioV1 schemaVersion 1 marker is missing");

const main = await readText(resolve(root, "packages/cli/src/main.ts"));
for (const token of [
  "validateCommand",
  "simulateCommand",
  "etaCommand",
  "prestigeCycleCommand",
  "growthCommand",
  "experienceCommand",
  "evaluateCommand",
  "tuneCommand",
  "compareCommand",
  "doctorCommand",
  "replayGroup",
  "kpiGroup",
  "reviewGroup",
]) {
  if (!main.includes(token)) fail(`CLI registration is missing ${token}`);
}
if (main.includes("inspectCommand") || main.includes("analyzeCommand")) {
  fail("planned inspect/analyze command is registered");
}

for (const workflow of ["ci.yml", "codeql.yml", "docs-verify.yml", "release.yml"]) {
  const text = await readText(resolve(root, ".github/workflows", workflow));
  if (!text.includes('bun-version: "1.3.9"')) fail(`${workflow} does not pin Bun 1.3.9`);
}

const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
const sha = head.exitCode === 0 ? head.stdout.toString().trim() : "unknown";

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`analysis baseline check ok (HEAD ${sha})`);
