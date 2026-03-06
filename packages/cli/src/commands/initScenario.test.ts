import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("init scenario command", () => {
  it("writes intro and design templates", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-init-"));
    try {
      const introPath = resolve(dir, "intro.json");
      execFileSync("bun", ["src/main.ts", "init", "scenario", "--track", "intro", "--out", introPath], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const intro = JSON.parse(await readFile(introPath, "utf8"));
      expect(intro.model.id).toBe("linear");

      const designPath = resolve(dir, "design.json");
      execFileSync("bun", ["src/main.ts", "init", "scenario", "--track", "design", "--out", designPath], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const design = JSON.parse(await readFile(designPath, "utf8"));
      expect(design.model.id).toBe("plugin.generators");
      expect(design.monetization.uncertainty.correlation).toBeDefined();

      const personalBasePath = resolve(dir, "my-game-v1.json");
      execFileSync("bun", ["src/main.ts", "init", "scenario", "--track", "personal", "--out", personalBasePath], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const personalBase = JSON.parse(await readFile(personalBasePath, "utf8"));
      const personalCompare = JSON.parse(await readFile(resolve(dir, "my-game-v1-compare-b.json"), "utf8"));
      const personalTune = JSON.parse(await readFile(resolve(dir, "my-game-v1-tune.json"), "utf8"));
      expect(personalBase.model.id).toBe("linear");
      expect(personalCompare.model.params.buyCostGrowth).toBeGreaterThan(personalBase.model.params.buyCostGrowth);
      expect(personalTune.strategy.id).toBe("greedy");
      expect(personalTune.objective.id).toBe("endNetWorthLog10");

      execFileSync(
        "bun",
        ["src/main.ts", "init", "scenario", "--track", "personal", "--out", personalBasePath, "--name", "Space Miner"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );
      const namedBase = JSON.parse(await readFile(resolve(dir, "space-miner-v1.json"), "utf8"));
      const namedCompare = JSON.parse(await readFile(resolve(dir, "space-miner-v1-compare-b.json"), "utf8"));
      const namedTune = JSON.parse(await readFile(resolve(dir, "space-miner-v1-tune.json"), "utf8"));
      expect(namedBase.meta.id).toBe("space-miner-v1");
      expect(namedBase.meta.title).toBe("Space Miner V1 Template");
      expect(namedCompare.meta.id).toBe("space-miner-v1-compare-b");
      expect(namedCompare.meta.title).toBe("Space Miner Compare Variant B");
      expect(namedTune.meta.id).toBe("space-miner-v1-tune");
      expect(namedTune.meta.title).toBe("Space Miner TuneSpec");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when output exists unless force=true", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-init-force-"));
    try {
      const path = resolve(dir, "scenario.json");
      execFileSync("bun", ["src/main.ts", "init", "scenario", "--out", path], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(() =>
        execFileSync("bun", ["src/main.ts", "init", "scenario", "--out", path], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        })).toThrow("already exists");

      execFileSync("bun", ["src/main.ts", "init", "scenario", "--out", path, "--force", "true"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
