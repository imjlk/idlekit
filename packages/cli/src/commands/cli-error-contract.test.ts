import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, removePath, runCliFailure, writeText } from "../testkit/bun";

describe("cli error contract", () => {
  it("prints CLI_USAGE for missing positional validate input", () => {
    const result = runCliFailure(["validate"]);
    expect(result.stderr).toContain("[CLI_USAGE]");
    expect(result.stderr).toContain("Usage: idk validate");
  });

  it("prints SCENARIO_INVALID for invalid scenario payload", async () => {
    const dir = await createTempDir("idlekit-cli-errors");
    try {
      const invalidPath = resolve(dir, "invalid.json");
      await writeText(invalidPath, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`);
      const result = runCliFailure(["validate", invalidPath]);
      expect(result.stderr).toContain("[SCENARIO_INVALID]");
      expect(result.stderr).toContain("Scenario invalid");
    } finally {
      await removePath(dir);
    }
  });

  it("prints PLUGIN_DISABLED when plugin loading is not explicitly enabled", () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const result = runCliFailure(["models", "list", "--plugin", pluginPath]);
    expect(result.stderr).toContain("[PLUGIN_DISABLED]");
  });

  it("prints PLUGIN_POLICY_VIOLATION for disallowed plugin root", () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const result = runCliFailure([
      "models",
      "list",
      "--plugin",
      pluginPath,
      "--allow-plugin",
      "true",
      "--plugin-root",
      resolve(process.cwd(), "../../examples/tutorials"),
    ]);
    expect(result.stderr).toContain("[PLUGIN_POLICY_VIOLATION]");
  });

  it("prints SIM_STATE_INVALID_JSON for bad resume payload", async () => {
    const dir = await createTempDir("idlekit-cli-resume");
    try {
      const resumePath = resolve(dir, "bad-state.json");
      await writeText(resumePath, "{not-json");
      const result = runCliFailure([
        "simulate",
        "../../examples/tutorials/01-cafe-baseline.json",
        "--resume",
        resumePath,
      ]);
      expect(result.stderr).toContain("[SIM_STATE_INVALID_JSON]");
    } finally {
      await removePath(dir);
    }
  });

  it("prints UNKNOWN_STRATEGY when scenario references missing strategy", async () => {
    const dir = await createTempDir("idlekit-cli-strategy");
    try {
      const scenarioPath = resolve(dir, "unknown-strategy.json");
      await writeText(
        scenarioPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            unit: { code: "COIN" },
            policy: { mode: "drop", maxLogGap: 12 },
            model: {
              id: "linear",
              version: 1,
              params: {
                incomePerSec: "1",
                buyCostBase: "10",
                buyCostGrowth: 1.15,
                buyIncomeDelta: "1",
              },
            },
            initial: {
              wallet: { unit: "COIN", amount: "0", bucket: "0" },
              vars: { owned: 0 },
              prestige: { count: 0, points: "0", multiplier: "1" },
            },
            clock: { stepSec: 1, durationSec: 60 },
            strategy: { id: "missing-strategy" },
          },
          null,
          2,
        ),
      );
      const result = runCliFailure(["simulate", scenarioPath]);
      expect(result.stderr).toContain("[UNKNOWN_STRATEGY]");
    } finally {
      await removePath(dir);
    }
  });

  it("prints CLI_USAGE when timeToMilestone compare is missing --milestone-key", () => {
    const result = runCliFailure([
      "compare",
      "../../examples/tutorials/11-my-game-v1.json",
      "../../examples/tutorials/12-my-game-compare-b.json",
      "--metric",
      "timeToMilestone",
      "--format",
      "json",
    ]);
    expect(result.stderr).toContain("[CLI_USAGE]");
    expect(result.stderr).toContain("--milestone-key");
  });
});
