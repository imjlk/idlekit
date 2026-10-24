import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { resolve } from "path";
import { createTempDir, readJson, readText, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

/** Sorted-key JSON, the text the experiment spec hashes for its scenario. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

describe("experiment command", () => {
  let dir = "";
  let specPath = "";
  let malformedPath = "";
  let pluginPath = "";
  let bareSpecPath = "";
  let chosenSpecPath = "";
  let boomFlags: string[] = [];
  let boomSpecPath = "";
  let cliVersion = "";

  beforeAll(async () => {
    dir = await createTempDir("idk-experiment-");
    cliVersion = (await readJson<{ version: string }>(resolve(import.meta.dir, "../../package.json"))).version;
    const scenario = JSON.parse(await readText(BASELINE));
    // Engine metadata names a version. It is metadata only and is not the engine that runs.
    scenario.engine = { name: "breakInfinity", version: "9.9.9" };
    const scenarioPath = resolve(dir, "scenario.json");
    await writeText(scenarioPath, JSON.stringify(scenario, null, 2));
    specPath = resolve(dir, "spec.json");
    await writeText(
      specPath,
      JSON.stringify({
        schemaVersion: 1,
        scenario: { ref: scenarioPath, hash: createHash("sha256").update(canonical(scenario)).digest("hex") },
        model: { id: scenario.model.id, version: scenario.model.version },
        metricId: "endMoney",
        dimensions: [
          {
            id: "income",
            target: "model",
            path: "incomePerSec",
            space: { kind: "choice", values: ["1", "2"] },
            baseline: "1",
            probes: ["2"],
          },
        ],
        budget: { candidates: 2, seeds: 1 },
        seeds: [7],
        horizonSec: 30,
        stepSec: 1,
        session: { pattern: "always-on", days: 1 },
      }),
    );
    // A scenario without a strategy, run once as is and once with a strategy chosen by the spec.
    const { strategy: _strategy, ...bare } = scenario;
    const barePath = resolve(dir, "bare.json");
    await writeText(barePath, JSON.stringify(bare, null, 2));
    const bareSpec = {
      ...JSON.parse(await readText(specPath)),
      scenario: { ref: barePath, hash: createHash("sha256").update(canonical(bare)).digest("hex") },
    };
    bareSpecPath = resolve(dir, "bare-spec.json");
    await writeText(bareSpecPath, JSON.stringify(bareSpec));
    chosenSpecPath = resolve(dir, "chosen-spec.json");
    await writeText(chosenSpecPath, JSON.stringify({ ...bareSpec, strategy: { id: "greedy" } }));
    // A plugin model whose create throws. A spec rejection must come before run preparation creates it.
    const boomPlugin = resolve(dir, "boom-plugin.mjs");
    await writeText(boomPlugin, `export const models = [{ id: "plugin.boom", version: 1, create: () => { throw new Error("boom create ran"); } }];\n`);
    boomFlags = ["--plugin", boomPlugin, "--allow-plugin", "true"];
    const boom = { ...bare, model: { id: "plugin.boom", version: 1, params: {} } };
    const boomPath = resolve(dir, "boom.json");
    await writeText(boomPath, JSON.stringify(boom, null, 2));
    boomSpecPath = resolve(dir, "boom-spec.json");
    await writeText(
      boomSpecPath,
      JSON.stringify({
        ...bareSpec,
        scenario: { ref: boomPath, hash: createHash("sha256").update(canonical(boom)).digest("hex") },
        model: { id: "plugin.boom", version: 1 },
        dimensions: [],
        seeds: [7, 7],
        budget: { candidates: 1, seeds: 2 },
      }),
    );
    // A plugin that adds an unused strategy still changes the loaded code, so it must reach provenance.
    pluginPath = resolve(dir, "noop-plugin.mjs");
    await writeText(pluginPath, `export const strategies = [{ id: "plugin.noop", create: () => ({ id: "plugin.noop", decide: () => [] }) }];\n`);
    malformedPath = resolve(dir, "malformed.json");
    await writeText(malformedPath, JSON.stringify({ schemaVersion: 1, scenario: { ref: 42, hash: "x" } }));
  });

  afterAll(async () => {
    if (dir) await removePath(dir);
  });

  it("records the engine that ran, not the scenario engine metadata", () => {
    const byDefault = runCliJson(["experiment", specPath]);
    const tasks = (byDefault.data ?? byDefault).tasks as { engineId: string; engineVersion: string }[];
    expect(tasks.length).toBe(2);
    for (const task of tasks) {
      expect(task.engineId).toBe("number");
      expect(task.engineVersion).toBe(`idlekit-cli@${cliVersion}`);
    }
    const flagged = runCliJson(["experiment", specPath, "--engine", "breakInfinity"]);
    for (const task of (flagged.data ?? flagged).tasks as { engineId: string; engineVersion: string }[]) {
      expect(task.engineId).toBe("breakInfinity");
      expect(task.engineVersion).toBe(`idlekit-cli@${cliVersion}`);
    }
  });

  it("records loaded plugin digests in the run hash and output meta", () => {
    const plain = runCliJson(["experiment", specPath]);
    const plugged = runCliJson(["experiment", specPath, "--plugin", pluginPath, "--allow-plugin", "true"]);
    expect(Object.keys(plain._meta.pluginDigest)).toEqual([]);
    expect(Object.values(plugged._meta.pluginDigest)).toHaveLength(1);
    expect(plugged.effectiveRunHash).not.toBe(plain.effectiveRunHash);
  });

  it("hashes the strategy the spec chooses for a scenario without one", () => {
    const bareRun = runCliJson(["experiment", bareSpecPath]);
    const chosenRun = runCliJson(["experiment", chosenSpecPath]);
    expect(bareRun.tasks[0].strategyId).toBeNull();
    expect(chosenRun.tasks[0].strategyId).toBe("greedy");
    expect(chosenRun.effectiveRunHash).not.toBe(bareRun.effectiveRunHash);
  });

  it("rejects a semantically invalid spec before any model is created", () => {
    const failed = runCliFailure(["experiment", boomSpecPath, ...boomFlags]);
    const output = `${failed.stderr}\n${failed.stdout}`;
    expect(output).toContain("EXPERIMENT_SPEC_INVALID");
    expect(output).toContain("seeds must be unique");
    expect(output).not.toContain("boom create ran");
  });

  it("rejects a malformed spec before resolving its scenario", () => {
    const failed = runCliFailure(["experiment", malformedPath]);
    const output = `${failed.stderr}\n${failed.stdout}`;
    expect(output).toContain("EXPERIMENT_SPEC_INVALID");
    expect(output).toContain("scenario.ref");
  });

  it("reports first milestone time from a plugin model", async () => {
    const progressPlugin = resolve(dir, "progress-plugin.mjs");
    await writeText(progressPlugin, `export const models = [{
      id: "plugin.progress", version: 1, create: () => ({
        id: "plugin.progress", version: 1,
        income: ctx => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
        actions: () => [],
        evolve: (_ctx, state) => ({ ...state, vars: { ...state.vars, steps: (state.vars.steps ?? 0) + 1 } }),
        milestones: (_ctx, _prev, next) => next.vars.steps === 5 ? ["floor.unlocked"] : []
      })
    }];\n`);
    const scenario = JSON.parse(await readText(BASELINE));
    delete scenario.strategy;
    scenario.model = { id: "plugin.progress", version: 1, params: {} };
    const progressPath = resolve(dir, "progress.json");
    await writeText(progressPath, JSON.stringify(scenario));
    const progressSpecPath = resolve(dir, "progress-spec.json");
    await writeText(progressSpecPath, JSON.stringify({
      ...JSON.parse(await readText(bareSpecPath)),
      scenario: { ref: progressPath, hash: createHash("sha256").update(canonical(scenario)).digest("hex") },
      model: { id: "plugin.progress", version: 1 },
      metricId: "timeToMilestone",
      milestoneKey: "floor.unlocked",
      dimensions: [],
    }));
    const report = runCliJson(["experiment", progressSpecPath, "--plugin", progressPlugin, "--allow-plugin", "true"]);
    expect(report.milestoneKey).toBe("floor.unlocked");
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]).toMatchObject({ metricId: "timeToMilestone", status: "observed", value: "5" });
    expect(Object.values(report._meta.pluginDigest)).toHaveLength(1);
  });
});
