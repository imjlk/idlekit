import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCliJson, writeText } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

describe("simulate regression matrix", () => {
  it("covers offline + resume + fast + scripted strategy equivalence", async () => {
    const dir = await createTempDir("idlekit-sim-regression");
    try {
      const baselineRaw = await readJson<any>(resolve(process.cwd(), BASELINE));
      const scriptedScenario = {
        ...baselineRaw,
        initial: {
          ...baselineRaw.initial,
          wallet: {
            ...baselineRaw.initial.wallet,
            amount: "1e6",
          },
        },
        clock: {
          ...baselineRaw.clock,
          stepSec: 1,
          durationSec: 35,
        },
        strategy: {
          id: "scripted",
          params: {
            schemaVersion: 1,
            program: [
              { actionId: "missing.action" },
              { actionId: "buy.generator" },
            ],
            onCannotApply: "skip",
            loop: true,
          },
        },
      };

      const scenarioPath = resolve(dir, "scripted-regression.json");
      await writeText(scenarioPath, `${JSON.stringify(scriptedScenario, null, 2)}\n`);

      const full = runCliJson([
        "simulate",
        scenarioPath,
        "--duration",
        "35",
        "--fast",
        "true",
        "--format",
        "json",
      ]);
      expect(full.endT).toBe(35);

      const statePath = resolve(dir, "split-state.json");
      const first = runCliJson([
        "simulate",
        scenarioPath,
        "--duration",
        "9",
        "--fast",
        "true",
        "--state-out",
        statePath,
        "--format",
        "json",
      ]);
      expect(first.endT).toBe(9);

      const resumed = runCliJson([
        "simulate",
        scenarioPath,
        "--resume",
        statePath,
        "--offline-seconds",
        "15",
        "--duration",
        "11",
        "--fast",
        "true",
        "--format",
        "json",
      ]);

      expect(resumed.startT).toBe(24);
      expect(resumed.endT).toBe(35);
      expect(resumed.offline?.requestedSec).toBe(15);
      expect(resumed.eventLog).toBeDefined();
      expect(resumed.stats).toBeDefined();
      expect(resumed.endMoney).toBe(full.endMoney);
      expect(resumed.endNetWorth).toBe(full.endNetWorth);
    } finally {
      await removePath(dir);
    }
  });

  it("keeps an offline reset as the cooldown anchor for the online run", async () => {
    const dir = await createTempDir("idlekit-sim-offline-anchor");
    try {
      const scenario = {
        schemaVersion: 1,
        meta: { id: "offline-anchor", title: "Offline Anchor" },
        unit: { code: "COIN" },
        policy: { mode: "accumulate", maxLogGap: 14 },
        model: { id: "plugin.generators", version: 1, params: { prestigeRequirement: "1" } },
        initial: {
          t: 0,
          wallet: { unit: "COIN", amount: "80", bucket: "0" },
          vars: { producers: 0, upgrades: 0, gems: 0 },
          prestige: { count: 0, points: "0", multiplier: "1" },
        },
        clock: { stepSec: 1, durationSec: 20 },
        constraints: { minPrestigeIntervalSec: 60 },
        strategy: {
          id: "scripted",
          params: {
            schemaVersion: 1,
            program: [{ actionId: "prestige.reboot" }],
            onCannotApply: "skip",
            loop: true,
          },
        },
      };
      const scenarioPath = resolve(dir, "offline-anchor.json");
      await writeText(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);

      // Offline commits the reset at 0. The online run from 30 to 50 is still cooling.
      const out = runCliJson([
        "simulate",
        scenarioPath,
        "--offline-seconds",
        "30",
        "--duration",
        "20",
        "--plugin",
        "../../examples/plugins/custom-econ-plugin.ts",
        "--allow-plugin",
        "true",
        "--format",
        "json",
      ]);
      expect(out.startT).toBe(30);
      expect(out.endT).toBe(50);
      expect(out.prestige.count).toBe(1);
    } finally {
      await removePath(dir);
    }
  });
});
