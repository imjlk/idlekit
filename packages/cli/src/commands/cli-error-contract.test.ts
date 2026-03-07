import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function runCliExpectFailure(args: string[]): { stderr: string; stdout: string } {
  try {
    execFileSync("bun", ["src/main.ts", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
    throw new Error("Expected command to fail");
  } catch (error: any) {
    return {
      stderr: String(error.stderr ?? ""),
      stdout: String(error.stdout ?? ""),
    };
  }
}

describe("cli error contract", () => {
  it("prints CLI_USAGE for missing positional validate input", () => {
    const result = runCliExpectFailure(["validate"]);
    expect(result.stderr).toContain("[CLI_USAGE]");
    expect(result.stderr).toContain("Usage: idk validate");
  });

  it("prints SCENARIO_INVALID for invalid scenario payload", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-cli-errors-"));
    try {
      const invalidPath = resolve(dir, "invalid.json");
      await writeFile(invalidPath, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`, "utf8");
      const result = runCliExpectFailure(["validate", invalidPath]);
      expect(result.stderr).toContain("[SCENARIO_INVALID]");
      expect(result.stderr).toContain("Scenario invalid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints PLUGIN_DISABLED when plugin loading is not explicitly enabled", () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const result = runCliExpectFailure(["models", "list", "--plugin", pluginPath]);
    expect(result.stderr).toContain("[PLUGIN_DISABLED]");
  });

  it("prints PLUGIN_POLICY_VIOLATION for disallowed plugin root", () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const result = runCliExpectFailure([
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
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-cli-resume-"));
    try {
      const resumePath = resolve(dir, "bad-state.json");
      await writeFile(resumePath, "{not-json", "utf8");
      const result = runCliExpectFailure([
        "simulate",
        "../../examples/tutorials/01-cafe-baseline.json",
        "--resume",
        resumePath,
      ]);
      expect(result.stderr).toContain("[SIM_STATE_INVALID_JSON]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints UNKNOWN_STRATEGY when scenario references missing strategy", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-cli-strategy-"));
    try {
      const scenarioPath = resolve(dir, "unknown-strategy.json");
      await writeFile(
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
        "utf8",
      );
      const result = runCliExpectFailure(["simulate", scenarioPath]);
      expect(result.stderr).toContain("[UNKNOWN_STRATEGY]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
