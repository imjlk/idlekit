import { relative, resolve } from "path";
import {
  ROOT,
  cliCommand,
  ensureDir,
  pathExists,
  readText,
  removePath,
  runText,
  sha256Hex,
  writeText,
} from "./_bun";

type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

const tmpDir = resolve(ROOT, "tmp", "docs-verify");
const isQuick = process.argv.includes("--quick");

function runCli(args: string[]): string {
  return runText(cliCommand(args), { cwd: resolve(ROOT, "packages/cli") });
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

async function developmentExamples(doc: string, command: string): Promise<string[][]> {
  const text = (await readText(resolve(ROOT, doc))).replace(/\\\r?\n\s*/g, " ");
  const pattern = new RegExp(`^bun run --cwd packages/cli dev -- ((?:${command}) .+)$`, "gm");
  return [...text.matchAll(pattern)].map((match) => match[1]!.trim().split(/\s+/));
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
    runCliJson(["tune", prestigeV1, "--tune", prestigeTune, "--engine", "breakInfinity", ...pluginFlags, "--format", "json"]),
  );
  assert(prestigeTuneOut.ok === true, "prestige tune result must be ok=true");
}

async function verifyExperienceExamples(): Promise<void> {
  const commands = await developmentExamples("examples/experience/README.md", "experience");
  const korean = await developmentExamples("examples/experience/README_ko.md", "experience");
  assert(commands.length === 3, "experience README must provide three runnable examples");
  assert(JSON.stringify(commands) === JSON.stringify(korean), "English and Korean experience commands must match");
  const mixedArgs = commands.find((args) => args[1] === "../../examples/experience/mixed-feedback.json");
  const censoredArgs = commands.find((args) => args[1] === "../../examples/experience/censored-feedback.json");
  const controlArgs = commands.find((args) => args[1] === "../../examples/tutorials/11-my-game-v1.json");
  assert(mixedArgs && censoredArgs && controlArgs, "experience README must cover mixed, censored and control scenarios");

  const mixed = asRecord(asRecord(runCliJson(mixedArgs)).monteCarlo as JSONValue);
  const repeat = asRecord(asRecord(runCliJson(mixedArgs)).monteCarlo as JSONValue);
  assert(JSON.stringify(mixed) === JSON.stringify(repeat), "seeded feedback must reproduce its Monte Carlo summary");
  const first = asRecord(mixed.firstVisible as JSONValue);
  const accounting = asRecord(first.accounting as JSONValue);
  assert(mixed.draws === 16 && mixed.seed === 7, "mixed example must use 16 draws and seed 7");
  assert(accounting.observed === 9 && accounting.rightCensored === 7, "mixed example must observe 9 and censor 7 draws");
  assert(accounting.failed === 0 && accounting.unsupported === 0, "mixed example must have no failed or unsupported draws");
  assert(asRecord(first.uncertainty as JSONValue).zeroVariance === false, "seeded feedback must vary across draws");
  const population = asRecord(first.population as JSONValue);
  assert(
    population.status === "outside-observed-range" && population.value === null,
    "mixed example population p95 must remain unresolved",
  );
  assert(first.horizonSec === 51900, "mixed example must observe through the last short-bursts active block");
  const conditional = first.conditional;
  assert(Array.isArray(conditional) && conditional.length === 3, "mixed example must provide three conditional quantiles");
  for (const [index, q, value] of [[0, 0.1, "20"], [1, 0.5, "30"], [2, 0.9, "50"]] as const) {
    const point = asRecord(conditional[index]!);
    assert(
      point.q === q && point.value === value && point.conditioning === "completed-only" && point.status === "observed",
      `mixed example conditional q${q} must match the documented completed-only value`,
    );
  }

  const censored = asRecord(asRecord(runCliJson(censoredArgs)).monteCarlo as JSONValue);
  const unavailable = asRecord(censored.firstVisible as JSONValue);
  const counts = asRecord(unavailable.accounting as JSONValue);
  assert(counts.observed === 0 && counts.rightCensored === 16, "no-payout example must censor all 16 draws");
  assert(counts.failed === 0 && counts.unsupported === 0, "no-payout draws must remain eligible");
  assert(unavailable.status === "unavailable", "no-payout example has no observed first visible change");
  assert(unavailable.horizonSec === 51900, "no-payout example must retain the short-bursts observation horizon");
  const unavailableP95 = asRecord(unavailable.population as JSONValue);
  assert(
    unavailableP95.status === "unavailable" && unavailableP95.value === null,
    "no-payout example must leave population p95 unavailable",
  );
  assert(censored.firstVisibleChangeSec === null, "no-payout example must leave the legacy completion summary null");

  const control = asRecord(asRecord(runCliJson(controlArgs)).monteCarlo as JSONValue);
  const uncertainty = asRecord(asRecord(control.firstVisible as JSONValue).uncertainty as JSONValue);
  assert(uncertainty.zeroVariance === true && uncertainty.variance === 0, "linear starter must remain deterministic");
}

async function verifyCalibrationExamples(): Promise<void> {
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
  const cliDir = resolve(ROOT, "packages/cli");
  const calibratedPath = resolve(tmpDir, "calibrated-monetization.json");
  for (const doc of [
    "docs/tutorial-step-by-step_ko.md",
    "docs/usage-guide_ko.md",
    "docs/virtual-scenario-design_ko.md",
  ]) {
    const commands = await developmentExamples(doc, "calibrate");
    assert(commands.length === 1, `${doc} must contain one development calibrate example`);
    const args = commands[0]!;
    assert(args[1], `${doc} must provide a telemetry path`);
    assert(
      resolve(cliDir, args[1]) === resolve(ROOT, "tmp/telemetry.csv"),
      `${doc} calibrate input must resolve to the repository's tmp/telemetry.csv`,
    );
    const outIndex = args.indexOf("--out");
    if (outIndex !== -1) {
      const out = args[outIndex + 1];
      assert(out, `${doc} must provide a path after --out`);
      assert(
        resolve(cliDir, out) === resolve(ROOT, "tmp/calibrated-monetization.json"),
        `${doc} calibrate output must resolve to the repository's tmp/calibrated-monetization.json`,
      );
      args[outIndex + 1] = relative(cliDir, calibratedPath);
    }
    // Check the documented paths first, then keep fixtures in our own directory.
    args[1] = relative(cliDir, telemetryCsv);
    const stdout = runCli(args);
    const jsonText = outIndex === -1 ? stdout : await readText(calibratedPath);
    const calibrated = asRecord(JSON.parse(jsonText) as JSONValue);
    assert(calibrated.ok === true, `${doc} calibrate output must be ok=true`);
    const monetization = asRecord(calibrated.monetization as JSONValue);
    assert(has(monetization, "retention"), `${doc} calibrate must include monetization.retention`);
    const uncertainty = asRecord(monetization.uncertainty as JSONValue);
    const correlation = asRecord(uncertainty.correlation as JSONValue);
    assert(has(correlation, "retentionConversion"), `${doc} calibrate must include retentionConversion`);
    assert(asRecord(calibrated._meta as JSONValue).command === "calibrate", `${doc} _meta.command must be calibrate`);
  }
}

/** Built-in model tutorials: each must validate and simulate through the CLI with no plugin. */
async function verifyBuiltinModelTutorials(): Promise<void> {
  const tutorials = [
    ["../../examples/tutorials/26-exponential-forge-v1.json", "exponential"],
    ["../../examples/tutorials/27-prestige-loop-v1.json", "prestige"],
    ["../../examples/tutorials/28-twin-currency-v1.json", "multi-currency"],
    ["../../examples/tutorials/29-factory-chain-v1.json", "production-chain"],
    ["../../examples/tutorials/30-lucky-forge-v1.json", "exponential"],
  ] as const;
  const listed = asRecord(runCliJson(["models", "list", "--format", "json"]));
  const ids = (listed.models as JSONValue[]).map((row) => asRecord(row).id);
  for (const [path, model] of tutorials) {
    assert(ids.includes(model), `models list must include the built-in '${model}' model`);
    assert(runCli(["validate", path]).includes("OK:"), `${path} must validate`);
    const simulated = asRecord(runCliJson(["simulate", path, "--duration", "600", "--format", "json"]));
    const worth = Number(simulated.endNetWorth);
    assert(Number.isFinite(worth) && worth > 0, `${path} must end with a finite positive net worth`);
  }
}

/** Advanced analysis docs: both languages name the commands, and a small reset-policy scan reads a positive rate. */
async function verifyAdvancedAnalysisDocs(): Promise<void> {
  for (const doc of ["docs/advanced-analysis.md", "docs/advanced-analysis_ko.md"]) {
    const text = await readText(resolve(ROOT, doc));
    for (const command of ["idk sensitivity", "idk optimize", "idk reset-policy"]) {
      assert(text.includes(command), `${doc} must document ${command}`);
    }
  }
  const out = asRecord(
    runCliJson([
      "reset-policy",
      "../../examples/tutorials/27-prestige-loop-v1.json",
      "--scan",
      "600..1200",
      "--step",
      "600",
      "--horizon",
      "3000",
      "--format",
      "json",
    ]),
  );
  const insights = asRecord(out.insights as JSONValue);
  const rows = insights.rows as JSONValue[];
  assert(rows.length === 2, "reset-policy docs scan must read two intervals");
  for (const row of rows) {
    const rate = asRecord(row).rewardPerHour;
    assert(typeof rate === "number" && rate > 0, "reset-policy docs scan must read a positive reward per hour");
  }
}

async function verifyResetCycleExample(): Promise<void> {
  const command = "bun examples/reset-cycle/save-resume.ts";
  for (const doc of ["examples/reset-cycle/README.md", "examples/reset-cycle/README_ko.md"]) {
    const text = await readText(resolve(ROOT, doc));
    assert(text.split(/\r?\n/).filter((line) => line === command).length === 1, `${doc} must document the reset-cycle command`);
  }
  const checkpointPath = resolve(tmpDir, "reset-cycle-checkpoint.json");
  const result = asRecord(JSON.parse(runText(["bun", "examples/reset-cycle/save-resume.ts", checkpointPath])) as JSONValue);
  assert(result.matchesContinuous === true, "saved reset-cycle execution must match the continuous execution");
  const cut = asRecord(result.cut as JSONValue);
  assert(
    cut.elapsedSec === 3 && cut.nextIndex === 0 && cut.pendingSec === 3 && cut.pendingDurationSec === 10,
    "reset-cycle example must stop three steps into the first ten-second cycle",
  );
  const final = asRecord(result.final as JSONValue);
  assert(
    final.elapsedSec === 30 && final.nextIndex === 3 && final.coins === 30 && final.points === 3 && final.accumulatedReward === 3,
    "reset-cycle example must finish thirty seconds with three resets",
  );
  const saved = asRecord(JSON.parse(await readText(checkpointPath)) as JSONValue);
  assert(
    saved.contract === "idlekit.reset-cycle-checkpoint" && saved.version === 1 && saved.pendingSec === 3,
    "reset-cycle example must persist the pending checkpoint as JSON",
  );
}

async function verifyEngineIntegrationExample(): Promise<void> {
  const example = "../../examples/engine-integration";
  const scenario = `${example}/scenario.json`;
  for (const doc of ["docs/engine-integration.md", "docs/engine-integration_ko.md"]) {
    const text = await readText(resolve(ROOT, doc));
    for (const command of ["idk export engine", "idk import scenario", "idk verify runtime"]) {
      assert(text.includes(command), `${doc} must document ${command}`);
    }
  }
  const committed: [string[], string][] = [
    [["--target", "generic"], "examples/engine-integration/cafe.engine-params.json"],
    [["--target", "godot"], "examples/engine-integration/godot/data/cafe_economy.tres"],
    [["--target", "godot", "--file-format", "json"], "examples/engine-integration/godot/data/cafe_economy.json"],
    [["--target", "unity"], "examples/engine-integration/unity/cafe_economy.json"],
    [["--target", "unity", "--file-format", "csv"], "examples/engine-integration/unity/cafe_levels.csv"],
  ];
  for (const [flags, path] of committed) {
    const generated = runCli(["export", "engine", scenario, ...flags, "--levels", "25"]);
    assert(generated === (await readText(resolve(ROOT, path))).replaceAll("\r\n", "\n"), `${path} is stale; regenerate it with idk export engine ${flags.join(" ")} --levels 25`);
  }
  for (const name of ["shop-levels.csv", "balance-sheet.json"]) {
    const base = name.replace(/\.(csv|json)$/, "");
    const out = resolve(tmpDir, `engine-import-${base}.json`);
    runCli(["import", "scenario", `${example}/import/${name}`, "--mapping", `${example}/import/${base}.mapping.json`, "--out", out]);
    assert(runCli(["validate", out]).includes("OK"), `imported ${name} must pass idk validate`);
  }
  const roundTripParams = resolve(tmpDir, "engine-roundtrip.params.json");
  const roundTripScenario = resolve(tmpDir, "engine-roundtrip.scenario.json");
  runCli(["export", "engine", scenario, "--out", roundTripParams]);
  runCli(["import", "scenario", roundTripParams, "--out", roundTripScenario]);
  assert(runCli(["validate", roundTripScenario]).includes("OK"), "engine export round trip must pass idk validate");
  const pluginFlags = ["--plugin", `${example}/ts-runtime/runtime-plugin.ts`, "--allow-plugin", "true", "--seed", "7", "--format", "json"];
  const exact = asRecord(runCliJson(["verify", "runtime", scenario, ...pluginFlags, "--runtime", "cafe.runtime.exact"]));
  assert(exact.ok === true, "cafe.runtime.exact must match the idlekit model");
  assert(asRecord(exact._meta as JSONValue).schemaRef === "docs/schemas/runtime.verify.output.schema.json", "verify runtime must report its schemaRef");
  const rounded = asRecord(
    runCliJson(["verify", "runtime", scenario, ...pluginFlags, "--runtime", "cafe.runtime", "--fail-on-mismatch", "false"]),
  );
  assert(rounded.ok === false && rounded.firstMismatch !== null, "cafe.runtime must report its rounded prices");
}

async function verifyChartExamples(): Promise<void> {
  const commands = await developmentExamples("docs/chart-interpretation.md", "simulate|experience|compare|experiment");
  const korean = await developmentExamples("docs/chart-interpretation_ko.md", "simulate|experience|compare|experiment");
  assert(commands.length === 4, "chart guide must provide four runnable examples");
  assert(JSON.stringify(commands) === JSON.stringify(korean), "English and Korean chart commands must match");
  const chartDir = resolve(ROOT, "tmp", "charts");
  await removePath(chartDir);
  await ensureDir(chartDir);
  const kinds: Record<string, string> = { simulate: "progression", experience: "progression", compare: "compare", experiment: "sensitivity" };
  for (const args of commands) {
    runCli(args);
    const flag = (name: string) => {
      const index = args.indexOf(name);
      assert(index >= 0 && args[index + 1], `chart example ${args[0]} must pass ${name}`);
      return resolve(ROOT, "packages/cli", args[index + 1]!);
    };
    const svg = await readText(flag("--chart-out"));
    assert(svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>"), `chart example ${args[0]} must write an SVG document`);
    const data = asRecord(JSON.parse(await readText(flag("--chart-data-out"))) as JSONValue);
    assert(data.contract === "idlekit.chart-data.v1" && data.schemaVersion === 1, `chart example ${args[0]} must write chart data v1`);
    assert(data.kind === kinds[args[0]!], `chart example ${args[0]} must write ${kinds[args[0]!]} chart data`);
    if (args.includes("md")) {
      const md = await readText(flag("--out"));
      assert(md.includes("## Decision hints"), `chart example ${args[0]} Markdown must include decision hints`);
    }
  }
}

async function main(): Promise<void> {
  await removePath(tmpDir);
  await ensureDir(tmpDir);
  await verifyCalibrationExamples();
  await verifyExperienceExamples();
  await verifyResetCycleExample();
  await verifyEngineIntegrationExample();
  await verifyIntroTrack();
  await verifyChartExamples();
  await verifyBuiltinModelTutorials();
  await verifyAdvancedAnalysisDocs();
  if (!isQuick) await verifyPluginTrack();
  console.log(`docs verification passed (${isQuick ? "quick" : "full"})`);
}

await main();
