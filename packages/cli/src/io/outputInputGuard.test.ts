import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { link, readFile, symlink } from "fs/promises";
import { resolve } from "path";
import { createTempDir, pathExists, REPO_ROOT, removePath, runCli, writeText } from "../testkit/bun";

let dir = "";
let scenario = "";
let other = "";
let source = "";

beforeAll(async () => {
  dir = await createTempDir("idlekit-output-input-guard");
  source = await readFile(resolve(REPO_ROOT, "examples/tutorials/01-cafe-baseline.json"), "utf8");
  scenario = resolve(dir, "scenario.json");
  other = resolve(dir, "other.json");
  await writeText(scenario, source);
  await writeText(other, await readFile(resolve(REPO_ROOT, "examples/tutorials/03-cafe-compare-b.json"), "utf8"));
});
afterAll(async () => { await removePath(dir); });

const text = (path: string) => readFile(path, "utf8");

async function expectRefused(args: string[], protectedPath: string, body: string): Promise<void> {
  const result = runCli(args, { check: false });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("CLI_USAGE");
  expect(result.stderr).toContain("must not overwrite an input file");
  expect(await text(protectedPath)).toBe(body);
}

describe("output paths never replace an input", () => {
  const commands: Array<[string, () => string[]]> = [
    ["report", () => ["report", scenario, "--format", "md"]],
    ["analyze growth", () => ["analyze", "growth", scenario, "--window", "5"]],
    ["simulate", () => ["simulate", scenario, "--duration", "60"]],
    ["experience", () => ["experience", scenario, "--days", "1"]],
    ["ltv", () => ["ltv", scenario, "--horizons", "30m"]],
    ["compare", () => ["compare", other, scenario, "--duration", "60", "--format", "md"]],
  ];

  for (const [name, args] of commands) {
    it(`${name} refuses --out on its scenario, a hardlink, or a symlinked directory alias`, async () => {
      const hardlink = resolve(dir, `${name.replace(" ", "-")}-hardlink.json`);
      const alias = resolve(dir, `${name.replace(" ", "-")}-alias`);
      await link(scenario, hardlink);
      await symlink(dir, alias, process.platform === "win32" ? "junction" : "dir");
      try {
        for (const out of [scenario, hardlink, resolve(alias, "scenario.json")]) {
          await expectRefused([...args(), "--out", out], scenario, source);
        }
      } finally {
        await removePath(hardlink);
        await removePath(alias);
      }
    }, 120_000);
  }

  it("still writes a separate --out, including one named like a flag value", async () => {
    const out = resolve(dir, "json");
    const result = runCli(["simulate", scenario, "--duration", "60", "--format", "json", "--out", out], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await text(out))).toMatchObject({ _meta: { command: "simulate" } });
    await removePath(out);
  }, 60_000);

  it("guards --artifact-out, --state-out, and replay verify --out", async () => {
    await expectRefused(["simulate", scenario, "--duration", "60", "--artifact-out", scenario], scenario, source);
    await expectRefused(["simulate", scenario, "--duration", "60", "--state-out", scenario], scenario, source);

    const state = resolve(dir, "state.json");
    expect(runCli(["simulate", scenario, "--duration", "60", "--state-out", state]).exitCode).toBe(0);
    // Saving back over the --resume state is a checkpoint in place, not a lost input.
    expect(runCli(["simulate", scenario, "--duration", "60", "--resume", state, "--state-out", state]).exitCode).toBe(0);
    expect(JSON.parse(await text(state))).toHaveProperty("t");

    const artifact = resolve(dir, "artifact.json");
    expect(runCli(["simulate", scenario, "--duration", "60", "--artifact-out", artifact]).exitCode).toBe(0);
    const artifactBody = await text(artifact);
    await expectRefused(["replay", "verify", artifact, "--out", artifact], artifact, artifactBody);
  }, 120_000);
});

describe("judge output paths", () => {
  const analysisBody = JSON.stringify({
    schemaVersion: 1,
    algorithmVersion: "analysis-artifact-v1",
    assumptions: [],
    warnings: [],
    observationCoverage: "complete",
    metrics: [{
      metricId: "first-reset", metricVersion: 1, meaning: "first-reset-hours", metricKind: "stock", timeAxis: "instant",
      domain: "time", reading: "observed", status: "ok", method: "exact", value: 1,
    }],
    goals: [],
    capabilities: {
      metrics: "statically-known", goals: "statically-known", reset: "statically-known", flow: "statically-known",
      advance: "statically-known",
    },
  });
  const rubricBody = JSON.stringify({
    schemaVersion: 1, contract: "idlekit.judge.rubric.v1", rubricVersion: "rubric-guard", failOn: ["error"],
    rules: [{
      id: "first-reset", metricId: "first-reset", operator: "lte", threshold: 2, upperThreshold: null, unit: "time",
      severity: "error", missingPolicy: "inconclusive", definition: "first-reset-hours", method: "exact",
      scenarioVersion: null, specVersion: null, engineId: null, pluginVersion: null, seed: null, algorithmVersion: null,
      recommendationId: "rec.metric.outside-threshold",
    }],
  });

  it("refuses the analysis or rubric as --out for rules and Jev Markdown", async () => {
    const analysis = resolve(dir, "analysis.json");
    const rubric = resolve(dir, "rubric.json");
    await writeText(analysis, analysisBody);
    await writeText(rubric, rubricBody);
    const env = { ...process.env, TYPESAFE_API_KEY: "" };
    for (const provider of [["--provider", "rules"], ["--provider", "jev", "--dry-run"]]) {
      for (const format of ["md", "json"]) {
        for (const [target, body] of [[analysis, analysisBody], [rubric, rubricBody]] as const) {
          const result = runCli(["judge", analysis, "--rubric", rubric, ...provider, "--format", format, "--out", target], {
            check: false, env,
          });
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toContain("must not overwrite an input file");
          expect(await text(target)).toBe(body);
        }
      }
    }
    const out = resolve(dir, "jev.md");
    const planned = runCli(["judge", analysis, "--rubric", rubric, "--provider", "jev", "--dry-run", "--format", "md", "--out", out], { env });
    expect(planned.exitCode).toBe(0);
    expect(await pathExists(out)).toBe(true);
    expect(await text(out)).toContain("## Jev answers");
  }, 120_000);
});
