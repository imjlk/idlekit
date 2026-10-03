import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

async function writeState(path: string, mutate: (state: any) => void): Promise<void> {
  const state = await readJson<any>(path);
  mutate(state);
  await writeText(path, `${JSON.stringify(state, null, 2)}\n`);
}

describe("simulate resume engine", () => {
  it("rejects a breakInfinity state resumed on the number engine", async () => {
    const dir = await createTempDir("idlekit-resume-engine");
    try {
      const statePath = resolve(dir, "state.json");
      runCliJson(["simulate", BASELINE, "--engine", "breakInfinity", "--duration", "10", "--state-out", statePath, "--format", "json"]);
      await writeState(statePath, (state) => {
        expect(state.engine?.name).toBe("breakInfinity");
        state.wallet.amount = "1e400";
      });

      const mismatch = runCliFailure(["simulate", BASELINE, "--resume", statePath, "--duration", "20", "--format", "json"]);
      expect(mismatch.stderr).toContain("[SIM_STATE_ENGINE_MISMATCH]");
      expect(mismatch.stderr).toContain("breakInfinity");

      const resumed = runCliJson([
        "simulate",
        BASELINE,
        "--engine",
        "breakInfinity",
        "--resume",
        statePath,
        "--duration",
        "20",
        "--format",
        "json",
      ]);
      expect(resumed.startT).toBe(10);
      expect(resumed.endMoney).not.toBe("Infinity");
    } finally {
      await removePath(dir);
    }
  });

  it("reads a state without an engine as number", async () => {
    const dir = await createTempDir("idlekit-resume-engine-legacy");
    try {
      const statePath = resolve(dir, "state.json");
      runCliJson(["simulate", BASELINE, "--duration", "10", "--state-out", statePath, "--format", "json"]);
      await writeState(statePath, (state) => {
        expect(state.engine?.name).toBe("number");
        delete state.engine;
      });

      const resumed = runCliJson(["simulate", BASELINE, "--resume", statePath, "--duration", "20", "--format", "json"]);
      expect(resumed.startT).toBe(10);

      const mismatch = runCliFailure([
        "simulate",
        BASELINE,
        "--engine",
        "breakInfinity",
        "--resume",
        statePath,
        "--duration",
        "20",
        "--format",
        "json",
      ]);
      expect(mismatch.stderr).toContain("[SIM_STATE_ENGINE_MISMATCH]");
    } finally {
      await removePath(dir);
    }
  });
});
