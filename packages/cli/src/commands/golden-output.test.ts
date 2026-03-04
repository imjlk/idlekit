import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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

describe("CLI golden outputs", () => {
  it("compare returns measured source payload", () => {
    const out = runCliJson([
      "compare",
      BASELINE,
      COMPARE_B,
      "--metric",
      "etaToTargetWorth",
      "--target-worth",
      "1e5",
      "--max-duration",
      "7200",
      "--format",
      "json",
    ]);

    expect(out.metric).toBe("etaToTargetWorth");
    expect(out.detail?.source).toBe("measured");
    expect(out.measured?.a).toBeDefined();
    expect(out.measured?.b).toBeDefined();
  });

  it("eta simulate excludes run by default and includes it on demand", () => {
    const withoutRun = runCliJson([
      "eta",
      BASELINE,
      "--target-worth",
      "1e5",
      "--mode",
      "simulate",
      "--max-duration",
      "1200",
      "--format",
      "json",
    ]);
    expect(withoutRun.mode).toBe("simulate");
    expect(withoutRun.run).toBeUndefined();

    const withRun = runCliJson([
      "eta",
      BASELINE,
      "--target-worth",
      "1e5",
      "--mode",
      "simulate",
      "--max-duration",
      "1200",
      "--include-run",
      "true",
      "--format",
      "json",
    ]);
    expect(withRun.mode).toBe("simulate");
    expect(withRun.run).toBeDefined();
  });

  it("tune returns report.best", () => {
    const out = runCliJson([
      "tune",
      BASELINE,
      "--tune",
      TUNE,
      "--format",
      "json",
    ]);

    expect(out.ok).toBeTrue();
    expect(out.report?.best).toBeDefined();
  });

  it("simulate supports event log overrides", () => {
    const out = runCliJson([
      "simulate",
      BASELINE,
      "--duration",
      "30",
      "--event-log-enabled",
      "true",
      "--event-log-max",
      "2",
      "--format",
      "json",
    ]);

    expect(out.eventLog).toBeDefined();
    expect(out.eventLog.retained).toBeLessThanOrEqual(2);
    expect(out.stats).toBeDefined();
  });

  it("tune can write artifact and compare baseline artifact", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-tune-artifact-"));
    try {
      const baselinePath = resolve(dir, "baseline.json");
      runCliJson([
        "tune",
        BASELINE,
        "--tune",
        TUNE,
        "--artifact-out",
        baselinePath,
        "--format",
        "json",
      ]);

      const currentPath = resolve(dir, "current.json");
      const out = runCliJson([
        "tune",
        BASELINE,
        "--tune",
        TUNE,
        "--artifact-out",
        currentPath,
        "--baseline-artifact",
        baselinePath,
        "--format",
        "json",
      ]);

      const raw = JSON.parse(await readFile(currentPath, "utf8"));
      expect(raw.v).toBe(1);
      expect(raw.result?.report?.best).toBeDefined();
      expect(out.regression).toBeDefined();
      expect(typeof out.regression.currentBestScore).toBe("number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
