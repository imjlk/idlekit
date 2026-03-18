import { resolve } from "path";
import { ROOT, ensureDir, pathExists, readText, removePath, runText, sha256Hex, writeText } from "./_bun";

type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

const tmpDir = resolve(ROOT, "tmp", "docs-verify");
const isQuick = process.argv.includes("--quick");

function runCli(args: string[]): string {
  return runText(["bun", "run", "--cwd", "packages/cli", "dev", "--", ...args], { cwd: ROOT });
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

async function verifyIntroTrack(): Promise<void> {
  const baseline = "../../examples/tutorials/01-cafe-baseline.json";
  const compareB = "../../examples/tutorials/03-cafe-compare-b.json";
  const tuneSpec = "../../examples/tutorials/04-cafe-tune.json";
  const personalTemplate = "../../examples/tutorials/11-my-game-v1.json";
  const personalCompareB = "../../examples/tutorials/12-my-game-compare-b.json";
  const personalTuneSpec = "../../examples/tutorials/13-my-game-tune.json";

  const validateOut = runCli(["validate", baseline]);
  assert(validateOut.includes("OK:"), "validate should print OK");

  const simulate = asRecord(runCliJson(["simulate", baseline, "--format", "json"]));
  assert(has(simulate, "endMoney"), "simulate must include endMoney");
  assert(has(simulate, "endNetWorth"), "simulate must include endNetWorth");
  assert(has(simulate, "stats"), "simulate must include stats");
  const simMeta = asRecord(simulate._meta as JSONValue);
  assert(simMeta.command === "simulate", "simulate _meta.command must be simulate");
  assert(has(simMeta, "contractVersion"), "simulate _meta must include contractVersion");
  assert(has(simMeta, "schemaRef"), "simulate _meta must include schemaRef");
  assert(has(simMeta, "pluginDigest"), "simulate _meta must include pluginDigest");
  assert(has(simMeta, "scenarioHash"), "simulate _meta must include scenarioHash");

  const statePath = resolve(tmpDir, "intro-state.json");
  const firstRun = asRecord(
    runCliJson(["simulate", baseline, "--duration", "30", "--state-out", statePath, "--format", "json"]),
  );
  assert(await pathExists(statePath), "simulate --state-out should create state json");
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
  assert(await pathExists(reportMd), "report md file should exist");
  assert(await pathExists(reportJson), "report json file should exist");

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
  assert(Array.isArray(asRecord(compare.insights as JSONValue).drivers), "compare insights.drivers must exist");
  assert(asRecord(compare._meta as JSONValue).command === "compare", "compare _meta.command must be compare");

  const compareBundle = asRecord(
    runCliJson([
      "compare",
      personalTemplate,
      personalCompareB,
      "--bundle",
      "design",
      "--format",
      "json",
    ]),
  );
  assert(compareBundle.bundle === "design", "compare bundle must include bundle name");
  assert(Array.isArray(compareBundle.results as JSONValue[]), "compare bundle must include results");

  const tune = asRecord(runCliJson(["tune", baseline, "--tune", tuneSpec, "--format", "json"]));
  assert(tune.ok === true, "tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "tune report must include best");
  const tuneInsights = asRecord(tune.insights as JSONValue);
  assert(Array.isArray(tuneInsights.patterns), "tune insights.patterns must exist");
  assert(has(asRecord(tuneInsights.scoreSpread as JSONValue), "plateau"), "tune scoreSpread.plateau must exist");
  assert(asRecord(tune._meta as JSONValue).command === "tune", "tune _meta.command must be tune");

  const doctorRc = resolve(tmpDir, ".zshrc");
  runCliJson(["doctor", "--format", "json", "--fix", "true", "--shell", "zsh", "--rc", doctorRc]);
  const doctor = asRecord(runCliJson(["doctor", "--format", "json", "--shell", "zsh", "--rc", doctorRc]));
  assert(doctor.ok === true, "doctor must pass");
  assert(Array.isArray(doctor.checks as JSONValue[]), "doctor must include checks");

  const evaluate = asRecord(
    runCliJson([
      "evaluate",
      baseline,
      "--session-pattern",
      "short-bursts",
      "--days",
      "1",
      "--format",
      "json",
    ]),
  );
  assert(evaluate.ok === true, "evaluate must be ok=true");
  assert(has(asRecord(evaluate.simulate as JSONValue), "endMoney"), "evaluate simulate section must include endMoney");
  assert(has(asRecord(evaluate.experience as JSONValue), "perceived"), "evaluate experience section must include perceived");
  assert(has(asRecord(evaluate.ltv as JSONValue), "summary"), "evaluate ltv section must include summary");

  const replayArtifact = resolve(tmpDir, "intro-sim.artifact.json");
  runCli([
    "simulate",
    baseline,
    "--duration",
    "20",
    "--seed",
    "99",
    "--run-id",
    "docs-verify-intro",
    "--artifact-out",
    replayArtifact,
    "--format",
    "json",
  ]);
  const replayVerify = asRecord(runCliJson(["replay", "verify", replayArtifact, "--format", "json"]));
  assert(replayVerify.ok === true, "replay verify should pass");

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

  const kpiRegress = asRecord(
    runCliJson([
      "kpi",
      "regress",
      "--baseline",
      "../../examples/bench/kpi-baseline.json",
      "--current",
      "../../examples/bench/kpi-baseline.json",
      "--format",
      "json",
    ]),
  );
  assert(kpiRegress.pass === true, "kpi regress self-compare should pass");

  const personalValidate = runCli(["validate", personalTemplate]);
  assert(personalValidate.includes("OK:"), "personal template validate should print OK");

  const generatedPersonalBase = resolve(tmpDir, "generated-my-game-v1.json");
  runCli([
    "init",
    "scenario",
    "--track",
    "personal",
    "--preset",
    "builder",
    "--out",
    generatedPersonalBase,
    "--name",
    "Docs Verify",
  ]);
  const namedGeneratedBase = resolve(tmpDir, "docs-verify-v1.json");
  const namedGeneratedCompare = resolve(tmpDir, "docs-verify-v1-compare-b.json");
  const namedGeneratedTune = resolve(tmpDir, "docs-verify-v1-tune.json");
  assert(await pathExists(namedGeneratedBase), "init personal --name should create renamed base scenario");
  assert(await pathExists(namedGeneratedCompare), "init personal --name should create renamed compare scenario");
  assert(await pathExists(namedGeneratedTune), "init personal --name should create renamed tune spec");
  const generatedValidate = runCli(["validate", namedGeneratedBase]);
  assert(generatedValidate.includes("OK:"), "generated personal base validate should print OK");
  const generatedCompare = asRecord(
    runCliJson(["compare", namedGeneratedBase, namedGeneratedCompare, "--metric", "endNetWorth", "--format", "json"]),
  );
  assert(asRecord(generatedCompare.detail as JSONValue).source === "measured", "generated personal compare must be measured");
  const generatedTuneOut = asRecord(runCliJson(["tune", namedGeneratedBase, "--tune", namedGeneratedTune, "--format", "json"]));
  assert(generatedTuneOut.ok === true, "generated personal tune must be ok=true");
  assert(has(asRecord(generatedTuneOut.report as JSONValue), "best"), "generated personal tune must include best");

  const personalSim = asRecord(runCliJson(["simulate", personalTemplate, "--format", "json"]));
  assert(has(personalSim, "endMoney"), "personal template simulate must include endMoney");
  assert(has(personalSim, "endNetWorth"), "personal template simulate must include endNetWorth");

  const personalExperience = asRecord(
    runCliJson([
      "experience",
      personalTemplate,
      "--session-pattern",
      "short-bursts",
      "--days",
      "7",
      "--format",
      "json",
    ]),
  );
  assert(has(personalExperience, "growth"), "personal template experience must include growth");
  assert(has(personalExperience, "milestones"), "personal template experience must include milestones");
  assert(has(personalExperience, "perceived"), "personal template experience must include perceived");
  assert(asRecord(personalExperience._meta as JSONValue).command === "experience", "experience _meta.command must be experience");

  const personalLtv = asRecord(
    runCliJson([
      "ltv",
      personalTemplate,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      "--format",
      "json",
    ]),
  );
  const personalSummary = asRecord(personalLtv.summary as JSONValue);
  assert(has(personalSummary, "at7d"), "personal template ltv summary must include at7d");
  assert(has(personalSummary, "at90d"), "personal template ltv summary must include at90d");

  const personalCompare = asRecord(
    runCliJson([
      "compare",
      personalTemplate,
      personalCompareB,
      "--metric",
      "endNetWorth",
      "--format",
      "json",
    ]),
  );
  assert(asRecord(personalCompare.detail as JSONValue).source === "measured", "personal compare must be measured");
  assert(Array.isArray(asRecord(personalCompare.insights as JSONValue).drivers), "personal compare insights.drivers must exist");

  const personalExperienceCompare = asRecord(
    runCliJson([
      "compare",
      personalTemplate,
      personalCompareB,
      "--metric",
      "visibleChangesPerMinute",
      "--session-pattern",
      "short-bursts",
      "--days",
      "7",
      "--format",
      "json",
    ]),
  );
  assert(
    asRecord(personalExperienceCompare.detail as JSONValue).source === "measured",
    "personal experience compare must be measured",
  );
  assert(
    has(asRecord(personalExperienceCompare.measured as JSONValue).a as any, "visibleChangesPerMinute"),
    "personal experience compare measured.a must include visibleChangesPerMinute",
  );

  const personalTune = asRecord(runCliJson(["tune", personalTemplate, "--tune", personalTuneSpec, "--format", "json"]));
  assert(personalTune.ok === true, "personal tune result must be ok=true");
  assert(has(asRecord(personalTune.report as JSONValue), "best"), "personal tune report must include best");
  assert(Array.isArray(asRecord(personalTune.insights as JSONValue).patterns), "personal tune insights.patterns must exist");
}

async function verifyPluginTrack(): Promise<void> {
  const plugin = resolve(ROOT, "examples/plugins/custom-econ-plugin.ts");
  const pluginRoot = resolve(ROOT, "examples/plugins");
  const sha = sha256Hex(await readText(plugin));
  const pluginShaArg = `${plugin}=${sha}`;
  const trustFile = resolve(tmpDir, "plugin-trust.json");
  await writeText(trustFile, `${JSON.stringify({ plugins: { [plugin]: sha } }, null, 2)}\n`);
  const scenario = "../../examples/plugins/plugin-scenario.json";
  const tuneSpec = "../../examples/plugins/plugin-tune.json";
  const designV1 = "../../examples/tutorials/14-orbital-foundry-v1.json";
  const designB = "../../examples/tutorials/15-orbital-foundry-compare-b.json";
  const designTune = "../../examples/tutorials/16-orbital-foundry-tune.json";
  const sessionV1 = "../../examples/tutorials/17-session-arcade-v1.json";
  const sessionB = "../../examples/tutorials/18-session-arcade-compare-b.json";
  const sessionTune = "../../examples/tutorials/19-session-arcade-tune.json";
  const longrunV1 = "../../examples/tutorials/20-longrun-colony-v1.json";
  const longrunB = "../../examples/tutorials/21-longrun-colony-compare-b.json";
  const longrunTune = "../../examples/tutorials/22-longrun-colony-tune.json";
  const prestigeV1 = "../../examples/tutorials/23-prestige-reactor-v1.json";
  const prestigeB = "../../examples/tutorials/24-prestige-reactor-compare-b.json";
  const prestigeTune = "../../examples/tutorials/25-prestige-reactor-tune.json";

  const pluginFlags = [
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
  ];

  const strategies = asRecord(runCliJson(["strategies", "list", ...pluginFlags, "--format", "json"]));
  const strategyRows = (strategies.strategies ?? []) as JSONValue[];
  assert(strategyRows.some((x) => asRecord(x).id === "plugin.producerFirst"), "plugin.producerFirst must be listed");

  const objectives = asRecord(runCliJson(["objectives", "list", ...pluginFlags, "--format", "json"]));
  const objectiveRows = (objectives.objectives ?? []) as JSONValue[];
  assert(
    objectiveRows.some((x) => asRecord(x).id === "plugin.gemsAndWorthLog10"),
    "plugin.gemsAndWorthLog10 must be listed",
  );

  const validateOut = runCli(["validate", scenario, ...pluginFlags]);
  assert(validateOut.includes("OK:"), "plugin validate should print OK");

  const tune = asRecord(runCliJson(["tune", scenario, ...pluginFlags, "--tune", tuneSpec, "--format", "json"]));
  assert(tune.ok === true, "plugin tune result must be ok=true");
  const report = asRecord(tune.report as JSONValue);
  assert(has(report, "best"), "plugin tune report must include best");

  const designValidate = runCli(["validate", designV1, ...pluginFlags]);
  assert(designValidate.includes("OK:"), "design track validate should print OK");

  const designSim = asRecord(runCliJson(["simulate", designV1, ...pluginFlags, "--format", "json"]));
  assert(has(designSim, "endMoney"), "design simulate must include endMoney");
  assert(has(designSim, "endNetWorth"), "design simulate must include endNetWorth");
  assert(has(designSim, "stats"), "design simulate must include stats");

  const designCompare = asRecord(
    runCliJson(["compare", designV1, designB, "--metric", "endNetWorth", ...pluginFlags, "--format", "json"]),
  );
  const designCompareDetail = asRecord(designCompare.detail as JSONValue);
  assert(designCompareDetail.source === "measured", "design compare detail.source must be measured");

  const designMilestoneCompare = asRecord(
    runCliJson([
      "compare",
      designV1,
      designB,
      "--metric",
      "timeToMilestone",
      "--milestone-key",
      "progress.first-upgrade",
      "--session-pattern",
      "twice-daily",
      "--days",
      "7",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(
    asRecord(designMilestoneCompare.detail as JSONValue).source === "measured",
    "design milestone compare detail.source must be measured",
  );

  const designTuneOut = asRecord(
    runCliJson(["tune", designV1, "--tune", designTune, ...pluginFlags, "--format", "json"]),
  );
  assert(designTuneOut.ok === true, "design tune result must be ok=true");
  const designReport = asRecord(designTuneOut.report as JSONValue);
  assert(has(designReport, "best"), "design tune report must include best");

  const designExperience = asRecord(
    runCliJson([
      "experience",
      designV1,
      "--session-pattern",
      "twice-daily",
      "--days",
      "7",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(has(designExperience, "milestones"), "design experience must include milestones");
  assert(has(designExperience, "perceived"), "design experience must include perceived");

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
      ...pluginFlags,
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

  for (const scenarioPath of [sessionV1, sessionB, longrunV1, longrunB, prestigeV1, prestigeB]) {
    const out = runCli(["validate", scenarioPath, ...pluginFlags]);
    assert(out.includes("OK:"), `design library validate should print OK for ${scenarioPath}`);
  }

  const sessionExperience = asRecord(
    runCliJson([
      "experience",
      sessionV1,
      "--session-pattern",
      "short-bursts",
      "--days",
      "3",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(has(sessionExperience, "perceived"), "session library experience must include perceived");

  const sessionCompare = asRecord(
    runCliJson([
      "compare",
      sessionV1,
      sessionB,
      "--metric",
      "visibleChangesPerMinute",
      "--session-pattern",
      "short-bursts",
      "--days",
      "3",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(asRecord(sessionCompare.detail as JSONValue).source === "measured", "session compare must be measured");

  const sessionTuneOut = asRecord(
    runCliJson(["tune", sessionV1, "--tune", sessionTune, ...pluginFlags, "--format", "json"]),
  );
  assert(sessionTuneOut.ok === true, "session tune result must be ok=true");

  const longrunCompare = asRecord(
    runCliJson(["compare", longrunV1, longrunB, "--metric", "endNetWorth", ...pluginFlags, "--format", "json"]),
  );
  assert(asRecord(longrunCompare.detail as JSONValue).source === "measured", "longrun compare must be measured");

  const longrunTuneOut = asRecord(
    runCliJson(["tune", longrunV1, "--tune", longrunTune, ...pluginFlags, "--format", "json"]),
  );
  assert(longrunTuneOut.ok === true, "longrun tune result must be ok=true");

  const longrunLtv = asRecord(
    runCliJson([
      "ltv",
      longrunV1,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(has(asRecord(longrunLtv.summary as JSONValue), "at90d"), "longrun ltv summary must include at90d");

  const prestigeExperience = asRecord(
    runCliJson([
      "experience",
      prestigeV1,
      "--session-pattern",
      "weekend-marathon",
      "--days",
      "14",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(has(prestigeExperience, "milestones"), "prestige experience must include milestones");

  const prestigeCompare = asRecord(
    runCliJson([
      "compare",
      prestigeV1,
      prestigeB,
      "--metric",
      "timeToMilestone",
      "--milestone-key",
      "prestige.first",
      "--session-pattern",
      "weekend-marathon",
      "--days",
      "14",
      ...pluginFlags,
      "--format",
      "json",
    ]),
  );
  assert(asRecord(prestigeCompare.detail as JSONValue).source === "measured", "prestige compare must be measured");

  const prestigeTuneOut = asRecord(
    runCliJson(["tune", prestigeV1, "--tune", prestigeTune, ...pluginFlags, "--format", "json"]),
  );
  assert(prestigeTuneOut.ok === true, "prestige tune result must be ok=true");

  const telemetryCsv = resolve(tmpDir, "calibration-telemetry.csv");
  await writeText(
    telemetryCsv,
    [
      "user_id,day,revenue,ad_revenue,acquisition_cost,active",
      "u1,1,0.6,0.02,1.2,true",
      "u1,7,0.0,0.01,,true",
      "u2,1,0.0,0.02,1.0,true",
      "u3,1,0.0,0.01,1.1,true",
    ].join("\n"),
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

async function main(): Promise<void> {
  await removePath(tmpDir);
  await ensureDir(tmpDir);
  await verifyIntroTrack();
  if (!isQuick) await verifyPluginTrack();
  console.log(`docs verification passed (${isQuick ? "quick" : "full"})`);
}

await main();
