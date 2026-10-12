import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { resolve } from "path";
import { createTempDir, readJson, readText, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

/** Sorted-key JSON, the text the experiment spec hashes for its scenario. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

describe("experiment command", () => {
  let dir = "";
  let specPath = "";
  let malformedPath = "";
  let pluginPath = "";
  let cliVersion = "";

  beforeAll(async () => {
    dir = await createTempDir("idk-experiment-");
    cliVersion = (await readJson<{ version: string }>(resolve(import.meta.dir, "../../package.json"))).version;
    const scenario = JSON.parse(await readText(BASELINE));
    // Engine metadata names a version. It is metadata only and is not the engine that runs.
    scenario.engine = { name: "breakInfinity", version: "9.9.9" };
    const scenarioPath = resolve(dir, "scenario.json");
    await writeText(scenarioPath, JSON.stringify(scenario, null, 2));
    specPath = resolve(dir, "spec.json");
    await writeText(
      specPath,
      JSON.stringify({
        schemaVersion: 1,
        scenario: { ref: scenarioPath, hash: createHash("sha256").update(canonical(scenario)).digest("hex") },
        model: { id: scenario.model.id, version: scenario.model.version },
        metricId: "endMoney",
        dimensions: [
          {
            id: "income",
            target: "model",
            path: "incomePerSec",
            space: { kind: "choice", values: ["1", "2"] },
            baseline: "1",
            probes: ["2"],
          },
        ],
        budget: { candidates: 2, seeds: 1 },
        seeds: [7],
        horizonSec: 30,
        stepSec: 1,
        session: { pattern: "always-on", days: 1 },
      }),
    );
    // A plugin that adds an unused strategy still changes the loaded code, so it must reach provenance.
    pluginPath = resolve(dir, "noop-plugin.mjs");
    await writeText(pluginPath, `export const strategies = [{ id: "plugin.noop", create: () => ({ id: "plugin.noop", decide: () => [] }) }];\n`);
    malformedPath = resolve(dir, "malformed.json");
    await writeText(malformedPath, JSON.stringify({ schemaVersion: 1, scenario: { ref: 42, hash: "x" } }));
  });

  afterAll(async () => {
    if (dir) await removePath(dir);
  });

  it("records the engine that ran, not the scenario engine metadata", () => {
    const byDefault = runCliJson(["experiment", specPath]);
    const tasks = (byDefault.data ?? byDefault).tasks as { engineId: string; engineVersion: string }[];
    expect(tasks.length).toBe(2);
    for (const task of tasks) {
      expect(task.engineId).toBe("number");
      expect(task.engineVersion).toBe(`idlekit-cli@${cliVersion}`);
    }
    const flagged = runCliJson(["experiment", specPath, "--engine", "breakInfinity"]);
    for (const task of (flagged.data ?? flagged).tasks as { engineId: string; engineVersion: string }[]) {
      expect(task.engineId).toBe("breakInfinity");
      expect(task.engineVersion).toBe(`idlekit-cli@${cliVersion}`);
    }
  });

  it("records loaded plugin digests in the run hash and output meta", () => {
    const plain = runCliJson(["experiment", specPath]);
    const plugged = runCliJson(["experiment", specPath, "--plugin", pluginPath, "--allow-plugin", "true"]);
    expect(Object.keys(plain._meta.pluginDigest)).toEqual([]);
    expect(Object.values(plugged._meta.pluginDigest)).toHaveLength(1);
    expect(plugged.effectiveRunHash).not.toBe(plain.effectiveRunHash);
  });

  it("rejects a malformed spec before resolving its scenario", () => {
    const failed = runCliFailure(["experiment", malformedPath]);
    const output = `${failed.stderr}\n${failed.stdout}`;
    expect(output).toContain("EXPERIMENT_SPEC_INVALID");
    expect(output).toContain("scenario.ref");
  });
});
