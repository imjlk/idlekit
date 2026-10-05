import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

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
