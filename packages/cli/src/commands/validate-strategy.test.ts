import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, runCliFailure, writeText } from "../testkit/bun";

describe("validate strategy contracts", () => {
  let dir = "";
  let scenario: any;
  beforeAll(async () => {
    dir = await createTempDir("idlekit-validate-strategy");
    scenario = JSON.parse(await readText("../../examples/tutorials/01-cafe-baseline.json"));
  });
  afterAll(async () => { await removePath(dir); });

  it("rejects an unregistered strategy before recommending simulate", async () => {
    const path = resolve(dir, "unknown.json");
    await writeText(path, JSON.stringify({ ...scenario, strategy: { id: "missing.strategy" } }));
    const result = runCliFailure(["validate", path]);
    expect(result.stderr).toContain("[SCENARIO_INVALID]");
    expect(result.stderr).toContain("strategy: Unknown strategy: missing.strategy");
    expect(result.stdout).not.toContain("OK:");
  });

  it("rejects invalid built-in strategy params with their field path", async () => {
    const path = resolve(dir, "invalid.json");
    await writeText(path, JSON.stringify({ ...scenario, strategy: {
      id: "scripted", params: { schemaVersion: 1, program: "invalid", loop: false },
    } }));
    const result = runCliFailure(["validate", path]);
    expect(result.stderr).toContain("[SCENARIO_INVALID]");
    expect(result.stderr).toContain("strategy.params.program");
  });

  it("checks plugin defaults without constructing the strategy", async () => {
    const path = resolve(dir, "plugin.json");
    const plugin = resolve(dir, "plugin.mjs");
    await writeText(path, JSON.stringify({ ...scenario, strategy: { id: "plugin.checked" } }));
    await writeText(plugin, `export const strategies = [{
      id: "plugin.checked", defaultParams: { marker: "valid" },
      paramsSchema: { "~standard": { validate: (input) => input.marker === "valid"
        ? { success: true, value: input } : { success: false, issues: [{ path: "marker", message: "invalid marker" }] } } },
      create: () => { throw new Error("validate must not construct a strategy"); },
    }];`);
    const result = runCli(["validate", path, "--plugin", plugin, "--allow-plugin", "true"]);
    expect(result.stdout).toContain("OK:");
    await writeText(path, JSON.stringify({ ...scenario, strategy: { id: "plugin.checked", params: { marker: "bad" } } }));
    const invalid = runCliFailure(["validate", path, "--plugin", plugin, "--allow-plugin", "true"]);
    expect(invalid.stderr).toContain("strategy.params.marker: invalid marker");
    expect(invalid.stderr).not.toContain("validate must not construct");
  });
});
