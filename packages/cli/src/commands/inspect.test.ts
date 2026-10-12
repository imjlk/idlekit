import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { planResolvedRun } from "../lib/runConfiguration";
import { loadRegistries } from "../plugin/load";
import { createTempDir, readText, removePath, runCli, runCliJson, writeText } from "../testkit/bun";
import { validateScenarioV1 } from "@idlekit/core";

const scenarioSource = resolve(import.meta.dir, "../../../../examples/simple-linear.json");

async function scenarioFile(
  dir: string,
  patch: (raw: Record<string, unknown>) => void,
  name = "inspect.json",
): Promise<string> {
  const raw = JSON.parse(await readText(scenarioSource)) as Record<string, unknown>;
  const clock = raw.clock as { durationSec: number; stepSec: number };
  clock.durationSec = 10;
  clock.stepSec = 3;
  patch(raw);
  const scenario = resolve(dir, name);
  await writeText(scenario, JSON.stringify(raw));
  return scenario;
}

describe("idk inspect", () => {
  it("prints json when stdout is not a tty and keeps the resolved step plan", async () => {
    const dir = await createTempDir("idlekit-inspect-json");
    const scenario = await scenarioFile(dir, () => undefined);
    const json = runCliJson<any>(["inspect", scenario, "--step", "2", "--format", "json"]);
    expect(json.contract).toBe("idlekit.scenario-inspect.v1");
    expect(json.simulated).toBe(false);
    expect(json.doctor).toBe(false);
    expect(json._meta.command).toBe("inspect");
    const simulate = json.stages.find((stage: { name: string }) => stage.name === "simulate");
    const experience = json.stages.find((stage: { name: string }) => stage.name === "experience");
    expect(simulate.stepSec).toEqual({ value: 2, source: "command" });
    expect(simulate.stepCount).toBe(5);
    expect(experience.stepSec).toEqual({ value: 3, source: "scenario" });
    expect(experience.applies.session).toBe(true);
    expect(json.capabilities.flow).toBe("unknown");
    const loaded = await loadRegistries([]);
    const valid = validateScenarioV1(JSON.parse(await readText(scenario)), loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) throw new Error("scenario invalid");
    const prepared = planResolvedRun({
      scenario: valid.scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      stepSec: 2,
    });
    expect(json.engine.effectiveId).toBe(prepared.planFor("simulate").engine.effectiveId);
    expect(simulate.stepSec.value).toBe(prepared.planFor("simulate").stepSec.value);
    expect(experience.stepSec.value).toBe(prepared.planFor("experience").stepSec.value);
    // The stage reports its fast mode: the command override, or the inherited scenario setting.
    const fastOff = runCliJson<any>(["inspect", scenario, "--fast", "false", "--format", "json"]);
    const inherited = runCliJson<any>(["inspect", scenario, "--format", "json"]);
    const stageNamed = (report: any, name: string) => report.stages.find((stage: { name: string }) => stage.name === name);
    expect(stageNamed(fastOff, "simulate").fast).toEqual({ enabled: false, source: "command" });
    expect(stageNamed(inherited, "simulate").fast).toEqual({ enabled: false, source: "scenario" });
    // evaluate and ltv also open an ltv stage. Its horizon comes from the command, so its count is unknown.
    expect(stageNamed(inherited, "ltv").stepCount).toBe("unknown");
    expect(stageNamed(fastOff, "ltv").fast).toEqual({ enabled: false, source: "command" });
    // The executable commands' session flags, with the same schemas.
    const session = runCliJson<any>(["inspect", scenario, "--session-pattern", "twice-daily", "--days", "2", "--format", "json"]);
    expect(stageNamed(session, "experience").session).toMatchObject({ id: "twice-daily", days: 2, source: "command" });
    expect(runCli(["inspect", scenario, "--days", "1.5"], { check: false }).exitCode).not.toBe(0);
    expect(runCli(["inspect", scenario, "--session-pattern", "weekly"], { check: false }).exitCode).not.toBe(0);
    expect(runCli(["inspect", scenario, "--step", "0"], { check: false }).exitCode).not.toBe(0);
    expect(runCli(["inspect", scenario, "--step", "-1"], { check: false }).exitCode).not.toBe(0);
    const markdown = runCli(["inspect", scenario, "--strategy", "planner", "--format", "md"]);
    expect(markdown.stdout).toContain("This is not doctor");
    expect(markdown.stdout).toContain("The plan was not ticked.");
    expect(markdown.stdout).toContain("not a measured duration");
    await removePath(dir);
  }, 300000);

  it("does not import a plugin unless resolve-plugins is set", async () => {
    const dir = await createTempDir("idlekit-inspect-plugin");
    const scenario = await scenarioFile(dir, (raw) => {
      const model = raw.model as { params: Record<string, unknown> };
      model.params.incomePerSec = "1e400";
    });
    const blocked = resolve(dir, "blocked.ts");
    await writeText(blocked, `throw new Error("PLUGIN_LOADED_SENTINEL");\n`);
    const skipped = runCli(["inspect", scenario, "--plugin", blocked, "--format", "json"]);
    expect(skipped.stdout.includes("PLUGIN_LOADED_SENTINEL")).toBe(false);
    expect(skipped.stdout).toContain("plugin-skipped");
    const noted = resolve(dir, "noted.ts");
    await writeText(
      noted,
      `export const sourceText = "PLUGIN_SOURCE_SENTINEL";
export const models = [{ id: "noted", version: 1, create() { throw new Error("create called"); } }];
`,
    );
    const resolved = runCliJson<any>([
      "inspect",
      scenario,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      noted,
      "--plugin-root",
      dir,
      "--format",
      "json",
    ]);
    expect(resolved.plugins.userCode).toBe("may-run");
    expect(resolved.plugins.loadedIds).toContain("noted@1");
    expect(JSON.stringify(resolved).includes("PLUGIN_SOURCE_SENTINEL")).toBe(false);
    expect(resolved.invalid).toBe(false);
    expect(resolved.diagnostics.some((item: { code: string }) => item.code === "decimal-range")).toBe(true);
    // A plugin that replaces a built-in id is still a plugin registration.
    const replacing = resolve(dir, "replacing.ts");
    await writeText(
      replacing,
      `export const models = [{ id: "linear", version: 1, create() { throw new Error("CREATE_CALLED_SENTINEL"); } }];
`,
    );
    const replaced = runCliJson<any>([
      "inspect",
      scenario,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      replacing,
      "--plugin-root",
      dir,
      "--format",
      "json",
    ]);
    expect(replaced.plugins.loadedIds).toContain("linear@1");
    // Inspect plans without compiling, so the replacement's create is not called.
    expect(JSON.stringify(replaced).includes("CREATE_CALLED_SENTINEL")).toBe(false);
    expect(replaced.invalid).toBe(false);
    // A scenario whose model only a skipped plugin provides still reaches the report.
    const pluginOnly = await scenarioFile(dir, (raw) => {
      (raw.model as { id: string }).id = "noted";
    });
    const skippedModel = runCliJson<any>(["inspect", pluginOnly, "--plugin", noted, "--format", "json"]);
    const skippedNote = skippedModel.diagnostics.find((item: { code: string }) => item.code === "plugin-skipped");
    expect(skippedNote?.evidence.model).toBe("noted@1");
    expect(skippedModel.plugins.userCode).toBe("not-run");
    // A sign or a leading dot still marks a wide literal for the number engine.
    const signed = await scenarioFile(dir, (raw) => {
      (raw.model as { params: Record<string, unknown> }).params.incomePerSec = "+1e400";
    });
    const signedReport = runCliJson<any>(["inspect", signed, "--format", "json"]);
    expect(signedReport.diagnostics.some((item: { code: string }) => item.code === "decimal-range")).toBe(true);
    // A numeric-looking descriptive field never enters the engine, so it does not warn.
    const described = await scenarioFile(dir, (raw) => {
      raw.meta = { ...(raw.meta as Record<string, unknown>), id: "12345678901234567890" };
    });
    const describedReport = runCliJson<any>(["inspect", described, "--format", "json"]);
    expect(describedReport.diagnostics.some((item: { code: string }) => item.code === "decimal-range")).toBe(false);
    // A numeric-looking model id is an identifier, not an engine literal.
    const numericModel = resolve(dir, "numeric-model.ts");
    await writeText(numericModel, `export const models = [{ id: "1234567890123456", version: 1, create() { throw new Error("x"); } }];\n`);
    const numericScenario = await scenarioFile(dir, (raw) => {
      (raw.model as { id: string }).id = "1234567890123456";
    });
    const numericReport = runCliJson<any>([
      "inspect",
      numericScenario,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      numericModel,
      "--plugin-root",
      dir,
      "--format",
      "json",
    ]);
    expect(numericReport.diagnostics.some((item: { code: string }) => item.code === "decimal-range")).toBe(false);
    // An untilExpr literal is compared through the engine, so a wide one warns.
    const wideUntil = await scenarioFile(dir, (raw) => {
      (raw.clock as { untilExpr?: string }).untilExpr = "money >= 9999999999999999";
    });
    const wideUntilReport = runCliJson<any>(["inspect", wideUntil, "--format", "json"]);
    const untilWarning = wideUntilReport.diagnostics.find((item: { code: string }) => item.code === "decimal-range");
    expect(untilWarning?.evidence.literal).toBe("9999999999999999");
    // The wallet unit is an identifier, not an amount.
    const numericUnit = await scenarioFile(dir, (raw) => {
      (raw.unit as { code: string }).code = "12345678901234567890";
      (raw.initial as { wallet: { unit: string } }).wallet.unit = "12345678901234567890";
    });
    const numericUnitReport = runCliJson<any>(["inspect", numericUnit, "--format", "json"]);
    expect(numericUnitReport.diagnostics.some((item: { code: string }) => item.code === "decimal-range")).toBe(false);
    // A plugin objective is a plugin registration too.
    const objectivePlugin = resolve(dir, "objective.ts");
    await writeText(objectivePlugin, `export const objectives = [{ id: "plugin.goal", create() { throw new Error("x"); } }];\n`);
    const objectiveReport = runCliJson<any>([
      "inspect",
      scenario,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      objectivePlugin,
      "--plugin-root",
      dir,
      "--format",
      "json",
    ]);
    expect(objectiveReport.plugins.loadedIds).toContain("objective:plugin.goal");
    // A plugin strategy is a plugin registration, and a strategy only a skipped plugin provides still gets a report.
    const walker = resolve(dir, "walker.ts");
    await writeText(
      walker,
      `export const strategies = [
  { id: "plugin.walk", create() { throw new Error("WALK_CREATE_SENTINEL"); } },
  { id: "planner", defaultParams: { horizonSteps: 4 }, create() { throw new Error("PLANNER_CREATE_SENTINEL"); } },
];
`,
    );
    const walking = await scenarioFile(dir, (raw) => {
      raw.strategy = { id: "plugin.walk" };
    });
    const unresolvedWalk = runCliJson<any>(["inspect", walking, "--plugin", walker, "--format", "json"]);
    const walkNote = unresolvedWalk.diagnostics.find((item: { code: string }) => item.code === "plugin-skipped");
    expect(walkNote?.evidence.strategy).toBe("plugin.walk");
    expect(unresolvedWalk.stages).toEqual([]);
    const resolvedWalk = runCliJson<any>([
      "inspect",
      walking,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      walker,
      "--plugin-root",
      dir,
      "--strategy",
      "planner",
      "--format",
      "json",
    ]);
    expect(resolvedWalk.plugins.loadedIds).toContain("strategy:plugin.walk");
    expect(resolvedWalk.plugins.loadedIds).toContain("strategy:planner");
    // A plugin planner is not the built-in planner, so the built-in bound is not claimed for it.
    expect(resolvedWalk.planner).toBeNull();
    expect(JSON.stringify(resolvedWalk).includes("CREATE_SENTINEL")).toBe(false);
    await removePath(dir);
  }, 300000);

  it("plans the run the commands execute", async () => {
    const dir = await createTempDir("idlekit-inspect-plan");
    const hasDecimalRange = (report: any) =>
      report.diagnostics.some((item: { code: string }) => item.code === "decimal-range");
    // validateScenarioV1 accepts an infinite YAML step. The runner rejects it, so inspect does too.
    const scenario = await scenarioFile(dir, () => undefined);
    const infinite = resolve(dir, "infinite.yaml");
    await writeText(infinite, (await readText(scenario)).replace('"stepSec":3', '"stepSec":.inf'));
    const rejectedClock = runCli(["inspect", infinite, "--format", "json"], { check: false });
    expect(rejectedClock.exitCode).not.toBe(0);
    expect(`${rejectedClock.stdout}${rejectedClock.stderr}`).toContain("stepSec must be a finite number");
    // The scenario strategy's params are scanned only when that strategy runs.
    const wideParams = await scenarioFile(dir, (raw) => {
      raw.strategy = { id: "greedy", params: { schemaVersion: 1, objective: "minPayback", unused: "1e400" } };
    });
    expect(hasDecimalRange(runCliJson<any>(["inspect", wideParams, "--format", "json"]))).toBe(true);
    expect(hasDecimalRange(runCliJson<any>(["inspect", wideParams, "--strategy", "planner", "--format", "json"]))).toBe(
      false,
    );
    // ltv forces an uncapped action log on its segments, and a session keeps every action.
    const plain = await scenarioFile(dir, (raw) => {
      (raw.outputs as { report: { includeTrace: boolean } }).report.includeTrace = false;
      raw.sim = { eventLog: { enabled: false } };
    });
    const plainReport = runCliJson<any>(["inspect", plain, "--format", "json"]);
    const stageNamed = (name: string) => plainReport.stages.find((stage: { name: string }) => stage.name === name);
    expect(stageNamed("ltv").actionsLog).toEqual({ kept: true, maxActions: null, unlimited: true });
    expect(stageNamed("experience").actionsLog).toEqual({ kept: true, maxActions: null, unlimited: true });
    expect(stageNamed("simulate").actionsLog).toEqual({ kept: false, maxActions: null, unlimited: false });
    // A session forces an uncapped trace of every step even when the scenario has no trace.
    expect(stageNamed("experience").stateTrace).toEqual({ kept: true, everySteps: 1, maxPoints: null, unlimited: true });
    expect(stageNamed("simulate").stateTrace.kept).toBe(false);
    expect(stageNamed("ltv").stateTrace.kept).toBe(false);
    // Only the typed unknown-strategy error marks a skipped plugin strategy. Other errors still fail.
    const blocked = resolve(dir, "blocked.ts");
    await writeText(blocked, `throw new Error("PLUGIN_LOADED_SENTINEL");\n`);
    const badMoney = await scenarioFile(dir, (raw) => {
      (raw.initial as { wallet: { amount: string } }).wallet.amount = "Unknown strategy";
    });
    const failed = runCli(["inspect", badMoney, "--plugin", blocked, "--format", "json"], { check: false });
    expect(failed.exitCode).not.toBe(0);
    expect(failed.stdout.includes("plugin-skipped")).toBe(false);
    // Only the engine resolver's rejection is bad-engine. An amount that names an engine is a scenario error.
    const engineNamed = await scenarioFile(dir, (raw) => {
      (raw.initial as { wallet: { amount: string } }).wallet.amount = "breakEternity";
    });
    const moneyFailed = runCli(["inspect", engineNamed, "--format", "json"], { check: false });
    expect(moneyFailed.exitCode).not.toBe(0);
    expect(moneyFailed.stdout.includes("bad-engine")).toBe(false);
    expect(moneyFailed.stderr.includes("UNSUPPORTED_ENGINE")).toBe(false);
    // A skipped plugin may replace a built-in model with other params, so the built-in schema does not reject them.
    const replacement = resolve(dir, "replacement.ts");
    await writeText(replacement, `export const models = [{ id: "linear", version: 1, create() { throw new Error("x"); } }];\n`);
    const numericParams = await scenarioFile(dir, (raw) => {
      (raw.model as { params: Record<string, unknown> }).params.incomePerSec = 1;
    });
    expect(runCli(["inspect", numericParams, "--format", "json"], { check: false }).exitCode).not.toBe(0);
    const replaced = runCliJson<any>(["inspect", numericParams, "--plugin", replacement, "--format", "json"]);
    const replacedNote = replaced.diagnostics.find((item: { code: string }) => item.code === "plugin-skipped");
    expect(replacedNote?.evidence.model).toBe("linear@1");
    expect(replaced.invalid).toBe(false);
    // Skipped plugins need no trust policy, so a missing trust file or a malformed digest does not stop the report.
    const baseline = await scenarioFile(dir, () => undefined, "baseline.json");
    const untrusted = runCliJson<any>([
      "inspect",
      baseline,
      "--plugin",
      replacement,
      "--plugin-trust-file",
      resolve(dir, "missing-trust.json"),
      "--plugin-sha256",
      "not-a-digest",
      "--format",
      "json",
    ]);
    expect(untrusted.diagnostics.some((item: { code: string }) => item.code === "plugin-skipped")).toBe(true);
    // A skipped plugin may replace a built-in strategy with other params, so the built-in schema does not reject
    // them and the built-in planner bound is not claimed.
    const pluginPlanner = await scenarioFile(dir, (raw) => {
      raw.strategy = { id: "planner", params: { pluginOnly: true, horizonSteps: "deep" } };
    });
    expect(runCli(["inspect", pluginPlanner, "--format", "json"], { check: false }).exitCode).not.toBe(0);
    const skippedPlanner = runCliJson<any>(["inspect", pluginPlanner, "--plugin", replacement, "--format", "json"]);
    const plannerNote = skippedPlanner.diagnostics.find((item: { code: string }) => item.code === "plugin-skipped");
    expect(plannerNote?.evidence.strategy).toBe("planner");
    const builtinPlanner = runCliJson<any>([
      "inspect",
      baseline,
      "--strategy",
      "planner",
      "--plugin",
      replacement,
      "--format",
      "json",
    ]);
    expect(builtinPlanner.planner).toBeNull();
    expect(runCliJson<any>(["inspect", baseline, "--strategy", "planner", "--format", "json"]).planner).not.toBeNull();
    // A resolved plugin's digest is in the output metadata, as the executable commands record it.
    const digested = runCliJson<any>([
      "inspect",
      baseline,
      "--resolve-plugins",
      "--allow-plugin",
      "--plugin",
      replacement,
      "--plugin-root",
      dir,
      "--format",
      "json",
    ]);
    expect(Object.values(digested._meta.pluginDigest ?? {}).length).toBe(1);
    // analysis.prestigeCycle.scan is parsed by prestige-cycle from its flag, not by the engine, so it does not warn.
    const scanText = await scenarioFile(dir, (raw) => {
      raw.analysis = { prestigeCycle: { scan: "9999999999999999" } };
    });
    expect(hasDecimalRange(runCliJson<any>(["inspect", scanText, "--format", "json"]))).toBe(false);
    // A var compared in untilExpr is read with Number only when it is a number. A string var is compared as text.
    const varUntil = (expr: string) =>
      scenarioFile(dir, (raw) => {
        (raw.initial as { vars: Record<string, unknown> }).vars = { owned: 0, code: "x" };
        (raw.clock as { untilExpr?: string }).untilExpr = expr;
      });
    const stringVar = await varUntil("vars.code == 9999999999999999");
    expect(hasDecimalRange(runCliJson<any>(["inspect", stringVar, "--engine", "breakInfinity", "--format", "json"]))).toBe(
      false,
    );
    const numberVar = await varUntil("vars.owned >= 9999999999999999");
    expect(hasDecimalRange(runCliJson<any>(["inspect", numberVar, "--engine", "breakInfinity", "--format", "json"]))).toBe(
      true,
    );
    await removePath(dir);
  }, 300000);

  it("rejects a bad engine and still explains it", async () => {
    const dir = await createTempDir("idlekit-inspect-engine");
    const scenario = await scenarioFile(dir, () => undefined);
    const failed = runCli(["inspect", scenario, "--engine", "breakEternity", "--format", "json"], { check: false });
    expect(failed.exitCode).not.toBe(0);
    const report = JSON.parse(failed.stdout) as { invalid: boolean; diagnostics: { code: string }[] };
    expect(report.invalid).toBe(true);
    expect(report.diagnostics.some((item) => item.code === "bad-engine")).toBe(true);
    const help = runCli(["inspect", "--help"], { check: false });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toLowerCase()).toContain("inspect");
    const completions = runCli(["complete", "zsh"], { check: false });
    expect(completions.exitCode).toBe(0);
    expect(completions.stdout.length).toBeGreaterThan(0);
    // Gunshi lists commands in the root help; the Bunli "complete" listing is gone on main.
    const listed = runCli(["--help"], { check: false });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("inspect");
    await removePath(dir);
  }, 300000);
});
