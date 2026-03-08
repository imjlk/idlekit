import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCli, runCliFailure } from "../testkit/bun";

describe("init scenario command", () => {
  it("writes track/preset matrix with stable defaults", async () => {
    const dir = await createTempDir("idlekit-init");
    try {
      const introSession = resolve(dir, "intro-session.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "session", "--out", introSession]);
      const introSessionJson = await readJson<any>(introSession);
      expect(introSessionJson.clock.durationSec).toBe(1200);
      expect(introSessionJson.policy.mode).toBe("drop");

      const introBuilder = resolve(dir, "intro-builder.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "builder", "--out", introBuilder]);
      const introBuilderJson = await readJson<any>(introBuilder);
      expect(introBuilderJson.meta.id).toBe("cafe-baseline");
      expect(introBuilderJson.policy.mode).toBe("accumulate");

      const introLongrun = resolve(dir, "intro-longrun.json");
      runCli(["init", "scenario", "--track", "intro", "--preset", "longrun", "--out", introLongrun]);
      const introLongrunJson = await readJson<any>(introLongrun);
      expect(introLongrunJson.clock.stepSec).toBe(300);
      expect(introLongrunJson.clock.durationSec).toBe(604800);

      const designSession = resolve(dir, "design-session.json");
      runCli(["init", "scenario", "--track", "design", "--preset", "session", "--out", designSession]);
      const designSessionJson = await readJson<any>(designSession);
      expect(designSessionJson.clock.durationSec).toBe(1800);
      expect(designSessionJson.strategy.params.preferUpgradeAtProducers).toBe(6);

      const designLongrun = resolve(dir, "design-longrun.json");
      runCli(["init", "scenario", "--track", "design", "--preset", "longrun", "--out", designLongrun]);
      const designLongrunJson = await readJson<any>(designLongrun);
      expect(designLongrunJson.clock.stepSec).toBe(10);
      expect(designLongrunJson.sim.fast).toBeTrue();

      const personalBasePath = resolve(dir, "my-game-v1.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "builder", "--out", personalBasePath]);
      const personalBase = await readJson<any>(personalBasePath);
      const personalCompare = await readJson<any>(resolve(dir, "my-game-v1-compare-b.json"));
      const personalTune = await readJson<any>(resolve(dir, "my-game-v1-tune.json"));
      expect(personalBase.model.id).toBe("linear");
      expect(personalCompare.model.params.incomePerSec).toBe("1.84");
      expect(personalCompare.model.params.buyCostGrowth).toBe(1.17);
      expect(personalTune.strategy.id).toBe("greedy");
      expect(personalTune.objective.id).toBe("endNetWorthLog10");

      const personalSessionPath = resolve(dir, "session-game.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "session", "--out", personalSessionPath]);
      const personalSession = await readJson<any>(resolve(dir, "session-game-v1.json"));
      const personalSessionTune = await readJson<any>(resolve(dir, "session-game-v1-tune.json"));
      expect(personalSession.policy.mode).toBe("drop");
      expect(personalSession.clock.durationSec).toBe(1800);
      expect(personalSessionTune.objective.id).toBe("pacingBalancedLog10");

      const personalLongrunPath = resolve(dir, "longrun-game.json");
      runCli(["init", "scenario", "--track", "personal", "--preset", "longrun", "--out", personalLongrunPath]);
      const personalLongrun = await readJson<any>(resolve(dir, "longrun-game-v1.json"));
      const personalLongrunTune = await readJson<any>(resolve(dir, "longrun-game-v1-tune.json"));
      expect(personalLongrun.strategy.id).toBe("planner");
      expect(personalLongrun.clock.durationSec).toBe(86400);
      expect(personalLongrunTune.strategy.id).toBe("planner");
    } finally {
      await removePath(dir);
    }
  });

  it("supports named personal bundle generation", async () => {
    const dir = await createTempDir("idlekit-init-name");
    try {
      const outPath = resolve(dir, "my-game-v1.json");
      runCli(["init", "scenario", "--track", "personal", "--out", outPath, "--name", "Space Miner"]);

      const namedBase = await readJson<any>(resolve(dir, "space-miner-v1.json"));
      const namedCompare = await readJson<any>(resolve(dir, "space-miner-v1-compare-b.json"));
      const namedTune = await readJson<any>(resolve(dir, "space-miner-v1-tune.json"));
      expect(namedBase.meta.id).toBe("space-miner-v1");
      expect(namedBase.meta.title).toBe("Space Miner V1 Template");
      expect(namedCompare.meta.id).toBe("space-miner-v1-compare-b");
      expect(namedTune.meta.id).toBe("space-miner-v1-tune");
    } finally {
      await removePath(dir);
    }
  });

  it("rejects --name on non-personal tracks with stable error code", async () => {
    const dir = await createTempDir("idlekit-init-bad");
    try {
      const result = runCliFailure(["init", "scenario", "--track", "intro", "--out", resolve(dir, "bad.json"), "--name", "Nope"]);
      expect(result.stderr).toContain("[CLI_FLAG_UNSUPPORTED_FOR_TRACK]");
    } finally {
      await removePath(dir);
    }
  });

  it("fails when output exists unless force=true", async () => {
    const dir = await createTempDir("idlekit-init-force");
    try {
      const path = resolve(dir, "scenario.json");
      runCli(["init", "scenario", "--out", path]);

      const result = runCliFailure(["init", "scenario", "--out", path]);
      expect(result.stderr).toContain("[CLI_USAGE] Output file already exists");

      runCli(["init", "scenario", "--out", path, "--force", "true"]);
    } finally {
      await removePath(dir);
    }
  });
});
