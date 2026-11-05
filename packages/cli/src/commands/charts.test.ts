import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import {
  createTempDir,
  pathExists,
  readJson,
  readSchema,
  readText,
  removePath,
  runCli,
  runCliFailure,
  runCliJson,
  writeText,
} from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";
const COMPARE_B = "../../examples/tutorials/03-cafe-compare-b.json";

/** Sorted-key JSON, the text the experiment spec hashes for its scenario. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

/** The result without `_meta` and wall-clock `generatedAt` stamps, which differ between any two runs. */
function withoutMeta(value: Record<string, unknown>): unknown {
  const { _meta: _ignored, ...rest } = value;
  return JSON.parse(JSON.stringify(rest, (key, entry) => (key === "generatedAt" ? undefined : entry)));
}

describe("chart outputs and decision hints", () => {
  let dir = "";
  let validateChart: ReturnType<Ajv2020["compile"]>;

  function expectChartData(value: unknown, kind: string): void {
    if (!validateChart(value)) {
      throw new Error(`chart data does not match docs/schemas/chart-data.v1.schema.json: ${JSON.stringify(validateChart.errors)}`);
    }
    expect((value as { kind: string }).kind).toBe(kind);
  }

  beforeAll(async () => {
    dir = await createTempDir("idk-charts-");
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validateChart = ajv.compile(await readSchema("chart-data.v1.schema.json"));
  });

  afterAll(async () => {
    await removePath(dir);
  });

  it("simulate writes a deterministic SVG and schema-valid data without changing the JSON result", async () => {
    const svg = resolve(dir, "sim.svg");
    const data = resolve(dir, "sim.chart.json");
    const base = ["simulate", BASELINE, "--duration", "900", "--seed", "5", "--run-id", "chart-sim", "--format", "json"];
    const plain = runCliJson(base);
    const charted = runCliJson([...base, "--chart-out", svg, "--chart-data-out", data, "--chart-max-points", "64"]);
    expect(withoutMeta(charted)).toEqual(withoutMeta(plain));

    const first = await readText(svg);
    expect(first.startsWith("<svg")).toBeTrue();
    expect(first).toContain("Progression (log10");
    const chart = await readJson<any>(data);
    expectChartData(chart, "progression");
    expect(chart.source).toMatchObject({ command: "simulate", seed: 5, runId: "chart-sim" });
    expect(chart.progression.sampling.maxPoints).toBe(64);
    for (const series of chart.progression.series) expect(series.points.length).toBeLessThanOrEqual(64);

    runCliJson([...base, "--chart-out", svg, "--chart-data-out", data, "--chart-max-points", "64"]);
    expect(await readText(svg)).toBe(first);
    expect(await readJson<any>(data)).toEqual(chart);
  });

  it("rejects a bad point budget, a shared path, and an input path", async () => {
    const bad = runCliFailure(["simulate", BASELINE, "--duration", "10", "--chart-out", resolve(dir, "x.svg"), "--chart-max-points", "2"]);
    expect(`${bad.stderr}${bad.stdout}`).toContain("chart max points");
    const same = resolve(dir, "same.out");
    const shared = runCliFailure(["simulate", BASELINE, "--duration", "10", "--chart-out", same, "--chart-data-out", same]);
    expect(`${shared.stderr}${shared.stdout}`).toContain("CLI_USAGE");
    expect(await pathExists(same)).toBeFalse();
    const out = resolve(dir, "result.json");
    const clash = runCliFailure(["simulate", BASELINE, "--duration", "10", "--format", "json", "--out", out, "--chart-out", out]);
    expect(`${clash.stderr}${clash.stdout}`).toContain("--out");
    expect(await pathExists(out)).toBeFalse();
    const input = resolve(dir, "input.json");
    await writeText(input, await readText(BASELINE));
    const before = await readText(input);
    runCliFailure(["simulate", input, "--duration", "10", "--chart-out", input]);
    expect(await readText(input)).toBe(before);
  });

  it("replay artifacts do not record chart flags", async () => {
    const artifact = resolve(dir, "sim.artifact.json");
    runCliJson([
      "simulate", BASELINE, "--duration", "60", "--seed", "2", "--format", "json",
      "--chart-out", resolve(dir, "replay.svg"), "--artifact-out", artifact,
    ]);
    const verify = runCliJson(["replay", "verify", artifact, "--format", "json"]);
    expect(verify.ok).toBeTrue();
    expect(JSON.stringify(verify.replay)).not.toContain("chart");
  });

  it("experience md adds decision hints before next checks and writes a progression chart", async () => {
    const svg = resolve(dir, "exp.svg");
    const data = resolve(dir, "exp.chart.json");
    const md = runCli(["experience", BASELINE, "--days", "1", "--format", "md", "--chart-out", svg, "--chart-data-out", data]).stdout;
    const hints = md.indexOf("## Decision hints");
    expect(hints).toBeGreaterThan(0);
    expect(md.indexOf("## Next checks")).toBeGreaterThan(hints);
    for (const heading of ["### Bottlenecks", "### Recommended adjustment direction", "### Risk summary"]) {
      expect(md).toContain(heading);
    }
    expectChartData(await readJson(data), "progression");
    expect((await readText(svg)).startsWith("<svg")).toBeTrue();
  });

  it("compare writes KPI diff data, and review compare and review evaluate add decision hints", async () => {
    const data = resolve(dir, "cmp.chart.json");
    const svg = resolve(dir, "cmp.svg");
    runCliJson([
      "compare", BASELINE, COMPARE_B, "--metric", "endNetWorth", "--duration", "600", "--format", "json",
      "--chart-out", svg, "--chart-data-out", data,
    ]);
    const chart = await readJson<any>(data);
    expectChartData(chart, "compare");
    expect(chart.compare.kpis.map((row: { metric: string }) => row.metric)).toContain("endNetWorth");
    expect(chart.compare.progression.a.series.length).toBeGreaterThan(0);
    expect(await readText(svg)).toContain("KPI change, B vs A");

    const reviewCompare = runCli(["review", "compare", BASELINE, COMPARE_B, "--duration", "600"]).stdout;
    expect(reviewCompare).toContain("## Decision hints");

    const evaluate = runCli(["review", "evaluate", BASELINE, "--days", "1", "--horizons", "10s", "--step", "60"]).stdout;
    expect(evaluate.startsWith("# Evaluate Report\n")).toBeTrue();
    expect(evaluate).toContain("## Decision hints");
    expect(evaluate).toContain("### Risk summary");
  });

  it("experiment md reports levers and writes a sensitivity heatmap", async () => {
    const scenario = JSON.parse(await readText(BASELINE));
    const scenarioPath = resolve(dir, "experiment-scenario.json");
    await writeText(scenarioPath, JSON.stringify(scenario, null, 2));
    const spec = resolve(dir, "experiment.json");
    await writeText(spec, JSON.stringify({
      schemaVersion: 1,
      scenario: { ref: scenarioPath, hash: createHash("sha256").update(canonical(scenario)).digest("hex") },
      model: { id: scenario.model.id, version: scenario.model.version },
      metricId: "endMoney",
      objectives: [{ id: "rich", metricId: "endMoney", sense: "higher" }],
      dimensions: [{ id: "income", target: "model", path: "incomePerSec", space: { kind: "choice", values: ["1", "2"] }, baseline: "1", probes: ["2"] }],
      budget: { candidates: 2, seeds: 1 },
      seeds: [7],
      horizonSec: 60,
      stepSec: 1,
      session: { pattern: "always-on", days: 1 },
    }));
    const svg = resolve(dir, "heat.svg");
    const data = resolve(dir, "heat.chart.json");
    const md = runCli(["experiment", spec, "--format", "md", "--chart-out", svg, "--chart-data-out", data]).stdout;
    expect(md.startsWith("# Experiment Report")).toBeTrue();
    expect(md).toContain("## Local sensitivity");
    expect(md).toContain("## Decision hints");
    const chart = await readJson<any>(data);
    expectChartData(chart, "sensitivity");
    expect(chart.sensitivity.columns).toEqual(["endMoney"]);
    expect(await readText(svg)).toContain("Local sensitivity");
  });
});
