import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { loadRegistries } from "../plugin/load";
import { createTempDir, readText, removePath, runCli, runCliJson, writeText } from "../testkit/bun";

const scenarioSource = resolve(import.meta.dir, "../../../../examples/simple-linear.json");

async function shortScenario(dir: string): Promise<string> {
  const raw = JSON.parse(await readText(scenarioSource)) as { clock: { durationSec: number } };
  raw.clock.durationSec = 8;
  const scenario = resolve(dir, "short.json");
  await writeText(scenario, JSON.stringify(raw));
  return scenario;
}

describe("idk analyze", () => {
  it("renders growth json and markdown from the registry adapter", async () => {
    const dir = await createTempDir("idlekit-analyze-growth");
    const scenario = await shortScenario(dir);
    const json = runCliJson<any>(["analyze", "growth", scenario, "--window", "2", "--format", "json"]);
    expect(json.algorithmVersion).toBe("growth-report-v1");
    expect(json.kind).toBe("postprocess");
    expect(json.value.seriesRequested).toBe("money");
    expect(json._meta.command).toBe("analyze");
    expect(json.provenance.semantics).toEqual({ sessionKey: "none", strategyKey: "greedy", horizonSec: 8, stepSec: 1, seed: null });
    const fractional = runCli(["analyze", "growth", scenario, "--trace-every", "1.5"], { check: false });
    expect(fractional.exitCode).not.toBe(0);
    const markdown = runCli(["analyze", "growth", scenario, "--window", "5", "--format", "md"]);
    expect(markdown.stdout).toContain("growth-report-v1");
    expect(markdown.stdout).toContain("```json");
    await removePath(dir);
  }, 60000);

  it("matches eta algorithm version without a network call", async () => {
    const dir = await createTempDir("idlekit-analyze-eta");
    const scenario = await shortScenario(dir);
    const json = runCliJson<any>([
      "analyze",
      "eta",
      scenario,
      "--target-money",
      "5",
      "--max-duration",
      "20",
      "--budget-duration",
      "20",
      "--format",
      "json",
    ]);
    expect(json.algorithmVersion).toBe("eta-estimate-v1");
    expect(json.value.estimate.algorithmVersion).toBe("eta-estimate-v1");
    expect(json.value.mode).toBe("simulate");
    expect(json.provenance.freshRuns).toBe(1);
    expect(json.provenance.semantics.strategyKey).toBe("greedy");
    expect(json.provenance.semantics.horizonSec).toBe(20);
    await removePath(dir);
  }, 60000);

  it("does not import a plugin before allow-plugin and isolates a bad analyzer", async () => {
    const dir = await createTempDir("idlekit-analyze-plugin");
    const blocked = resolve(dir, "blocked.ts");
    await writeText(blocked, `throw new Error("PLUGIN_LOADED_SENTINEL");\n`);
    const failed = runCli(["analyze", "growth", "--plugin", blocked], { check: false });
    expect(failed.exitCode).not.toBe(0);
    expect(`${failed.stderr}\n${failed.stdout}`).not.toContain("PLUGIN_LOADED_SENTINEL");
    expect(`${failed.stderr}\n${failed.stdout}`).toContain("Plugin loading is disabled");

    const plugin = resolve(dir, "analyzers.ts");
    await writeText(
      plugin,
      `export const analyzers = [
        { id: "growth", version: "1", kind: "postprocess" },
        {
          id: "plugin.note",
          version: "1",
          kind: "postprocess",
          validateParams: () => ({ ok: true, params: {} }),
          requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
          observation: { windowSec: null, sampleCadenceSec: null, coverage: "summary", metricIds: [], observationSchema: "idlekit.run-observation" },
          outputContract: "test.analyzer",
          algorithmVersion: "plugin-note-v1",
          cost: { freshRuns: 0, samples: 0 },
          dependencies: [],
          postprocess: () => ({ status: "ok", value: "note" }),
        },
      ];
      `,
    );
    const loaded = await loadRegistries([plugin], { allowedRoots: [dir] });
    expect(loaded.analyzerFailures.length).toBe(1);
    expect(loaded.analyzerRegistry.get("growth", "1")).toBeDefined();
    expect(loaded.analyzerRegistry.get("eta", "1")).toBeDefined();
    expect(loaded.analyzerRegistry.get("plugin.note", "1")).toBeDefined();
    const note = loaded.analyzerRegistry.run({
      requests: [{ id: "plugin.note", version: "1", params: {} }],
      semantics: { sessionKey: "none", strategyKey: "none", horizonSec: 1, stepSec: 1, seed: null },
      allowExecution: false,
    });
    expect(note.results[0]?.value).toBe("note");
    await removePath(dir);
  }, 60000);

  it("runs a registered execution analyzer inside the budget flags and records the plugin digest", async () => {
    const dir = await createTempDir("idlekit-analyze-exec");
    const scenario = await shortScenario(dir);
    const plugin = resolve(dir, "exec.ts");
    await writeText(
      plugin,
      `export const analyzers = [
        {
          id: "plugin.exec",
          version: "1",
          kind: "execution",
          validateParams: () => ({ ok: true, params: {} }),
          requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
          observation: { windowSec: null, sampleCadenceSec: null, coverage: "summary", metricIds: [], observationSchema: "idlekit.run-observation" },
          outputContract: "test.analyzer",
          algorithmVersion: "plugin-exec-v1",
          cost: { freshRuns: 1, samples: 1 },
          dependencies: [],
          execute: (_params, ctx) => {
            const run = ctx.requestRun("plugin.exec").run();
            return run ? { status: "ok", value: { endT: run.end.t } } : { status: "insufficient-data", value: null, rerun: true };
          },
        },
        {
          id: "plugin.read",
          version: "1",
          kind: "postprocess",
          validateParams: () => ({ ok: true, params: {} }),
          requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
          observation: { windowSec: null, sampleCadenceSec: 2, coverage: "trace", metricIds: ["money"], observationSchema: "idlekit.run-observation" },
          outputContract: "test.analyzer",
          algorithmVersion: "plugin-read-v1",
          cost: { freshRuns: 0, samples: 0 },
          dependencies: [],
          postprocess: (_params, ctx) => ({
            status: "ok",
            value: { endT: ctx.input.run.end.t, cadence: ctx.supply.sampleCadenceSec, points: ctx.input.run.trace.length },
          }),
        },
        {
          id: "plugin.after",
          version: "1",
          kind: "execution",
          validateParams: () => ({ ok: true, params: {} }),
          requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
          observation: { windowSec: null, sampleCadenceSec: null, coverage: "summary", metricIds: [], observationSchema: "idlekit.run-observation" },
          outputContract: "test.analyzer",
          algorithmVersion: "plugin-after-v1",
          cost: { freshRuns: 0, samples: 0 },
          dependencies: [{ id: "plugin.read", version: "1" }],
          execute: () => ({ status: "ok", value: "after" }),
        },
        {
          id: "plugin.both",
          version: "1",
          kind: "execution",
          validateParams: () => ({ ok: true, params: {} }),
          requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
          observation: { windowSec: null, sampleCadenceSec: null, coverage: "summary", metricIds: [], observationSchema: "idlekit.run-observation" },
          outputContract: "test.analyzer",
          algorithmVersion: "plugin-both-v1",
          cost: { freshRuns: 1, samples: 1 },
          dependencies: [{ id: "plugin.read", version: "1" }],
          execute: (_params, ctx) => {
            const run = ctx.requestRun("plugin.both").run();
            return run ? { status: "ok", value: run.end.t } : { status: "insufficient-data", value: null, rerun: true };
          },
        },
      ];
      `,
    );
    const base = ["analyze", "plugin.exec", scenario, "--plugin", plugin, "--allow-plugin", "true", "--plugin-root", dir];
    const json = runCliJson<any>([...base, "--budget-duration", "20", "--format", "json"]);
    expect(json.status).toBe("ok");
    expect(json.value.endT).toBe(8);
    expect(json.provenance.freshRuns).toBe(1);
    expect(json.provenance.semantics.horizonSec).toBe(8);
    expect(Object.keys(json._meta.pluginDigest)).toHaveLength(1);
    expect(Object.keys(json._meta.pluginDigest)[0]).toEndWith("exec.ts");
    expect(typeof json._meta.scenarioHash).toBe("string");
    const refused = runCliJson<any>([...base, "--budget-runs", "0", "--format", "json"]);
    expect(refused.status).toBe("insufficient-data");
    expect(refused.provenance.rerun.reason).toBe("budget");
    const pluginFlags = ["--plugin", plugin, "--allow-plugin", "true", "--plugin-root", dir];
    const read = runCliJson<any>(["analyze", "plugin.read", scenario, ...pluginFlags, "--trace-every", "2", "--format", "json"]);
    expect(read.status).toBe("ok");
    expect(read.value).toEqual({ endT: 8, cadence: 2, points: 5 });
    // A coarser trace than the analyzer demands is refused by the registry before the body.
    const coarse = runCliJson<any>(["analyze", "plugin.read", scenario, ...pluginFlags, "--trace-every", "3", "--format", "json"]);
    expect(coarse.status).toBe("insufficient-data");
    // The observation run counts against the run budget: with no runs left, nothing is simulated.
    const unbudgeted = runCliJson<any>(["analyze", "plugin.read", scenario, ...pluginFlags, "--trace-every", "2", "--budget-runs", "0", "--format", "json"]);
    expect(unbudgeted.status).toBe("insufficient-data");
    // plugin.exec needs a run of its own, so one run spent observing for plugin.read leaves it none.
    const spent = runCliJson<any>(["analyze", "plugin.both", scenario, ...pluginFlags, "--trace-every", "2", "--budget-duration", "20", "--format", "json"]);
    expect(spent.status).toBe("insufficient-data");
    expect(spent.provenance.rerun.reason).toBe("budget");
    const both = runCliJson<any>(["analyze", "plugin.both", scenario, ...pluginFlags, "--trace-every", "2", "--budget-duration", "20", "--budget-runs", "2", "--format", "json"]);
    expect(both.status).toBe("ok");
    // An execution analyzer whose postprocess dependency reads the run gets that run supplied.
    const after = runCliJson<any>(["analyze", "plugin.after", scenario, ...pluginFlags, "--trace-every", "2", "--format", "json"]);
    expect(after.status).toBe("ok");
    expect(after.value).toBe("after");
    await removePath(dir);
  }, 60000);
});
