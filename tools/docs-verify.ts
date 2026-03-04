import { existsSync } from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

const root = process.cwd();
const tmpDir = resolve(root, "tmp", "docs-verify");
const isQuick = process.argv.includes("--quick");
const maxBuffer = 256 * 1024 * 1024;

function runCommand(args: string[]): string {
  return execFileSync("bun", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer,
  });
}

function runCli(args: string[]): string {
  return runCommand(["run", "--cwd", "packages/cli", "dev", "--", ...args]);
}

function runCliJson(args: string[]): JSONValue {
  const stdout = runCli(args);
  try {
    return JSON.parse(stdout) as JSONValue;
  } catch (error) {
    throw new Error(`Failed to parse JSON output for idk ${args.join(" ")}\nOutput:\n${stdout}\n${String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(x: JSONValue): Record<string, JSONValue> {
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    throw new Error(`Expected object, got: ${JSON.stringify(x)}`);
  }
  return x as Record<string, JSONValue>;
}

function has(obj: Record<string, JSONValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function verifyIntroTrack(): void {
  const baseline = "../../examples/tutorials/01-cafe-baseline.json";
  const compareB = "../../examples/tutorials/03-cafe-compare-b.json";
  const tuneSpec = "../../examples/tutorials/04-cafe-tune.json";

  const validateOut = runCli(["validate", baseline]);
  assert(validateOut.includes("OK:"), "validate should print OK");

  const simulate = asRecord(runCliJson(["simulate", baseline, "--format", "json"]));
  assert(has(simulate, "endMoney"), "simulate must include endMoney");
  assert(has(simulate, "endNetWorth"), "simulate must include endNetWorth");
  assert(has(simulate, "stats"), "simulate must include stats");

  const eta = asRecord(
    runCliJson([
      "eta",
      baseline,
      "--target-worth",
      "1e5",
      "--mode",
      "analytic",
      "--diff",
      "simulate",
      "--max-duration",
      "7200",
      "--format",
      "json",
    ]),
  );
  assert(has(eta, "reached"), "eta must include reached");
  assert(has(eta, "seconds"), "eta must include seconds");
  assert(has(eta, "mode"), "eta must include mode");

  const reportMd = resolve(tmpDir, "intro-report.md");
  const reportJson = resolve(tmpDir, "intro-report.json");
  runCli(["report", baseline, "--format", "md", "--out", reportMd]);
  runCli(["report", baseline, "--format", "json", "--out", reportJson]);
  assert(existsSync(reportMd), "report md file should exist");
  assert(existsSync(reportJson), "report json file should exist");

  const compare = asRecord(
    runCliJson([
      "compare",
      baseline,
      compareB,
      "--metric",
      "etaToTargetWorth",
      "--target-worth",
      "1e5",
      "--max-duration",
      "7200",
      "--format",
      "json",
    ]),
  );
  const detail = asRecord(compare.detail as JSONValue);
  assert(detail.source === "measured", "compare detail.source must be measured");

  const tune = asRecord(runCliJson(["tune", baseline, "--tune", tuneSpec, "--format", "json"]));
  assert(tune.ok === true, "tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "tune report must include best");
}

function verifyPluginTrack(): void {
  const plugin = "../../examples/plugins/custom-econ-plugin.ts";
  const scenario = "../../examples/plugins/plugin-scenario.json";
  const tuneSpec = "../../examples/plugins/plugin-tune.json";

  const strategies = asRecord(runCliJson(["strategies", "list", "--plugin", plugin, "--format", "json"]));
  const strategyRows = (strategies.strategies ?? []) as JSONValue[];
  assert(
    strategyRows.some((x) => asRecord(x).id === "plugin.producerFirst"),
    "plugin.producerFirst must be listed",
  );

  const objectives = asRecord(runCliJson(["objectives", "list", "--plugin", plugin, "--format", "json"]));
  const objectiveRows = (objectives.objectives ?? []) as JSONValue[];
  assert(
    objectiveRows.some((x) => asRecord(x).id === "plugin.gemsAndWorthLog10"),
    "plugin.gemsAndWorthLog10 must be listed",
  );

  const validateOut = runCli(["validate", scenario, "--plugin", plugin]);
  assert(validateOut.includes("OK:"), "plugin validate should print OK");

  const tune = asRecord(
    runCliJson([
      "tune",
      scenario,
      "--plugin",
      plugin,
      "--tune",
      tuneSpec,
      "--format",
      "json",
    ]),
  );
  assert(tune.ok === true, "plugin tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "plugin tune report must include best");
}

function main(): void {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  verifyIntroTrack();
  if (!isQuick) verifyPluginTrack();

  console.log(`docs verification passed (${isQuick ? "quick" : "full"})`);
}

main();
