import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, runCliFailure, runCliJson, writeText } from "../testkit/bun";

const MILESTONE = "action.buy.generator.firstApplied";

const FIRST_CALL_PLUGIN = `export const strategies = [{
  id: "plugin.first-call",
  create: () => {
    let called = false;
    return {
      id: "plugin.first-call",
      decide(ctx, model, state) {
        if (called) return [];
        called = true;
        const action = model.actions(ctx, state).find((candidate) => candidate.id === "buy.generator");
        return action ? [{ action, bulkSize: 25 }] : [];
      },
    };
  },
}];
export const models = [{
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
`;

describe("compare run isolation", () => {
  let dir = "";
  let scriptedPath = "";
  let pluginStrategyPath = "";
  let pluginModelPath = "";
  let pluginFlags: string[] = [];

  beforeAll(async () => {
    dir = await createTempDir("idlekit-compare-isolation");
    const scenario = JSON.parse(await readText("../../examples/tutorials/01-cafe-baseline.json"));
    scenario.initial.wallet.amount = "10000";
    scenario.clock = { stepSec: 1, durationSec: 10 };
    scenario.strategy = {
      id: "scripted",
      params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 25 }], loop: false },
    };
    scriptedPath = resolve(dir, "scripted-once.json");
    await writeText(scriptedPath, JSON.stringify(scenario));
    const pluginPath = resolve(dir, "first-call.mjs");
    await writeText(pluginPath, FIRST_CALL_PLUGIN);
    pluginFlags = ["--plugin", pluginPath, "--allow-plugin", "true"];
    pluginStrategyPath = resolve(dir, "plugin-strategy.json");
    await writeText(pluginStrategyPath, JSON.stringify({ ...scenario, strategy: { id: "plugin.first-call" } }));
    pluginModelPath = resolve(dir, "plugin-model.json");
    await writeText(pluginModelPath, JSON.stringify({ ...scenario, model: { id: "plugin.first-buy", version: 1 } }));
  });

  afterAll(async () => {
    await removePath(dir);
  });

  function designArgs(path: string, draws: number): string[] {
    return [
      "compare", path, path, "--metric", "timeToMilestone", "--milestone-key", MILESTONE,
      "--session-pattern", "offline-heavy", "--days", "1", "--draws", String(draws), "--seed", "1", "--format", "json",
    ];
  }

  for (const draws of [1, 3]) {
    it(`starts the scripted design measurement fresh with ${draws} draw(s)`, () => {
      const output = runCliJson(designArgs(scriptedPath, draws));
      expect(output.measured.a.timeToMilestone).toBe(0);
      expect(output.measured.b.timeToMilestone).toBe(0);
    });
  }

  it("starts the ETA run fresh after the economy run consumed the script", () => {
    const output = runCliJson([
      "compare", scriptedPath, scriptedPath, "--metric", "etaToTargetWorth", "--target-worth", "20000",
      "--max-duration", "600", "--seed", "1", "--format", "json",
    ]);
    expect(output.measured.a.etaToTargetWorth).not.toBe("unreachable");
    expect(output.detail.aScore).toBeLessThan(600);
    expect(output.detail.bScore).toBeLessThan(600);
  });

  for (const source of ["strategy", "model"] as const) {
    it(`builds a fresh closure-stateful plugin ${source} for every stage and draw`, () => {
      const path = source === "strategy" ? pluginStrategyPath : pluginModelPath;
      const output = runCliJson([...designArgs(path, 3), ...pluginFlags]);
      expect(output.measured.a.timeToMilestone).toBe(0);
      expect(output.measured.b.timeToMilestone).toBe(0);
    });
  }

  it("keeps each design bundle metric independent of earlier metrics", () => {
    const output = runCliJson([
      "compare", pluginStrategyPath, pluginStrategyPath, ...pluginFlags, "--bundle", "design",
      "--milestone-key", MILESTONE, "--session-pattern", "offline-heavy", "--days", "1", "--draws", "3",
      "--seed", "1", "--format", "json",
    ]);
    const milestone = output.results.find((result: any) => result.metric === "timeToMilestone");
    expect(milestone.measured.a.timeToMilestone).toBe(0);
    expect(milestone.measured.b.timeToMilestone).toBe(0);
  });

  it("reports the draw aggregation used for visible progression and reward gaps", async () => {
    const pluginPath = resolve(dir, "seeded-income.mjs");
    await writeText(pluginPath, `export const models = [{
      id: "plugin.seeded-income", version: 1,
      create: () => ({
        id: "plugin.seeded-income", version: 1,
        income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(ctx.seed === 1 ? 0 : 1) }),
        actions: () => [],
      }),
    }];`);
    const input = JSON.parse(await readText(scriptedPath));
    input.model = { id: "plugin.seeded-income", version: 1 };
    input.strategy = { id: "greedy" };
    const path = resolve(dir, "seeded-income.json");
    await writeText(path, JSON.stringify(input));
    const base = ["compare", path, path, "--plugin", pluginPath, "--allow-plugin", "true",
      "--session-pattern", "offline-heavy", "--days", "1", "--seed", "1", "--format", "json"];
    for (const metric of ["visibleChangesPerMinute", "maxNoRewardGapSec"]) {
      const single = runCliJson([...base, "--metric", metric, "--draws", "1"]);
      const aggregate = runCliJson([...base, "--metric", metric, "--draws", "3"]);
      if (metric === "visibleChangesPerMinute") {
        expect(single.measured.a[metric]).toBe(0);
        expect(aggregate.measured.a[metric]).toBeGreaterThan(0);
      } else {
        expect(aggregate.measured.a[metric]).toBeLessThan(single.measured.a[metric]);
      }
      expect(aggregate.measured.a[metric]).toBe(aggregate.detail.aScore);
      expect(aggregate.measured.b[metric]).toBe(aggregate.detail.bScore);
    }
  });

  it("warns about different economy durations in the real Markdown command", async () => {
    const input = JSON.parse(await readText(scriptedPath));
    input.clock.durationSec = 20;
    const longerPath = resolve(dir, "longer.json");
    await writeText(longerPath, JSON.stringify(input));
    const report = runCli(["compare", scriptedPath, longerPath, "--bundle", "economy", "--format", "md"]).stdout;
    expect(report).toContain("different elapsed durations");
    expect(report).toContain("A: 10s, B: 20s");
  });

  it("does not warn about floating-point duration dust", async () => {
    const input = JSON.parse(await readText(scriptedPath));
    const paths = [resolve(dir, "step-01.json"), resolve(dir, "step-02.json")];
    for (const [index, path] of paths.entries()) {
      await writeText(path, JSON.stringify({ ...input, clock: { stepSec: index === 0 ? 0.1 : 0.2, durationSec: 1 } }));
    }
    const report = runCli(["compare", ...paths, "--bundle", "economy", "--format", "md"]).stdout;
    expect(report).not.toContain("different elapsed durations");
  });

  it("warns using the Monte Carlo draw sessions rather than the base-seed session", async () => {
    const pluginPath = resolve(dir, "seeded-warning.mjs");
    await writeText(pluginPath, `export const models = [true, false].map((seeded) => ({
      id: seeded ? "plugin.seeded-warning" : "plugin.zero-warning", version: 1,
      create: () => ({
        id: seeded ? "plugin.seeded-warning" : "plugin.zero-warning", version: 1,
        income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(seeded && ctx.seed !== 1 ? 1 : 0) }),
        actions: () => [],
      }),
    }));`);
    const input = JSON.parse(await readText(scriptedPath));
    input.initial.wallet.amount = "0";
    input.clock.untilExpr = "money >= 1";
    input.strategy = { id: "greedy" };
    const paths = [resolve(dir, "seeded-warning.json"), resolve(dir, "zero-warning.json")];
    for (const [index, path] of paths.entries()) {
      await writeText(path, JSON.stringify({ ...input, model: { id: index === 0 ? "plugin.seeded-warning" : "plugin.zero-warning", version: 1 } }));
    }
    const report = runCli([
      "compare", ...paths, "--plugin", pluginPath, "--allow-plugin", "true", "--metric", "maxNoRewardGapSec",
      "--session-pattern", "offline-heavy", "--days", "1", "--draws", "3", "--seed", "1", "--format", "md",
    ]).stdout;
    expect(report).toContain("different active play time");
    expect(report).toContain("A: 1s, B: 300s");
  });

  it("validates override defaults before invoking the strategy factory", async () => {
    // Plugins may replace a builtin id, including one accepted by --strategy.
    const pluginPath = resolve(dir, "invalid-override.mjs");
    await writeText(pluginPath, `export const strategies = [{
      id: "greedy", defaultParams: { invalid: true },
      paramsSchema: { "~standard": { validate: () => ({ success: false, issues: [{ message: "override rejected" }] }) } },
      create: () => { throw new Error("factory must not run"); },
    }];`);
    const output = runCliFailure([
      "compare", scriptedPath, scriptedPath, "--strategy", "greedy", "--plugin", pluginPath, "--allow-plugin", "true",
    ]);
    expect(output.stderr).toContain("Invalid strategy params: override rejected");
    expect(output.stderr).not.toContain("factory must not run");
  });

  it("rebuilds an override with validated legacy-raw defaults for every draw", async () => {
    const pluginPath = resolve(dir, "raw-override.mjs");
    await writeText(pluginPath, FIRST_CALL_PLUGIN
      .replaceAll("plugin.first-call", "greedy")
      .replace("create: () => {", `defaultParams: { marker: "raw" },
  paramsSchema: { "~standard": { validate: () => ({ success: true, value: { marker: "transformed" } }) } },
  create: (params) => {
    if (params.marker !== "raw") throw new Error("legacy-raw defaults were not preserved");`));
    const output = runCliJson([
      ...designArgs(scriptedPath, 3), "--strategy", "greedy", "--plugin", pluginPath, "--allow-plugin", "true",
    ]);
    expect(output.measured.a.timeToMilestone).toBe(0);
    expect(output.measured.b.timeToMilestone).toBe(0);
  });
});
