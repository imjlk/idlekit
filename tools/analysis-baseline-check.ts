/**
 * PR-00 inventory gate.
 *
 * Confirms current source-audit paths and host pins from fixtures/toolchain/pins.json.
 * Historical PR-00 tables stay in the source audit; implemented commands are required.
 * TC-02 requires package check and money/core emit to call ttsc, not tsc.
 * toolchain:doctor and toolchain:prepare are real after that pin.
 * Evidence and Graph repository gates arrived in TC-03 and TC-04.
 * DX-01 adds test:conformance. TC-05 adds contracts:generate and contracts:check.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import type { PinFile } from "./toolchain-host";

const root = resolve(import.meta.dir, "..");

function entryExists(path: string): boolean {
  return existsSync(path);
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

const implementedCommandFiles = [
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

for (const name of implementedCommandFiles) {
  const rel = `packages/cli/src/commands/${name}`;
  if (!entryExists(resolve(root, rel))) fail(`implemented CLI command file is missing: ${rel}`);
}

const rootPkg = await readJson(resolve(root, "package.json"));
const pins: PinFile = await Bun.file(resolve(root, "fixtures/toolchain/pins.json")).json();
if (rootPkg.packageManager !== `bun@${pins.bun}`) {
  fail(`root packageManager is ${String(rootPkg.packageManager)}, pin is bun@${pins.bun}`);
}
const rootDev = (rootPkg.devDependencies ?? {}) as Record<string, string>;
for (const [name, { version }] of Object.entries(pins.packages)) {
  if (rootDev[name] !== version) fail(`root ${name} is ${String(rootDev[name])}, pin is ${version}`);
}
// Type package ranges are resolved by the frozen workspace lockfile.
if (!rootDev["@types/node"]) fail("root @types/node devDependency is missing");

const scripts = (rootPkg.scripts ?? {}) as Record<string, string>;
for (const name of ["evidence:check", "evidence:smoke", "format:check"]) {
  if (!(name in scripts)) fail(`TC-03 script is missing: ${name}`);
}
if (!("graph:check" in scripts)) fail("TC-04 script is missing: graph:check");
if (!scripts["test:conformance"]?.includes("tools/conformance.ts")) {
  fail("DX-01 test:conformance script is missing");
}
if (scripts["contracts:generate"] !== "bun --preload @ttsc/unplugin/bun-register tools/generate-contracts.ts") {
  fail("TC-05 contracts:generate script is missing");
}
if (scripts["contracts:check"] !== "bun --preload @ttsc/unplugin/bun-register tools/contracts-check.ts") {
  fail("TC-05 contracts:check script is missing");
}
for (const rel of [
  "tools/generate-contracts.ts",
  "tools/contracts-check.ts",
  "tools/contract-files.ts",
  "tools/contract-smoke.ts",
  "packages/core/src/scenario/scenarioContract.ts",
  "docs/contract-generation.md",
  "docs/schemas/generated/scenario.v1.schema.json",
]) {
  if (!entryExists(resolve(root, rel))) fail(`TC-05 path is missing: ${rel}`);
}
for (const rel of [
  "docs/schemas/generated/analysis.artifact.v1.schema.json",
  "packages/core/src/sim/analysis/contracts.ts",
  "packages/core/src/sim/analysis/metrics.ts",
  "packages/core/src/sim/analysis/registry.ts",
]) {
  if (!entryExists(resolve(root, rel))) fail(`PR-08 path is missing: ${rel}`);
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
if (coreDeps.typia !== pins.packages.typia?.version) {
  fail(`@idlekit/core typia is ${String(coreDeps.typia)}, pin is ${pins.packages.typia?.version}`);
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
  "inspectCommand",
  "analyzeCommand",
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

for (const workflow of ["ci.yml", "codeql.yml", "docs-verify.yml", "release.yml"]) {
  const text = await readText(resolve(root, ".github/workflows", workflow));
  if (!text.includes(`bun-version: "${pins.bun}"`)) fail(`${workflow} does not pin Bun ${pins.bun}`);
}

const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
const sha = head.exitCode === 0 ? head.stdout.toString().trim() : "unknown";

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`analysis baseline check ok (HEAD ${sha})`);
