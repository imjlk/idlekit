import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { planResolvedRun } from "../lib/runConfiguration";
import { loadRegistries } from "../plugin/load";
import { createTempDir, readText, removePath, runCli, runCliJson, writeText } from "../testkit/bun";
import { validateScenarioV1 } from "@idlekit/core";

const scenarioSource = resolve(import.meta.dir, "../../../../examples/simple-linear.json");

async function scenarioFile(dir: string, patch: (raw: Record<string, unknown>) => void): Promise<string> {
  const raw = JSON.parse(await readText(scenarioSource)) as Record<string, unknown>;
  const clock = raw.clock as { durationSec: number; stepSec: number };
  clock.durationSec = 10;
  clock.stepSec = 3;
  patch(raw);
  const scenario = resolve(dir, "inspect.json");
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
  }, 60000);

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
    await removePath(dir);
  }, 60000);

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
  }, 60000);
});
