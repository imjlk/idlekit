import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, readText, removePath, runCli, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

// One 25-generator buy that the linear model can afford at t=0, and no loop:
// a draw that starts from the post-run cursor applies nothing and ends far lower.
async function writeScriptedOnceScenario(path: string): Promise<void> {
  const scenario = JSON.parse(await readText(BASELINE));
  scenario.meta = { ...scenario.meta, id: "scripted-once" };
  scenario.initial.wallet.amount = "10000";
  scenario.strategy = {
    id: "scripted",
    params: {
      schemaVersion: 1,
      program: [{ actionId: "buy.generator", bulkSize: 25 }],
      loop: false,
    },
  };
  await writeText(path, JSON.stringify(scenario, null, 2));
}

// A plugin strategy that keeps its call count in a closure and has no snapshot hooks.
// Only a new instance per draw buys on that draw.
const FIRST_CALL_PLUGIN = `export const strategies = [
  {
    id: "plugin.first-call",
    create: () => {
      let calls = 0;
      return {
        id: "plugin.first-call",
        decide(ctx, model, state) {
          calls += 1;
          if (calls > 1) return [];
          const action = model.actions(ctx, state).find((candidate) => candidate.id === "buy.generator");
          return action ? [{ action, bulkSize: 25 }] : [];
        },
      };
    },
  },
];
`;

function expectMonteCarloMatchesDeterministic(experience: any): void {
  expect(experience.mode).toBe("monte-carlo");
  const deterministicLog10 = Math.log10(Number(experience.end.netWorth));
  const summary = experience.monteCarlo.endNetWorthLog10;
  expect(summary.mean).toBeCloseTo(deterministicLog10, 6);
  for (const value of Object.values(summary.quantiles)) {
    expect(value as number).toBeCloseTo(deterministicLog10, 6);
  }
}

describe("experience Monte Carlo", () => {
  let dir = "";
  let scenarioPath = "";
  let pluginScenarioPath = "";
  let pluginFlags: string[] = [];

  beforeAll(async () => {
    dir = await createTempDir("idlekit-experience-mc");
    scenarioPath = resolve(dir, "scripted-once.json");
    await writeScriptedOnceScenario(scenarioPath);
    const pluginPath = resolve(dir, "first-call-plugin.mjs");
    await writeText(pluginPath, FIRST_CALL_PLUGIN);
    pluginFlags = ["--plugin", pluginPath, "--allow-plugin", "true"];
    const pluginScenario = JSON.parse(await readText(scenarioPath));
    pluginScenario.strategy = { id: "plugin.first-call" };
    pluginScenarioPath = resolve(dir, "first-call.json");
    await writeText(pluginScenarioPath, JSON.stringify(pluginScenario, null, 2));
  });

  afterAll(async () => {
    await removePath(dir);
  });

  it("draws apply a non-looping scripted program that the deterministic session already ran", async () => {
    const outPath = resolve(dir, "experience.json");
    runCli(["experience", scenarioPath, "--days", "1", "--draws", "3", "--seed", "1", "--format", "json", "--out", outPath]);
    expectMonteCarloMatchesDeterministic(await readJson<any>(outPath));
  });

  it("evaluate runs its experience draws on the same fresh program", async () => {
    const outDir = resolve(dir, "evaluate");
    runCli(["evaluate", scenarioPath, "--days", "1", "--draws", "3", "--horizons", "30m", "--seed", "1", "--out-dir", outDir]);
    expectMonteCarloMatchesDeterministic(await readJson<any>(resolve(outDir, "experience.json")));
  });

  it("builds a new closure-stateful plugin strategy for every draw", async () => {
    const outPath = resolve(dir, "first-call-experience.json");
    runCli([
      "experience",
      pluginScenarioPath,
      ...pluginFlags,
      "--days",
      "1",
      "--draws",
      "3",
      "--seed",
      "1",
      "--format",
      "json",
      "--out",
      outPath,
    ]);
    expectMonteCarloMatchesDeterministic(await readJson<any>(outPath));

    const outDir = resolve(dir, "first-call-evaluate");
    runCli([
      "evaluate",
      pluginScenarioPath,
      ...pluginFlags,
      "--days",
      "1",
      "--draws",
      "3",
      "--horizons",
      "30m",
      "--seed",
      "1",
      "--out-dir",
      outDir,
    ]);
    expectMonteCarloMatchesDeterministic(await readJson<any>(resolve(outDir, "experience.json")));
  });
});
