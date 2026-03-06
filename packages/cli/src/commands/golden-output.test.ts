import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
    expect(out._meta?.command).toBe("compare");
    expect(out._meta?.contractVersion).toBeDefined();
    expect(out._meta?.schemaRef).toBe("docs/schemas/compare.output.schema.json");
    expect(typeof out._meta?.gitSha).toBe("string");
    expect(out._meta?.pluginDigest).toBeDefined();
    expect(typeof out._meta?.scenarioHash?.a).toBe("string");
    expect(typeof out._meta?.scenarioHash?.b).toBe("string");
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
    expect(withoutRun._meta?.command).toBe("eta");

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
    expect(withRun._meta?.command).toBe("eta");
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
    expect(out._meta?.command).toBe("tune");
    expect(typeof out._meta?.tuneSpecHash).toBe("string");
  });

  it("ltv returns default horizon summary and optional economyValueProxy", () => {
    const out = runCliJson([
      "ltv",
      BASELINE,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--fast",
      "true",
      "--value-per-worth",
      "0.001",
      "--format",
      "json",
    ]);

    expect(out.horizons).toBeDefined();
    expect(Array.isArray(out.horizons)).toBeTrue();
    expect(out.horizons.length).toBe(6);
    expect(out.summary?.at30m).toBeDefined();
    expect(out.summary?.at2h).toBeDefined();
    expect(out.summary?.at24h).toBeDefined();
    expect(out.summary?.at7d).toBeDefined();
    expect(out.summary?.at30d).toBeDefined();
    expect(out.summary?.at90d).toBeDefined();
    expect(out.horizons[0]?.economyValueProxy).toBeDefined();
    expect(out.horizons[0]?.monetization?.cumulativeLtvPerUser).toBeDefined();
    expect(out._meta?.command).toBe("ltv");
    expect(out._meta?.schemaRef).toBe("docs/schemas/ltv.output.schema.json");
    expect(typeof out._meta?.gitSha).toBe("string");
    expect(out._meta?.pluginDigest).toBeDefined();
    expect(typeof out._meta?.scenarioHash).toBe("string");
  });

  it("ltv uncertainty is deterministic for fixed seed", () => {
    const args = [
      "ltv",
      BASELINE,
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--draws",
      "120",
      "--seed",
      "77",
      "--format",
      "json",
    ];
    const a = runCliJson(args);
    const b = runCliJson(args);
    expect(a.summary?.at90d?.monetization?.cumulativeLtvPerUser).toBe(b.summary?.at90d?.monetization?.cumulativeLtvPerUser);
    expect(a.summary?.at90d?.monetization?.cumulativeLtvQuantiles?.q90).toBe(
      b.summary?.at90d?.monetization?.cumulativeLtvQuantiles?.q90,
    );
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
      "--run-id",
      "golden-run",
      "--seed",
      "42",
      "--format",
      "json",
    ]);

    expect(out.run).toBeDefined();
    expect(out.run.id).toBe("golden-run");
    expect(out.run.seed).toBe(42);
    expect(typeof out.run.generatedAt).toBe("string");
    expect(out._meta?.command).toBe("simulate");
    expect(out._meta?.runId).toBe("golden-run");
    expect(out._meta?.seed).toBe(42);
    expect(typeof out._meta?.scenarioHash).toBe("string");
    expect(out.summaries?.eventLog).toBeDefined();
    expect(out.eventLog).toBeDefined();
    expect(out.eventLog.retained).toBeLessThanOrEqual(2);
    expect(out.stats).toBeDefined();
  });

  it("simulate can write standardized replay artifact", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-sim-artifact-"));
    try {
      const artifactPath = resolve(dir, "simulate.artifact.json");
      const out = runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "20",
        "--seed",
        "101",
        "--run-id",
        "sim-artifact-run",
        "--artifact-out",
        artifactPath,
        "--format",
        "json",
      ]);
      const raw = JSON.parse(await readFile(artifactPath, "utf8"));
      expect(raw.v).toBe(1);
      expect(raw.kind).toBe("idk.replay.artifact");
      expect(raw.artifactVersion).toBe(1);
      expect(raw.schemaRef).toBe("docs/schemas/artifact.v1.schema.json");
      expect(raw.command).toBe("simulate");
      expect(raw.replay?.commandLine).toContain("simulate");
      expect(raw.replay?.verify?.runId).toBe("sim-artifact-run");
      expect(raw.replay?.verify?.seed).toBe(101);
      expect(typeof raw.replay?.verify?.scenarioHash).toBe("string");
      expect(typeof raw.replay?.verify?.gitSha).toBe("string");
      expect(raw.replay?.verify?.pluginDigest).toBeDefined();
      expect(typeof raw.replay?.verify?.resultHash).toBe("string");
      expect(raw.result?.endMoney).toBe(out.endMoney);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("simulate applies offline catch-up before main run", () => {
    const out = runCliJson([
      "simulate",
      BASELINE,
      "--offline-seconds",
      "120",
      "--duration",
      "30",
      "--format",
      "json",
    ]);

    expect(out.offline).toBeDefined();
    expect(out.offline.requestedSec).toBe(120);
    expect(out.startT).toBe(120);
    expect(out.durationSec).toBe(30);
    expect(out.totalElapsedSec).toBe(150);
  });

  it("simulate can write and resume from state json", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-sim-state-"));
    try {
      const statePath = resolve(dir, "sim-state.json");
      const first = runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "45",
        "--state-out",
        statePath,
        "--format",
        "json",
      ]);

      expect(existsSync(statePath)).toBeTrue();
      const savedRaw = JSON.parse(await readFile(statePath, "utf8"));
      expect(savedRaw.v).toBe(1);
      expect(savedRaw.t).toBe(first.endT);
      expect(savedRaw.meta?.runId).toBeDefined();
      expect(typeof savedRaw.meta?.seed).toBe("number");
      expect(savedRaw.meta?.cliVersion).toBeDefined();
      expect(savedRaw.meta?.scenarioHash).toBeDefined();
      expect(savedRaw.strategy?.id).toBe("greedy");

      const resumed = runCliJson([
        "simulate",
        BASELINE,
        "--resume",
        statePath,
        "--duration",
        "15",
        "--format",
        "json",
      ]);

      expect(resumed.startT).toBe(first.endT);
      expect(resumed.durationSec).toBe(15);
      expect(resumed.endT).toBe(first.endT + 15);
      expect(resumed.resumedFrom).toContain("sim-state.json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resume keeps scripted strategy cursor continuity", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-scripted-resume-"));
    try {
      const baselineRaw = JSON.parse(await readFile(resolve(process.cwd(), BASELINE), "utf8"));
      const scenario = {
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
          durationSec: 20,
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
      const scenarioPath = resolve(dir, "scripted-scenario.json");
      await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");

      const full = runCliJson([
        "simulate",
        scenarioPath,
        "--duration",
        "20",
        "--format",
        "json",
      ]);

      const splitStatePath = resolve(dir, "split-state.json");
      const split = runCliJson([
        "simulate",
        scenarioPath,
        "--duration",
        "7",
        "--state-out",
        splitStatePath,
        "--format",
        "json",
      ]);
      expect(split.endT).toBe(7);

      const splitStateRaw = JSON.parse(await readFile(splitStatePath, "utf8"));
      expect(splitStateRaw.strategy?.id).toBe("scripted");
      expect(splitStateRaw.strategy?.state?.cursor).toBe(1);

      const resumed = runCliJson([
        "simulate",
        scenarioPath,
        "--resume",
        splitStatePath,
        "--duration",
        "13",
        "--format",
        "json",
      ]);

      expect(resumed.endT).toBe(20);
      expect(resumed.endMoney).toBe(full.endMoney);
      expect(resumed.endNetWorth).toBe(full.endNetWorth);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
      expect(raw.kind).toBe("idk.replay.artifact");
      expect(raw.command).toBe("tune");
      expect(raw.replay?.commandLine).toContain("tune");
      expect(raw.extra?.tuneSpecPath).toBeDefined();
      expect(raw.result?.report?.best).toBeDefined();
      expect(out.regression).toBeDefined();
      expect(typeof out.regression.currentBestScore).toBe("number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("calibrate derives monetization block from csv telemetry", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-calibrate-"));
    try {
      const csvPath = resolve(dir, "telemetry.csv");
      await writeFile(
        csvPath,
        [
          "user_id,day,revenue,ad_revenue,acquisition_cost,active",
          "u1,1,0.5,0.02,1.2,true",
          "u1,7,0.0,0.02,,true",
          "u1,30,0.0,0.01,,true",
          "u2,1,0.0,0.01,1.1,true",
          "u2,7,0.0,0.01,,true",
          "u3,1,0.0,0.01,1.3,true",
        ].join("\n"),
        "utf8",
      );

      const out = runCliJson([
        "calibrate",
        csvPath,
        "--input-format",
        "csv",
        "--format",
        "json",
      ]);
      expect(out.ok).toBeTrue();
      expect(out.monetization?.retention?.d1).toBeDefined();
      expect(out.monetization?.revenue?.payerConversion).toBeDefined();
      expect(out.monetization?.uncertainty?.correlation).toBeDefined();
      expect(out.scenarioPatch?.monetization).toBeDefined();
      expect(out._meta?.command).toBe("calibrate");
      expect(typeof out._meta?.telemetryHash).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("compare can write standardized replay artifact", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-artifact-"));
    try {
      const compareArtifact = resolve(dir, "compare.artifact.json");

      runCliJson([
        "compare",
        BASELINE,
        COMPARE_B,
        "--metric",
        "endNetWorth",
        "--seed",
        "17",
        "--run-id",
        "cmp-artifact-run",
        "--artifact-out",
        compareArtifact,
        "--format",
        "json",
      ]);
      const compareRaw = JSON.parse(await readFile(compareArtifact, "utf8"));
      expect(compareRaw.kind).toBe("idk.replay.artifact");
      expect(compareRaw.command).toBe("compare");
      expect(compareRaw.replay?.verify?.runId).toBe("cmp-artifact-run");
      expect(compareRaw.replay?.verify?.seed).toBe(17);
      expect(typeof compareRaw.replay?.verify?.scenarioHash?.a).toBe("string");
      expect(typeof compareRaw.replay?.verify?.scenarioHash?.b).toBe("string");
      expect(compareRaw.result?.detail?.source).toBe("measured");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ltv can write standardized replay artifact", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-ltv-artifact-"));
    try {
      const ltvArtifact = resolve(dir, "ltv.artifact.json");

      runCliJson([
        "ltv",
        BASELINE,
        "--horizons",
        "30m,2h,24h,7d,30d,90d",
        "--step",
        "600",
        "--fast",
        "true",
        "--seed",
        "19",
        "--run-id",
        "ltv-artifact-run",
        "--artifact-out",
        ltvArtifact,
        "--format",
        "json",
      ]);
      const ltvRaw = JSON.parse(await readFile(ltvArtifact, "utf8"));
      expect(ltvRaw.kind).toBe("idk.replay.artifact");
      expect(ltvRaw.command).toBe("ltv");
      expect(ltvRaw.replay?.verify?.runId).toBe("ltv-artifact-run");
      expect(ltvRaw.replay?.verify?.seed).toBe(19);
      expect(typeof ltvRaw.replay?.verify?.scenarioHash).toBe("string");
      expect(ltvRaw.result?.summary?.at90d).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
