import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { hashReplayResult } from "../io/replayArtifact";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";
const COMPARE_B = "../../examples/tutorials/03-cafe-compare-b.json";
const TUNE = "../../examples/tutorials/04-cafe-tune.json";

function runCliJson(args: string[]): any {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

describe("replay consistency", () => {
  it("simulate fresh vs resume+offline split remains equivalent", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-replay-consistency-"));
    try {
      const statePath = resolve(dir, "state.json");
      const full = runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "35",
        "--seed",
        "17",
        "--run-id",
        "replay-full",
        "--format",
        "json",
      ]);
      runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "9",
        "--seed",
        "17",
        "--run-id",
        "replay-split-1",
        "--state-out",
        statePath,
        "--format",
        "json",
      ]);
      const resumed = runCliJson([
        "simulate",
        BASELINE,
        "--resume",
        statePath,
        "--offline-seconds",
        "15",
        "--duration",
        "11",
        "--seed",
        "17",
        "--run-id",
        "replay-split-2",
        "--format",
        "json",
      ]);

      expect(resumed.endT).toBe(full.endT);
      expect(resumed.endMoney).toBe(full.endMoney);
      expect(resumed.endNetWorth).toBe(full.endNetWorth);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("compare/ltv/tune are deterministic for same input + seed", () => {
    const cmpA = runCliJson([
      "compare",
      BASELINE,
      COMPARE_B,
      "--metric",
      "endNetWorth",
      "--seed",
      "19",
      "--run-id",
      "cmp-1",
      "--format",
      "json",
    ]);
    const cmpB = runCliJson([
      "compare",
      BASELINE,
      COMPARE_B,
      "--metric",
      "endNetWorth",
      "--seed",
      "19",
      "--run-id",
      "cmp-1",
      "--format",
      "json",
    ]);
    expect(hashReplayResult(cmpA)).toBe(hashReplayResult(cmpB));

    const ltvA = runCliJson([
      "ltv",
      BASELINE,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--seed",
      "23",
      "--run-id",
      "ltv-1",
      "--format",
      "json",
    ]);
    const ltvB = runCliJson([
      "ltv",
      BASELINE,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--seed",
      "23",
      "--run-id",
      "ltv-1",
      "--format",
      "json",
    ]);
    expect(hashReplayResult(ltvA)).toBe(hashReplayResult(ltvB));

    const tuneA = runCliJson([
      "tune",
      BASELINE,
      "--tune",
      TUNE,
      "--seed",
      "31",
      "--run-id",
      "tune-1",
      "--format",
      "json",
    ]);
    const tuneB = runCliJson([
      "tune",
      BASELINE,
      "--tune",
      TUNE,
      "--seed",
      "31",
      "--run-id",
      "tune-1",
      "--format",
      "json",
    ]);
    expect(hashReplayResult(tuneA)).toBe(hashReplayResult(tuneB));
  });

  it("replay verify passes for artifacts from all replay-enabled commands", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-replay-verify-all-"));
    try {
      const artifacts = {
        simulate: resolve(dir, "simulate.artifact.json"),
        compare: resolve(dir, "compare.artifact.json"),
        tune: resolve(dir, "tune.artifact.json"),
        ltv: resolve(dir, "ltv.artifact.json"),
      };

      runCliJson([
        "simulate",
        BASELINE,
        "--seed",
        "101",
        "--run-id",
        "replay-sim",
        "--artifact-out",
        artifacts.simulate,
        "--format",
        "json",
      ]);

      runCliJson([
        "compare",
        BASELINE,
        COMPARE_B,
        "--metric",
        "endNetWorth",
        "--seed",
        "102",
        "--run-id",
        "replay-compare",
        "--artifact-out",
        artifacts.compare,
        "--format",
        "json",
      ]);

      runCliJson([
        "tune",
        BASELINE,
        "--tune",
        TUNE,
        "--seed",
        "103",
        "--run-id",
        "replay-tune",
        "--artifact-out",
        artifacts.tune,
        "--format",
        "json",
      ]);

      runCliJson([
        "ltv",
        BASELINE,
        "--horizons",
        "30m,2h,24h,7d,30d,90d",
        "--step",
        "600",
        "--seed",
        "104",
        "--run-id",
        "replay-ltv",
        "--artifact-out",
        artifacts.ltv,
        "--format",
        "json",
      ]);

      for (const path of Object.values(artifacts)) {
        const verified = runCliJson(["replay", "verify", path, "--format", "json"]);
        expect(verified.ok).toBeTrue();
      }

      const raw = JSON.parse(await readFile(artifacts.simulate, "utf8"));
      expect(raw.replay.verify.runId).toBe("replay-sim");
      expect(raw.replay.verify.seed).toBe(101);
      expect(typeof raw.replay.verify.resultHash).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
