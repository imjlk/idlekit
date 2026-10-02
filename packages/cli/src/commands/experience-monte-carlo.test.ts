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

  beforeAll(async () => {
    dir = await createTempDir("idlekit-experience-mc");
    scenarioPath = resolve(dir, "scripted-once.json");
    await writeScriptedOnceScenario(scenarioPath);
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
});
