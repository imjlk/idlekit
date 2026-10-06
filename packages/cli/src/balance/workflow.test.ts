import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBalanceFixture } from "../testkit/balanceFixture";
import { refreshBalanceWorkflow } from "./workflow";
import { parseCsv, stringifyCsv } from "./sheet";
import { runScenario, validateScenarioV1 } from "@idlekit/core";
import { loadRegistriesFromFlags } from "../commands/_shared/plugin";
import { prepareResolvedRun } from "../lib/runConfiguration";

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "idlekit-sheet-e2e-"));
  folders.push(root);
  const directory = resolve(root, "fixture");
  const created = await createBalanceFixture(directory);
  // Keep this integration gate short; individual pacing tests cover full sweep ordering.
  created.config.pacing.sensitivity = [];
  await writeFile(resolve(directory, "workflow.json"), JSON.stringify(created.config));
  return { ...created, directory, configPath: resolve(directory, "workflow.json") };
}

describe("typed sheet -> scenario -> pacing -> result sheet", () => {
  it("exports opt-in sensitivity scenarios with stable IDs and verifies their freshness", async () => {
    const f = await fixture();
    f.config.pacing.sensitivity = [{ path: "machine.alpha.cost", values: [12, 6, 3] }];
    await writeFile(f.configPath, JSON.stringify({ ...f.config, exportVariants: true }));
    const output = await refreshBalanceWorkflow(f.configPath, f.flags);
    const index = JSON.parse(await readFile(resolve(output.generationPath, "variants.json"), "utf8"));
    expect(index).toMatchObject({ version: 1, engine: "number", seeds: [7], horizonSec: 60, strategy: "fixture.buy" });
    expect(index.variants).toEqual([
      { id: "baseline", scenario: "scenario.json" },
      { id: "machine.alpha.cost=3", scenario: "scenario-001.json" },
      { id: "machine.alpha.cost=12", scenario: "scenario-002.json" },
    ]);
    const changed = JSON.parse(await readFile(resolve(output.generationPath, index.variants[1].scenario), "utf8"));
    expect(changed.model.params.machines[0].cost).toBe(3);
    expect(changed.initial.wallet.amount).toBe("0");
    expect(changed.clock.durationSec).toBe(60);
    expect(changed.sim.offline.maxSec).toBe(120);
    expect((await refreshBalanceWorkflow(f.configPath, f.flags, true)).state).toBe("current");
    await rm(resolve(output.generationPath, index.variants[1].scenario));
    await writeFile(resolve(output.generationPath, index.variants[1].scenario), "{}");
    expect((await refreshBalanceWorkflow(f.configPath, f.flags, true)).state).toBe("stale");
  });

  it("keeps invalid variants as explicit errors without publishing a misleading executable", async () => {
    const f = await fixture();
    f.config.pacing.sensitivity = [{ path: "machine.alpha.cost", values: [0] }];
    await writeFile(f.configPath, JSON.stringify({ ...f.config, exportVariants: true }));
    const output = await refreshBalanceWorkflow(f.configPath, f.flags);
    expect(output.outcome.status).toBe("error");
    const index = JSON.parse(await readFile(resolve(output.generationPath, "variants.json"), "utf8"));
    expect(index.variants[1]).toMatchObject({ id: "machine.alpha.cost=0", scenario: null });
    expect(index.variants[1].error).toContain("min");
  });

  it("preflights the opt-in artifact count and preserves the prior generation", async () => {
    const f = await fixture();
    const first = await refreshBalanceWorkflow(f.configPath, f.flags);
    expect(Object.keys(first.artifacts).sort()).toEqual(["inputs.csv", "provenance.json", "results.csv", "results.json", "scenario.json"]);
    const pointer = await readFile(resolve(f.directory, "results/current.json"), "utf8");
    const pacing = { ...f.config.pacing, limits: { maxRuns: 100, maxResults: 100 }, sensitivity: [{ path: "rate", values: Array.from({ length: 59 }, (_, index) => index + 3) }] };
    await writeFile(f.configPath, JSON.stringify({ ...f.config, pacing, exportVariants: true }));
    await expect(refreshBalanceWorkflow(f.configPath, f.flags)).rejects.toThrow("Variant export");
    expect(await readFile(resolve(f.directory, "results/current.json"), "utf8")).toBe(pointer);
  });

  it("does not advertise sheet-valid but scenario-invalid variants as executable", async () => {
    const f = await fixture();
    delete f.schema.fields.find((field) => field.id === "awayCap")!.min;
    await writeFile(resolve(f.directory, "schema.json"), JSON.stringify(f.schema));
    f.config.pacing.sensitivity = [{ path: "awayCap", values: [-1] }];
    await writeFile(f.configPath, JSON.stringify({ ...f.config, exportVariants: true }));
    const output = await refreshBalanceWorkflow(f.configPath, f.flags);
    expect(output.outcome.status).toBe("error");
    const index = JSON.parse(await readFile(resolve(output.generationPath, "variants.json"), "utf8"));
    expect(index.variants[1]).toMatchObject({ id: "awayCap=-1", scenario: null });
    expect(index.variants[1].error).toContain("Scenario validation failed");
    expect(output.artifacts["scenario-001.json"]).toBeUndefined();
  });

  it("aborts an oversized variant bundle rather than downgrading a byte-budget failure to a variant error", async () => {
    const f = await fixture();
    const template = { ...f.template, model: { ...f.template.model, params: { ...f.template.model.params, padding: "x".repeat(2 * 1024 * 1024) } } };
    await writeFile(resolve(f.directory, "scenario-template.json"), JSON.stringify(template));
    await refreshBalanceWorkflow(f.configPath, f.flags);
    const pointer = await readFile(resolve(f.directory, "results/current.json"), "utf8");
    const pacing = { ...f.config.pacing, horizonSec: 1, limits: { maxRuns: 100, maxResults: 100 }, sensitivity: [{ path: "rate", values: Array.from({ length: 32 }, (_, index) => index + 3) }] };
    await writeFile(f.configPath, JSON.stringify({ ...f.config, pacing, exportVariants: true }));
    await expect(refreshBalanceWorkflow(f.configPath, f.flags)).rejects.toThrow("Variant export outputs exceed byte limit");
    expect(await readFile(resolve(f.directory, "results/current.json"), "utf8")).toBe(pointer);
  }, 90_000);

  it("roundtrips numeric parameters, detects edits as stale, and reports a perturbed target breach", async () => {
    const f = await fixture();
    const first = await refreshBalanceWorkflow(f.configPath, f.flags);
    if (!("generationPath" in first)) throw new Error("Expected a refresh generation");
    const scenario = JSON.parse(await readFile(resolve(first.generationPath, "scenario.json"), "utf8"));
    expect(scenario.model.params).toEqual(f.template.model.params);
    const report = JSON.parse(await readFile(resolve(first.generationPath, "results.json"), "utf8"));
    expect(report.ok).toBe(true);
    expect(report.runs[0].results.find((result: { metric: string }) => result.metric === "firstMachineSec").value).toBe(3);
    const resultCsv = parseCsv(await readFile(resolve(first.generationPath, "results.csv"), "utf8"));
    expect(resultCsv[0]).toContain("status");
    expect(resultCsv.length).toBe(2);
    expect((await refreshBalanceWorkflow(f.configPath, f.flags, true)).state).toBe("current");
    const repeated = await refreshBalanceWorkflow(f.configPath, f.flags);
    expect(JSON.parse(await readFile(resolve(repeated.generationPath, "results.json"), "utf8"))).toEqual(report);

    const inputPath = resolve(f.directory, "parameters.csv");
    const rows = parseCsv(await readFile(inputPath, "utf8"));
    rows.find((row) => row[0] === "machine.alpha.cost")![1] = "60";
    await writeFile(inputPath, stringifyCsv(rows));
    expect((await refreshBalanceWorkflow(f.configPath, f.flags, true)).state).toBe("stale");
    const second = await refreshBalanceWorkflow(f.configPath, f.flags);
    if (!("generationPath" in second)) throw new Error("Expected refresh generation");
    expect(second.inputFingerprint).not.toBe(first.inputFingerprint);
    const changed = JSON.parse(await readFile(resolve(second.generationPath, "results.json"), "utf8"));
    expect(changed.ok).toBe(false);
    expect(changed.runs[0].results.find((result: { metric: string }) => result.metric === "firstMachineSec").status).toBe("breach");
    expect(JSON.parse(await readFile(resolve(first.generationPath, "results.json"), "utf8"))).toEqual(report);
    expect((await refreshBalanceWorkflow(f.configPath, f.flags, true)).state).toBe("current");
  }, 90_000);

  it("rejects formula values and preserves the last complete generation", async () => {
    const f = await fixture();
    await refreshBalanceWorkflow(f.configPath, f.flags);
    const pointer = await readFile(resolve(f.directory, "results/current.json"), "utf8");
    const path = resolve(f.directory, "parameters.csv");
    const csv = await readFile(path, "utf8");
    await writeFile(path, csv.replace("machine.alpha.cost,6,", "machine.alpha.cost,=3+3,"));
    await expect(refreshBalanceWorkflow(f.configPath, f.flags)).rejects.toThrow();
    expect(await readFile(resolve(f.directory, "results/current.json"), "utf8")).toBe(pointer);
  }, 90_000);

  it("binds authoritative startBalance and awayCap values into the executable scenario", async () => {
    const f = await fixture();
    const path = resolve(f.directory, "parameters.csv");
    const rows = parseCsv(await readFile(path, "utf8"));
    rows.find((row) => row[0] === "startBalance")![1] = "10";
    rows.find((row) => row[0] === "awayCap")![1] = "300";
    await writeFile(path, stringifyCsv(rows));
    const output = await refreshBalanceWorkflow(f.configPath, f.flags);
    if (!("generationPath" in output)) throw new Error("Expected refresh generation");
    const scenario = JSON.parse(await readFile(resolve(output.generationPath, "scenario.json"), "utf8"));
    expect(scenario.initial.wallet.amount).toBe("10");
    expect(scenario.sim.offline.maxSec).toBe(300);
  }, 90_000);

  it("rejects reordered entity slots instead of applying a stable ID to the wrong facility", async () => {
    const f = await fixture();
    const path = resolve(f.directory, "scenario-template.json");
    const template = JSON.parse(await readFile(path, "utf8"));
    template.model.params.machines.reverse();
    await writeFile(path, JSON.stringify(template));
    await expect(refreshBalanceWorkflow(f.configPath, f.flags)).rejects.toThrow();
  });

  it("rejects cross-unit bindings before publishing", async () => {
    const f = await fixture();
    f.config.bindings[0]!.field = "awayCap";
    await writeFile(f.configPath, JSON.stringify(f.config));
    await expect(refreshBalanceWorkflow(f.configPath, f.flags)).rejects.toThrow("unit");
  });

  it("exports the effective horizon and strategy settings for standalone seeded replay", async () => {
    const f = await fixture();
    const path = resolve(f.directory, "scenario-template.json");
    const template = JSON.parse(await readFile(path, "utf8"));
    template.clock.untilExpr = "t >= 1";
    template.clock.durationSec = 1;
    template.sim.fast = true;
    template.strategy.params = { retainedMarker: 7 };
    await writeFile(path, JSON.stringify(template));
    const output = await refreshBalanceWorkflow(f.configPath, f.flags);
    const document = JSON.parse(await readFile(resolve(output.generationPath, "scenario.json"), "utf8"));
    expect(document.clock.durationSec).toBe(60);
    expect(document.clock.untilExpr).toBeUndefined();
    expect(document.sim.fast).toBe(false);
    expect(document.strategy.params).toEqual({ retainedMarker: 7 });
    const loaded = await loadRegistriesFromFlags(f.flags);
    const valid = validateScenarioV1(document, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) throw new Error("Published scenario invalid");
    const prepared = prepareResolvedRun({ scenario: valid.scenario, modelRegistry: loaded.modelRegistry, strategyRegistry: loaded.strategyRegistry, seed: 7, engineRequest: "number" });
    const standalone = runScenario(prepared.open("simulate", "simulate:7").scenario);
    const report = JSON.parse(await readFile(resolve(output.generationPath, "results.json"), "utf8"));
    const firstMachine = report.runs[0].results.find((result: { metric: string }) => result.metric === "firstMachineSec");
    expect(standalone.actionsLog?.find((action) => action.actionId === "buy.machine")?.elapsedSec).toBe(firstMachine.value);
    const provenance = JSON.parse(await readFile(resolve(output.generationPath, "provenance.json"), "utf8"));
    expect(provenance.trialIdTemplate).toBe("simulate:<seed>");
  }, 90_000);
});
