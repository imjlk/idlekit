import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function runCli(args: string[], opts?: { stdio?: "pipe" | "inherit" }) {
  return execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: opts?.stdio ?? "pipe",
  });
}

describe("init scenario command", () => {
  it("writes track/preset matrix with stable defaults", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-init-"));
    try {
      const introSession = resolve(dir, "intro-session.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "session", "--out", introSession]);
      const introSessionJson = JSON.parse(await readFile(introSession, "utf8"));
      expect(introSessionJson.clock.durationSec).toBe(1200);
      expect(introSessionJson.policy.mode).toBe("drop");

      const introBuilder = resolve(dir, "intro-builder.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "builder", "--out", introBuilder]);
      const introBuilderJson = JSON.parse(await readFile(introBuilder, "utf8"));
      expect(introBuilderJson.meta.id).toBe("cafe-baseline");
      expect(introBuilderJson.policy.mode).toBe("accumulate");

      const introLongrun = resolve(dir, "intro-longrun.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "longrun", "--out", introLongrun]);
      const introLongrunJson = JSON.parse(await readFile(introLongrun, "utf8"));
      expect(introLongrunJson.clock.stepSec).toBe(300);
      expect(introLongrunJson.clock.durationSec).toBe(604800);

      const designSession = resolve(dir, "design-session.json");
      runCli(["init", "scenario", "--track", "design", "--preset", "session", "--out", designSession]);
      const designSessionJson = JSON.parse(await readFile(designSession, "utf8"));
      expect(designSessionJson.clock.durationSec).toBe(1800);
      expect(designSessionJson.strategy.params.preferUpgradeAtProducers).toBe(6);

      const designLongrun = resolve(dir, "design-longrun.json");
      runCli(["init", "scenario", "--track", "design", "--preset", "longrun", "--out", designLongrun]);
      const designLongrunJson = JSON.parse(await readFile(designLongrun, "utf8"));
      expect(designLongrunJson.clock.stepSec).toBe(10);
      expect(designLongrunJson.sim.fast).toBeTrue();

      const personalBasePath = resolve(dir, "my-game-v1.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "builder", "--out", personalBasePath]);
      const personalBase = JSON.parse(await readFile(personalBasePath, "utf8"));
      const personalCompare = JSON.parse(await readFile(resolve(dir, "my-game-v1-compare-b.json"), "utf8"));
      const personalTune = JSON.parse(await readFile(resolve(dir, "my-game-v1-tune.json"), "utf8"));
      expect(personalBase.model.id).toBe("linear");
      expect(personalCompare.model.params.incomePerSec).toBe("1.84");
      expect(personalCompare.model.params.buyCostGrowth).toBe(1.17);
      expect(personalTune.strategy.id).toBe("greedy");
      expect(personalTune.objective.id).toBe("endNetWorthLog10");

      const personalSessionPath = resolve(dir, "session-game.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "session", "--out", personalSessionPath]);
      const personalSession = JSON.parse(await readFile(resolve(dir, "session-game-v1.json"), "utf8"));
      const personalSessionTune = JSON.parse(await readFile(resolve(dir, "session-game-v1-tune.json"), "utf8"));
      expect(personalSession.policy.mode).toBe("drop");
      expect(personalSession.clock.durationSec).toBe(1800);
      expect(personalSessionTune.objective.id).toBe("pacingBalancedLog10");

      const personalLongrunPath = resolve(dir, "longrun-game.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "longrun", "--out", personalLongrunPath]);
      const personalLongrun = JSON.parse(await readFile(resolve(dir, "longrun-game-v1.json"), "utf8"));
      const personalLongrunTune = JSON.parse(await readFile(resolve(dir, "longrun-game-v1-tune.json"), "utf8"));
      expect(personalLongrun.strategy.id).toBe("planner");
      expect(personalLongrun.clock.durationSec).toBe(86400);
      expect(personalLongrunTune.strategy.id).toBe("planner");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports named personal bundle generation", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-init-name-"));
    try {
      const outPath = resolve(dir, "my-game-v1.json");
      runCli(["init", "scenario", "--track", "personal", "--out", outPath, "--name", "Space Miner"]);

      const namedBase = JSON.parse(await readFile(resolve(dir, "space-miner-v1.json"), "utf8"));
      const namedCompare = JSON.parse(await readFile(resolve(dir, "space-miner-v1-compare-b.json"), "utf8"));
      const namedTune = JSON.parse(await readFile(resolve(dir, "space-miner-v1-tune.json"), "utf8"));
      expect(namedBase.meta.id).toBe("space-miner-v1");
      expect(namedBase.meta.title).toBe("Space Miner V1 Template");
      expect(namedCompare.meta.id).toBe("space-miner-v1-compare-b");
      expect(namedTune.meta.id).toBe("space-miner-v1-tune");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects --name on non-personal tracks with stable error code", async () => {
    expect(() =>
      runCli(["init", "scenario", "--track", "intro", "--out", resolve(tmpdir(), "bad.json"), "--name", "Nope"]),
    ).toThrow("[CLI_FLAG_UNSUPPORTED_FOR_TRACK]");
  });

  it("fails when output exists unless force=true", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-init-force-"));
    try {
      const path = resolve(dir, "scenario.json");
      runCli(["init", "scenario", "--out", path]);

      expect(() =>
        runCli(["init", "scenario", "--out", path], {
          stdio: "pipe",
        })).toThrow("[CLI_USAGE] Output file already exists");

      runCli(["init", "scenario", "--out", path, "--force", "true"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
