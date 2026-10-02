/**
 * PR-00 inventory gate.
 *
 * Confirms the source-audit paths exist and the planned toolchain names do not.
 * TC-01 updates the host pins in this file when it changes Bun, TypeScript, or typia.
 * TC-02 requires package check and money/core emit to call ttsc, not tsc.
 * toolchain:doctor and toolchain:prepare are real after that pin.
 * Evidence and Graph repository gates arrived in TC-03 and TC-04.
 * DX-01 adds test:conformance. contracts:generate and contracts:check stay absent.
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
  "docs/toolchain.md",
  "docs/toolchain_ko.md",
  "fixtures/toolchain/pins.json",
  "fixtures/toolchain/baseline.json",
  "tools/toolchain-doctor.ts",
  "tools/toolchain-prepare.ts",
  "tools/toolchain-smoke.ts",
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
  "ttsc.config.ts",
  "ttsc.config.json",
  // A root tsconfig.json would auto-attach lint to every nearest project.
  // TC-03 uses tsconfig.evidence.json instead.
  "tsconfig.json",
];

const absentRootScripts = ["contracts:generate", "contracts:check"];

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
const pinnedDev: Record<string, string> = {
  ttsc: "0.30.4",
  "@ttsc/lint": "0.30.4",
  "@ttsc/evidence": "0.30.4",
  "@ttsc/graph": "0.30.4",
  "@ttsc/unplugin": "0.30.4",
  typescript: "7.0.2",
  typia: "14.0.6",
};
for (const [name, version] of Object.entries(pinnedDev)) {
  if (rootDev[name] !== version) fail(`root ${name} is ${String(rootDev[name])}, pin is ${version}`);
}
if (rootDev["@types/node"] !== "^26.1.2") {
  fail(`root @types/node is ${String(rootDev["@types/node"])}, pin is ^26.1.2`);
}

const scripts = (rootPkg.scripts ?? {}) as Record<string, string>;
for (const name of absentRootScripts) {
  if (name in scripts) fail(`planned script is already defined: ${name}`);
}
for (const name of ["evidence:check", "evidence:smoke", "format:check"]) {
  if (!(name in scripts)) fail(`TC-03 script is missing: ${name}`);
}
if (!("graph:check" in scripts)) fail("TC-04 script is missing: graph:check");
if (!scripts["test:conformance"]?.includes("tools/conformance.ts")) {
  fail("DX-01 test:conformance script is missing");
}
for (const rel of [
  "packages/core/src/testkit/conformance.ts",
  "packages/money/src/testkit/compareAmounts.ts",
  "fixtures/conformance/shrink-gap.json",
  "tools/conformance.ts",
]) {
  if (!entryExists(resolve(root, rel))) fail(`DX-01 path is missing: ${rel}`);
}
for (const rel of [
  "tsconfig.graph.json",
  "tools/graph-preflight.ts",
  "tools/graph-query.ts",
  "docs/development-graph.md",
  "AGENTS.md",
]) {
  if (!entryExists(resolve(root, rel))) fail(`TC-04 path is missing: ${rel}`);
}
if (!entryExists(resolve(root, "docs/requirements/active/typia-transform.md"))) {
  fail("active typia requirement is missing");
}
if (!entryExists(resolve(root, "lint.config.ts")) || !entryExists(resolve(root, "evidence.config.ts"))) {
  fail("evidence lint config is missing");
}

const corePkg = await readJson(resolve(root, "packages/core/package.json"));
const coreDeps = (corePkg.dependencies ?? {}) as Record<string, string>;
if (coreDeps.typia !== "14.0.6") {
  fail(`@idlekit/core typia is ${String(coreDeps.typia)}, pin is 14.0.6`);
}

for (const rel of ["packages/money/package.json", "packages/core/package.json", "packages/cli/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const names = Object.keys({
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  });
  for (const name of names) {
    if (name === "ttsc" || name.startsWith("@ttsc/")) fail(`${rel} depends on ${name}`);
  }
}

function commandCalls(script: string, command: string): boolean {
  return new RegExp(`(^|\\s)${command}(\\s|$)`).test(script);
}

for (const rel of ["packages/money/package.json", "packages/core/package.json", "packages/cli/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const pkgScripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (!commandCalls(pkgScripts.typecheck ?? "", "ttsc")) fail(`${rel} typecheck does not call ttsc`);
  if (commandCalls(pkgScripts.typecheck ?? "", "tsc")) fail(`${rel} typecheck still calls tsc`);
}
for (const rel of ["packages/money/package.json", "packages/core/package.json"]) {
  const pkg = await readJson(resolve(root, rel));
  const pkgScripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (!commandCalls(pkgScripts.build ?? "", "ttsc")) fail(`${rel} build does not call ttsc`);
  if (commandCalls(pkgScripts.build ?? "", "tsc")) fail(`${rel} build still calls tsc`);
}
const cliPkg = await readJson(resolve(root, "packages/cli/package.json"));
const cliScripts = (cliPkg.scripts ?? {}) as Record<string, string>;
if (!cliScripts.build?.includes("scripts/cli-bundle.ts")) {
  fail("CLI build does not use scripts/cli-bundle.ts");
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
  if (!text.includes('bun-version: "1.3.10"')) fail(`${workflow} does not pin Bun 1.3.10`);
  if (text.includes('bun-version: "1.3.9"')) fail(`${workflow} still pins Bun 1.3.9`);
}

const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
const sha = head.exitCode === 0 ? head.stdout.toString().trim() : "unknown";

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`analysis baseline check ok (HEAD ${sha})`);
