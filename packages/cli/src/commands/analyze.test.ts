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
    // growth honors the run budget, and a window finer than the trace spacing is not met.
    const unbudgeted = runCliJson<any>(["analyze", "growth", scenario, "--window", "2", "--budget-runs", "0", "--format", "json"]);
    expect(unbudgeted.status).toBe("insufficient-data");
    expect(unbudgeted.provenance.freshRuns).toBe(0);
    const coarse = runCliJson<any>(["analyze", "growth", scenario, "--window", "2", "--trace-every", "4", "--format", "json"]);
    expect(coarse.status).toBe("insufficient-data");
    expect(json.provenance.freshRuns).toBe(1);
    const markdown = runCli(["analyze", "growth", scenario, "--window", "5", "--format", "md"]);
    expect(markdown.stdout).toContain("growth-report-v1");
    expect(markdown.stdout).toContain("```json");
    await removePath(dir);
  }, 120000);

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

  it("gives the observation run and the analyzer run their own model instances", async () => {
    const dir = await createTempDir("idlekit-analyze-isolation");
    const raw = JSON.parse(await readText(resolve(import.meta.dir, "../../../../examples/tutorials/01-cafe-baseline.json")));
    raw.initial.wallet.amount = "10000";
    raw.clock = { stepSec: 1, durationSec: 10 };
    raw.strategy = { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 25 }], loop: false } };
    raw.model = { id: "plugin.first-buy", version: 1 };
    const scenario = resolve(dir, "first-buy.json");
    await writeText(scenario, JSON.stringify(raw));
    const plugin = resolve(dir, "first-buy.mjs");
    const demand = `{ windowSec: null, sampleCadenceSec: 1, coverage: "trace", metricIds: ["money"], observationSchema: "idlekit.run-observation" }`;
    await writeText(
      plugin,
      `export const models = [{
        id: "plugin.first-buy", version: 1,
        create: () => {
          let bought = false;
          return {
            id: "plugin.first-buy", version: 1,
            income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
            actions: () => bought ? [] : [{
              id: "buy.generator", kind: "buy", canApply: () => true, cost: () => null,
              bulk: () => [{ size: 25, cost: null }],
              apply: (_ctx, state) => {
                bought = true;
                return { ...state, vars: { ...state.vars, owned: state.vars.owned + 1 } };
              },
            }],
          };
        },
      }];
      const base = {
        version: "1",
        validateParams: () => ({ ok: true, params: {} }),
        requires: { capabilities: [], metricIds: [], observationSchema: "idlekit.run-observation" },
        outputContract: "test.analyzer",
        algorithmVersion: "plugin-owned-v1",
      };
      export const analyzers = [
        { ...base, id: "plugin.peek", kind: "postprocess", observation: ${demand}, cost: { freshRuns: 0, samples: 0 },
          dependencies: [], postprocess: (_p, ctx) => ({ status: "ok", value: ctx.input.run.end.vars.owned }) },
        { ...base, id: "plugin.owned", kind: "execution",
          observation: { windowSec: null, sampleCadenceSec: null, coverage: "summary", metricIds: [], observationSchema: "idlekit.run-observation" },
          cost: { freshRuns: 1, samples: 1 }, dependencies: [{ id: "plugin.peek", version: "1" }],
          execute: (_p, ctx) => {
            const run = ctx.requestRun("plugin.owned").run();
            return run ? { status: "ok", value: run.end.vars.owned } : { status: "insufficient-data", value: null, rerun: true };
          } },
      ];
      `,
    );
    const pluginFlags = ["--plugin", plugin, "--allow-plugin", "true", "--plugin-root", dir];
    // The observation run bought once; the analyzer run must start from a model that has not.
    const owned = runCliJson<any>(["analyze", "plugin.owned", scenario, ...pluginFlags, "--budget-runs", "2", "--budget-duration", "20", "--format", "json"]);
    expect(owned.status).toBe("ok");
    expect(owned.value).toBe(1);
    // Bad params fail before any run, with the CLI's own message rather than the registry's.
    const badWindow = runCli(["analyze", "growth", scenario, ...pluginFlags, "--window", "0"], { check: false });
    expect(badWindow.exitCode).not.toBe(0);
    expect(`${badWindow.stderr}\n${badWindow.stdout}`).toContain("params for growth@1 are invalid");
    await removePath(dir);
  }, 120000);

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
    // A non-array analyzers export is one isolated failure; builtins stay registered.
    const objectExport = resolve(dir, "object.ts");
    await writeText(objectExport, `export const analyzers = {};\n`);
    const fromObject = await loadRegistries([objectExport], { allowedRoots: [dir] });
    expect(fromObject.analyzerFailures.map((failure) => failure.message)).toEqual(["plugin analyzers export must be an array"]);
    expect(fromObject.analyzerRegistry.get("growth", "1")).toBeDefined();
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
    // The observation run is counted in provenance: plugin.both made it plus its own run.
    expect(read.provenance.freshRuns).toBe(1);
    expect(both.provenance.freshRuns).toBe(2);
    // An empty postprocess demand needs no observation, so no run is made for it.
    const note = runCliJson<any>(["analyze", "plugin.note", scenario, ...pluginFlags, "--format", "json"]);
    expect(note.status).toBe("ok");
    expect(note.provenance.freshRuns).toBe(0);
    // An until-only scenario is bounded by the horizon the budget admitted (--max-duration).
    const untilOnly = resolve(dir, "until.json");
    const untilRaw = JSON.parse(await readText(scenario)) as { clock: Record<string, unknown> };
    delete untilRaw.clock.durationSec;
    untilRaw.clock.untilExpr = "t >= 50";
    await writeText(untilOnly, JSON.stringify(untilRaw));
    const bounded = runCliJson<any>(["analyze", "plugin.read", untilOnly, ...pluginFlags, "--trace-every", "2", "--max-duration", "6", "--budget-duration", "6", "--format", "json"]);
    expect(bounded.value.endT).toBe(6);
    // An execution analyzer whose postprocess dependency reads the run gets that run supplied.
    const after = runCliJson<any>(["analyze", "plugin.after", scenario, ...pluginFlags, "--trace-every", "2", "--format", "json"]);
    expect(after.status).toBe("ok");
    expect(after.value).toBe("after");
    await removePath(dir);
  }, 240000);
});
