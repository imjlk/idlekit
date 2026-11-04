import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCli, runCliFailure, runCliJson } from "../testkit/bun";
import { GENRE_PRESET_INFO, GENRE_PRESETS } from "./genres";

let dir = "";

beforeAll(async () => {
  dir = await createTempDir("idk-genres");
});

afterAll(async () => {
  await removePath(dir);
});

describe("genre presets", () => {
  it("offers at least four genres on the built-in models", () => {
    expect(GENRE_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of GENRE_PRESETS) expect(GENRE_PRESET_INFO[preset].id).toBe(preset);
  });

  for (const preset of GENRE_PRESETS) {
    it(`${preset}: init → validate → simulate → experience → evaluate`, async () => {
      const path = resolve(dir, `${preset}.json`);
      const init = runCli(["init", "scenario", "--preset", preset, "--out", path]);
      expect(init.stdout).toContain(`Wrote genre scenario template (${preset})`);
      const scenario = await readJson<{ model: { id: string }; meta: { tags: string[] } }>(path);
      expect(scenario.model.id).toBe(GENRE_PRESET_INFO[preset].model);
      expect(scenario.meta.tags).toContain(preset);

      expect(runCli(["validate", path]).stdout).toContain("OK:");
      // Only the stochastic genres vary between draws; one draw keeps the deterministic ones fast.
      const draws = preset === "cookie-clicker" || preset === "session-arcade" ? "2" : "1";

      const simulated = runCliJson(["simulate", path, "--format", "json"]);
      expect(Number(simulated.endNetWorth)).toBeGreaterThan(0);
      if (preset === "prestige-heavy") expect(simulated.prestige.count).toBeGreaterThan(1);

      const experience = runCliJson(["experience", path, "--days", "1", "--draws", draws, "--format", "json"]);
      expect(experience.perceived.visibleChangeCount).toBeGreaterThan(0);

      const evaluated = runCliJson(["evaluate", path, "--days", "1", "--draws", draws, "--horizons", "30m,2h", "--format", "json"]);
      expect(evaluated.ok).toBe(true);
      expect(evaluated.ltv).toBeDefined();
    });
  }

  it("rejects --wizard and a non-intro track with a genre preset", () => {
    const path = resolve(dir, "rejected.json");
    const wizard = runCliFailure(["init", "scenario", "--preset", "tycoon", "--wizard", "true", "--out", path]);
    expect(wizard.stderr + wizard.stdout).toContain("--wizard does not support the genre preset");
    const track = runCliFailure(["init", "scenario", "--preset", "tycoon", "--track", "personal", "--out", path]);
    expect(track.stderr + track.stdout).toContain("supports only --track intro");
  });
});
