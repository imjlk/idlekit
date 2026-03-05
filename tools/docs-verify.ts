import { existsSync } from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  const simMeta = asRecord(simulate._meta as JSONValue);
  assert(simMeta.command === "simulate", "simulate _meta.command must be simulate");
  assert(has(simMeta, "scenarioHash"), "simulate _meta must include scenarioHash");

  const statePath = resolve(tmpDir, "intro-state.json");
  const firstRun = asRecord(
    runCliJson(["simulate", baseline, "--duration", "30", "--state-out", statePath, "--format", "json"]),
  );
  assert(existsSync(statePath), "simulate --state-out should create state json");
  const resumed = asRecord(
    runCliJson(["simulate", baseline, "--resume", statePath, "--duration", "10", "--format", "json"]),
  );
  assert(firstRun.endT === resumed.startT, "resumed run startT must match saved endT");

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
  assert(asRecord(eta._meta as JSONValue).command === "eta", "eta _meta.command must be eta");

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
  assert(asRecord(compare._meta as JSONValue).command === "compare", "compare _meta.command must be compare");

  const tune = asRecord(runCliJson(["tune", baseline, "--tune", tuneSpec, "--format", "json"]));
  assert(tune.ok === true, "tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "tune report must include best");
  assert(asRecord(tune._meta as JSONValue).command === "tune", "tune _meta.command must be tune");

  const ltv = asRecord(
    runCliJson([
      "ltv",
      baseline,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      "--value-per-worth",
      "0.001",
      "--format",
      "json",
    ]),
  );
  const summary = asRecord(ltv.summary as JSONValue);
  assert(has(summary, "at30m"), "ltv summary must include at30m");
  assert(has(summary, "at90d"), "ltv summary must include at90d");
  assert(asRecord(ltv._meta as JSONValue).command === "ltv", "ltv _meta.command must be ltv");
}

function verifyPluginTrack(): void {
  const plugin = resolve(root, "examples/plugins/custom-econ-plugin.ts");
  const pluginRoot = resolve(root, "examples/plugins");
  const sha = createHash("sha256").update(readFileSync(plugin)).digest("hex");
  const pluginShaArg = `${plugin}=${sha}`;
  const trustFile = resolve(tmpDir, "plugin-trust.json");
  writeFileSync(trustFile, JSON.stringify({ plugins: { [plugin]: sha } }, null, 2), "utf8");
  const scenario = "../../examples/plugins/plugin-scenario.json";
  const tuneSpec = "../../examples/plugins/plugin-tune.json";
  const designV1 = "../../examples/tutorials/05-idle-design-v1.json";
  const designB = "../../examples/tutorials/06-idle-design-balance-b.json";
  const designTune = "../../examples/tutorials/07-idle-design-tune.json";

  const strategies = asRecord(
    runCliJson([
      "strategies",
      "list",
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--format",
      "json",
    ]),
  );
  const strategyRows = (strategies.strategies ?? []) as JSONValue[];
  assert(
    strategyRows.some((x) => asRecord(x).id === "plugin.producerFirst"),
    "plugin.producerFirst must be listed",
  );

  const objectives = asRecord(
    runCliJson([
      "objectives",
      "list",
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--format",
      "json",
    ]),
  );
  const objectiveRows = (objectives.objectives ?? []) as JSONValue[];
  assert(
    objectiveRows.some((x) => asRecord(x).id === "plugin.gemsAndWorthLog10"),
    "plugin.gemsAndWorthLog10 must be listed",
  );

  const validateOut = runCli([
    "validate",
    scenario,
    "--plugin",
    plugin,
    "--allow-plugin",
    "true",
    "--plugin-root",
    pluginRoot,
    "--plugin-sha256",
    pluginShaArg,
    "--plugin-trust-file",
    trustFile,
  ]);
  assert(validateOut.includes("OK:"), "plugin validate should print OK");

  const tune = asRecord(
    runCliJson([
      "tune",
      scenario,
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--tune",
      tuneSpec,
      "--format",
      "json",
    ]),
  );
  assert(tune.ok === true, "plugin tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "plugin tune report must include best");

  const designValidate = runCli([
    "validate",
    designV1,
    "--plugin",
    plugin,
    "--allow-plugin",
    "true",
    "--plugin-root",
    pluginRoot,
    "--plugin-sha256",
    pluginShaArg,
    "--plugin-trust-file",
    trustFile,
  ]);
  assert(designValidate.includes("OK:"), "design track validate should print OK");

  const designSim = asRecord(
    runCliJson([
      "simulate",
      designV1,
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--format",
      "json",
    ]),
  );
  assert(has(designSim, "endMoney"), "design simulate must include endMoney");
  assert(has(designSim, "endNetWorth"), "design simulate must include endNetWorth");
  assert(has(designSim, "stats"), "design simulate must include stats");

  const designCompare = asRecord(
    runCliJson([
      "compare",
      designV1,
      designB,
      "--metric",
      "endNetWorth",
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--format",
      "json",
    ]),
  );
  const designCompareDetail = asRecord(designCompare.detail as JSONValue);
  assert(designCompareDetail.source === "measured", "design compare detail.source must be measured");

  const designTuneOut = asRecord(
    runCliJson([
      "tune",
      designV1,
      "--tune",
      designTune,
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--plugin-trust-file",
      trustFile,
      "--format",
      "json",
    ]),
  );
  assert(designTuneOut.ok === true, "design tune result must be ok=true");
  const designReport = asRecord(designTuneOut.report as JSONValue);
  assert(has(designReport, "best"), "design tune report must include best");

  const designLtv = asRecord(
    runCliJson([
      "ltv",
      designV1,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      "--value-per-worth",
      "0.001",
      "--plugin",
      plugin,
      "--allow-plugin",
      "true",
      "--plugin-root",
      pluginRoot,
      "--plugin-sha256",
      pluginShaArg,
      "--format",
      "json",
    ]),
  );
  const designSummary = asRecord(designLtv.summary as JSONValue);
  assert(has(designSummary, "at30m"), "design ltv summary must include at30m");
  assert(has(designSummary, "at90d"), "design ltv summary must include at90d");
  const horizons = (designLtv.horizons ?? []) as JSONValue[];
  assert(horizons.length >= 6, "design ltv must include full horizon rows");
  const row90d = horizons.find((x) => asRecord(x).horizon === "90d");
  assert(!!row90d, "design ltv must include 90d row");
  const monetization = asRecord(asRecord(row90d as JSONValue).monetization as JSONValue);
  assert(has(monetization, "cumulativeLtvPerUser"), "design ltv 90d row must include cumulativeLtvPerUser");

  const telemetryCsv = resolve(tmpDir, "calibration-telemetry.csv");
  writeFileSync(
    telemetryCsv,
    [
      "user_id,day,revenue,ad_revenue,acquisition_cost,active",
      "u1,1,0.6,0.02,1.2,true",
      "u1,7,0.0,0.01,,true",
      "u2,1,0.0,0.02,1.0,true",
      "u3,1,0.0,0.01,1.1,true",
    ].join("\n"),
    "utf8",
  );
  const calibrated = asRecord(runCliJson(["calibrate", telemetryCsv, "--input-format", "csv", "--format", "json"]));
  assert(calibrated.ok === true, "calibrate output must be ok=true");
  const calibMonetization = asRecord(calibrated.monetization as JSONValue);
  assert(has(calibMonetization, "retention"), "calibrate must include monetization.retention");
  const calibUncertainty = asRecord(calibMonetization.uncertainty as JSONValue);
  const calibCorrelation = asRecord(calibUncertainty.correlation as JSONValue);
  assert(has(calibCorrelation, "retentionConversion"), "calibrate must include uncertainty.correlation.retentionConversion");
  assert(asRecord(calibrated._meta as JSONValue).command === "calibrate", "calibrate _meta.command must be calibrate");
}

function main(): void {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  verifyIntroTrack();
  if (!isQuick) verifyPluginTrack();

  console.log(`docs verification passed (${isQuick ? "quick" : "full"})`);
}

main();
