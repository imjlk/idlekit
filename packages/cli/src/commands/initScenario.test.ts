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
