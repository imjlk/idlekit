import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { parseDesignStudySpec } from "../lib/designStudy";
import { createTempDir, readJson, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

const FORGE = "../../examples/tutorials/26-exponential-forge-v1.json";
const PRESTIGE = "../../examples/tutorials/27-prestige-loop-v1.json";
const LUCKY = "../../examples/tutorials/30-lucky-forge-v1.json";

const miniStudy = {
  schemaVersion: 1,
  parameters: [
    { path: "model.params.costGrowth", min: 1.08, max: 1.2 },
    { path: "model.params.costBase", min: 5, max: 40, scale: "log", integer: true },
  ],
  objectives: [
    { kind: "milestoneTime", weight: 1 },
    { kind: "endNetWorthLog10", weight: 0.5 },
  ],
  evaluation: { sessionPattern: "short-bursts", days: 1, draws: 1 },
};

let dir = "";
let specPath = "";

beforeAll(async () => {
  dir = await createTempDir("idk-advanced");
  specPath = resolve(dir, "study.json");
  await writeText(specPath, JSON.stringify(miniStudy));
});

afterAll(async () => {
  await removePath(dir);
});

describe("design-study spec", () => {
  it("rejects prototype paths, duplicate paths, and an empty range", () => {
    const withPath = (path: string) => ({ ...miniStudy, parameters: [{ path, min: 1, max: 2 }] });
    expect(() => parseDesignStudySpec(withPath("model.__proto__.x"))).toThrow();
    expect(() => parseDesignStudySpec(withPath("model.constructor.x"))).toThrow();
    expect(() =>
      parseDesignStudySpec({ ...miniStudy, parameters: [miniStudy.parameters[0], miniStudy.parameters[0]] }),
    ).toThrow();
    expect(() => parseDesignStudySpec({ ...miniStudy, parameters: [{ path: "model.params.costGrowth", min: 2, max: 1 }] })).toThrow();
    expect(parseDesignStudySpec(miniStudy).parameters).toHaveLength(2);
  });
});

describe("advanced analysis commands", () => {
  it("sensitivity --method morris ranks parameters for the score and each objective", () => {
    const out = runCliJson(["sensitivity", FORGE, "--spec", specPath, "--method", "morris", "--max-runs", "6", "--format", "json"]);
    expect(out.kind).toBe("global-sensitivity");
    expect(out.score.runs).toBe(6);
    expect(out.score.ranking).toHaveLength(2);
    expect(Object.keys(out.objectives).sort()).toEqual(["endNetWorthLog10", "milestoneTime"]);
    expect(out._meta.command).toBe("sensitivity");
    const again = runCliJson(["sensitivity", FORGE, "--spec", specPath, "--method", "morris", "--max-runs", "6", "--format", "json"]);
    expect(again.score).toEqual(out.score);
  });

  it("optimize --method grid records the budget and writes the best scenario", async () => {
    const bestPath = resolve(dir, "best.json");
    const out = runCliJson([
      "optimize",
      FORGE,
      "--spec",
      specPath,
      "--method",
      "grid",
      "--max-runs",
      "4",
      "--write-best",
      bestPath,
      "--format",
      "json",
    ]);
    expect(out.kind).toBe("parameter-optimization");
    expect(out.search.stoppedBy).toBe("max-runs");
    expect(out.search.runs).toBe(4);
    expect(out.search.seed).toBe(1);
    expect(out.best.score).toBeLessThanOrEqual(out.baseline.score);
    const best = await readJson<{ model: { params: { costGrowth: number; costBase: string } } }>(bestPath);
    expect(best.model.params.costGrowth).toBe(out.best.values["model.params.costGrowth"]);
    expect(best.model.params.costBase).toBe(String(out.best.values["model.params.costBase"]));
  });

  it("optimize --method ga is reproducible for a seed", () => {
    const args = ["optimize", FORGE, "--spec", specPath, "--method", "ga", "--max-runs", "6", "--population", "4", "--seed", "3", "--format", "json"];
    const a = runCliJson(args);
    const b = runCliJson(args);
    expect(a.search.method).toBe("ga");
    expect(a.search.best).toEqual(b.search.best);
  });

  it("optimize refuses to overwrite its inputs", () => {
    const failed = runCliFailure(["optimize", FORGE, "--spec", specPath, "--max-runs", "2", "--write-best", specPath]);
    expect(failed.exitCode).not.toBe(0);
  });

  it("reset-policy reports positive reward rates and ROI only when the horizon leaves a tail", () => {
    const out = runCliJson(["reset-policy", PRESTIGE, "--scan", "600..1800", "--step", "600", "--horizon", "5400", "--format", "json"]);
    expect(out.kind).toBe("reset-policy");
    expect(out.artifact.candidates).toHaveLength(3);
    const rows = out.insights.rows as Array<{ intervalSec: number; rewardPerHour: number; roiVsNoReset: number | null }>;
    for (const row of rows) {
      expect(row.rewardPerHour).toBeGreaterThan(0);
      expect(row.roiVsNoReset === null).toBe(row.intervalSec !== 1200);
    }
    expect(out.insights.optimalIntervalSec).toBe(out.artifact.best.intervalSec);
  });

  it("prestige-cycle pointsPerHour is no longer 0", () => {
    const out = runCliJson(["prestige-cycle", PRESTIGE, "--scan", "600..1200", "--step", "600", "--horizon", "3600", "--format", "json"]);
    const rows = (out.rows ?? out.candidates ?? out.result?.rows) as Array<{ pointsPerHour: string | number }> | undefined;
    expect(rows).toBeDefined();
    expect(rows!.some((row) => Number(row.pointsPerHour) > 0)).toBe(true);
  });

  it("experience Monte Carlo adds confidence intervals on a stochastic scenario", () => {
    const out = runCliJson(["experience", LUCKY, "--seed", "7", "--draws", "6", "--format", "json"]);
    const intervals = out.monteCarlo.intervals;
    expect(intervals.endNetWorthLog10.n).toBe(6);
    expect(intervals.endNetWorthLog10.meanInterval).not.toBeNull();
    expect(intervals.endNetWorthLog10.quantiles.map((row: { q: number }) => row.q)).toEqual([0.1, 0.5, 0.9]);
  });
});
