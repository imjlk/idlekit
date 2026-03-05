import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";

function runCliJson(args: string[]): any {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

describe("simulate regression matrix", () => {
  it("covers offline + resume + fast + scripted strategy equivalence", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-sim-regression-"));
    try {
      const baselineRaw = JSON.parse(await readFile(resolve(process.cwd(), BASELINE), "utf8"));
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
      await writeFile(scenarioPath, `${JSON.stringify(scriptedScenario, null, 2)}\n`, "utf8");

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
      await rm(dir, { recursive: true, force: true });
    }
  });
});
