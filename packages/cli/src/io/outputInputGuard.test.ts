import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { link, readFile, symlink } from "fs/promises";
import { createHash } from "crypto";
import { relative, resolve } from "path";
import { CLI_CWD, createTempDir, pathExists, REPO_ROOT, removePath, runCli, writeText } from "../testkit/bun";

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

/** Sorted-key JSON, the text an experiment spec hashes for its scenario. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

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

  it("rewrites an existing --out whose name equals a value of a flag that is not a path", async () => {
    const out = resolve(dir, "run-id-output");
    // The second run sees an existing file with the --run-id text as its name. --run-id is not an input path.
    for (let run = 0; run < 2; run++) {
      const result = runCli(["simulate", scenario, "--duration", "60", "--run-id", out, "--out", out]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(await text(out))).toMatchObject({ _meta: { command: "simulate", runId: out } });
    }
    await removePath(out);
  }, 60_000);

  it("protects a scenario named inside an experiment spec and a plugin's local import", async () => {
    const spec = resolve(dir, "spec.json");
    const parsed = JSON.parse(source);
    await writeText(spec, JSON.stringify({
      schemaVersion: 1,
      scenario: { ref: scenario, hash: createHash("sha256").update(canonical(parsed)).digest("hex") },
      model: { id: parsed.model.id, version: parsed.model.version },
      metricId: "endMoney",
      dimensions: [{ id: "income", target: "model", path: "incomePerSec", space: { kind: "choice", values: ["1", "2"] }, baseline: "1", probes: ["2"] }],
      budget: { candidates: 2, seeds: 1 }, seeds: [7], horizonSec: 30, stepSec: 1, session: { pattern: "always-on", days: 1 },
    }));
    expect(runCli(["experiment", spec]).exitCode).toBe(0);
    await expectRefused(["experiment", spec, "--out", scenario], scenario, source);

    const helper = resolve(dir, "helper.mjs");
    const helperBody = "export const strategies = [];\n";
    await writeText(helper, helperBody);
    const plugin = resolve(dir, "plugin.mjs");
    await writeText(plugin, 'export { strategies } from "./helper.mjs";\n');
    const pluginArgs = ["simulate", scenario, "--duration", "60", "--plugin", plugin, "--allow-plugin", "true"];
    expect(runCli(pluginArgs).exitCode).toBe(0);
    await expectRefused([...pluginArgs, "--out", helper], helper, helperBody);
  }, 120_000);

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
    // The replay reads the recorded scenario in a child process; that scenario is still an input of verify.
    await expectRefused(["replay", "verify", artifact, "--out", scenario], scenario, source);
  }, 120_000);

  it("replay verify protects relative inputs from another directory and plugin imports", async () => {
    const tune = resolve(dir, "tune.json");
    const tuneBody = JSON.stringify({
      schemaVersion: 1,
      strategy: { id: "greedy", baseParams: { schemaVersion: 1, objective: "maximizeIncome" },
        space: [{ path: "objective", space: { kind: "choice", values: ["maximizeIncome", "minPayback"] } }] },
      objective: { id: "endNetWorthLog10" },
      runner: { seeds: [1], budget: 2, overrideDurationSec: 30, topK: 1 },
    });
    await writeText(tune, tuneBody);
    const tuned = resolve(dir, "tuned.json");
    // Written from the CLI package directory with a relative --tune, then verified from the repository root.
    expect(runCli(["tune", scenario, "--tune", relative(CLI_CWD, tune), "--artifact-out", tuned]).exitCode).toBe(0);
    const fromRoot = runCli(["replay", "verify", tuned, "--out", tune], { cwd: REPO_ROOT, check: false });
    expect(fromRoot.exitCode).not.toBe(0);
    expect(fromRoot.stderr).toContain("must not overwrite an input file");
    expect(await text(tune)).toBe(tuneBody);

    const helper = resolve(dir, "replay-helper.mjs");
    const helperBody = "export const strategies = [];\n";
    await writeText(helper, helperBody);
    const plugin = resolve(dir, "replay-plugin.mjs");
    await writeText(plugin, 'export { strategies } from "./replay-helper.mjs";\n');
    const pluginArtifact = resolve(dir, "plugin-artifact.json");
    expect(runCli(["simulate", scenario, "--duration", "60", "--plugin", plugin, "--allow-plugin", "true",
      "--artifact-out", pluginArtifact]).exitCode).toBe(0);
    await expectRefused(["replay", "verify", pluginArtifact, "--out", helper], helper, helperBody);
  }, 180_000);

  it("setup plugin-trust --force never replaces a plugin it pins", async () => {
    const plugin = resolve(dir, "trusted.mjs");
    const body = "export const strategies = [];\n";
    await writeText(plugin, body);
    await expectRefused(["setup", "plugin-trust", "--plugin", plugin, "--out", plugin, "--force", "true"], plugin, body);
  }, 60_000);
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
