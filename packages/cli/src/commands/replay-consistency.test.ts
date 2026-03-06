import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { hashReplayResult } from "../io/replayArtifact";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";
const COMPARE_B = "../../examples/tutorials/03-cafe-compare-b.json";
const TUNE = "../../examples/tutorials/04-cafe-tune.json";
const REPO_ROOT = resolve(process.cwd(), "../..");

function runCliJson(args: string[]): any {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function runCliJsonFromRepoRoot(args: string[]): any {
  const out = execFileSync("bun", ["packages/cli/src/main.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function replayArgsToFlagMap(args: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (!token || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = args[i + 1];
    if (value === undefined) continue;
    out[key] = value;
    i += 1;
  }
  return out;
}

function requiredFlag(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) {
    throw new Error(`Missing replay flag: ${key}`);
  }
  return value;
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

  it("normalizes root-cwd path flags in artifacts for replay verify", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-replay-root-cwd-"));
    try {
      const baseline = "examples/tutorials/01-cafe-baseline.json";
      const compareB = "examples/tutorials/03-cafe-compare-b.json";
      const tunePath = "examples/tutorials/04-cafe-tune.json";
      const pluginPath = "examples/plugins/custom-econ-plugin.ts";
      const pluginRoot = "examples/plugins";
      const pluginAbs = resolve(REPO_ROOT, pluginPath);
      const pluginSha = createHash("sha256").update(readFileSync(pluginAbs)).digest("hex");
      const pluginShaArg = `${pluginPath}=${pluginSha}`;
      const trustPath = resolve(dir, "plugin-trust.json");
      writeFileSync(trustPath, JSON.stringify({ plugins: { [pluginAbs]: pluginSha } }, null, 2), "utf8");

      const artifacts = {
        simulate: resolve(dir, "simulate.artifact.json"),
        compare: resolve(dir, "compare.artifact.json"),
        tune: resolve(dir, "tune.artifact.json"),
        ltv: resolve(dir, "ltv.artifact.json"),
      };

      const commonPluginFlags = [
        "--plugin",
        pluginPath,
        "--allow-plugin",
        "true",
        "--plugin-root",
        pluginRoot,
        "--plugin-sha256",
        pluginShaArg,
        "--plugin-trust-file",
        trustPath,
      ];

      runCliJsonFromRepoRoot([
        "simulate",
        baseline,
        ...commonPluginFlags,
        "--seed",
        "301",
        "--run-id",
        "root-cwd-sim",
        "--artifact-out",
        artifacts.simulate,
        "--format",
        "json",
      ]);

      runCliJsonFromRepoRoot([
        "compare",
        baseline,
        compareB,
        "--metric",
        "endNetWorth",
        ...commonPluginFlags,
        "--seed",
        "302",
        "--run-id",
        "root-cwd-compare",
        "--artifact-out",
        artifacts.compare,
        "--format",
        "json",
      ]);

      runCliJsonFromRepoRoot([
        "tune",
        baseline,
        "--tune",
        tunePath,
        ...commonPluginFlags,
        "--seed",
        "303",
        "--run-id",
        "root-cwd-tune",
        "--artifact-out",
        artifacts.tune,
        "--format",
        "json",
      ]);

      runCliJsonFromRepoRoot([
        "ltv",
        baseline,
        "--horizons",
        "30m,2h,24h,7d,30d,90d",
        "--step",
        "600",
        ...commonPluginFlags,
        "--seed",
        "304",
        "--run-id",
        "root-cwd-ltv",
        "--artifact-out",
        artifacts.ltv,
        "--format",
        "json",
      ]);

      for (const [key, path] of Object.entries(artifacts)) {
        const verified = runCliJson(["replay", "verify", path, "--format", "json"]);
        expect(verified.ok).toBeTrue();
        const raw = JSON.parse(await readFile(path, "utf8")) as {
          replay: { args: string[] };
          input: { positional: string[] };
        };
        for (const pos of raw.input.positional) {
          expect(isAbsolute(pos)).toBeTrue();
        }
        const replayFlags = replayArgsToFlagMap(raw.replay.args);
        const pluginValue = requiredFlag(replayFlags, "plugin");
        const pluginRootValue = requiredFlag(replayFlags, "plugin-root");
        const pluginTrustFileValue = requiredFlag(replayFlags, "plugin-trust-file");
        const pluginShaValue = requiredFlag(replayFlags, "plugin-sha256");
        expect(isAbsolute(pluginValue.split(",")[0]!)).toBeTrue();
        expect(isAbsolute(pluginRootValue.split(",")[0]!)).toBeTrue();
        expect(isAbsolute(pluginTrustFileValue)).toBeTrue();
        const shaPath = pluginShaValue.split("=")[0]!;
        expect(isAbsolute(shaPath)).toBeTrue();
        if (key === "tune") {
          expect(isAbsolute(requiredFlag(replayFlags, "tune"))).toBeTrue();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes root-cwd resume paths in simulate replay artifacts", async () => {
    mkdirSync(resolve(REPO_ROOT, "tmp"), { recursive: true });
    const dir = await mkdtemp(resolve(REPO_ROOT, "tmp", "idlekit-replay-root-resume-"));
    try {
      const baseline = "examples/tutorials/01-cafe-baseline.json";
      const resumeAbs = resolve(dir, "resume-state.json");
      const artifactPath = resolve(dir, "resume.artifact.json");

      runCliJsonFromRepoRoot([
        "simulate",
        baseline,
        "--duration",
        "12",
        "--seed",
        "401",
        "--run-id",
        "root-resume-state",
        "--state-out",
        resumeAbs,
        "--format",
        "json",
      ]);

      runCliJsonFromRepoRoot([
        "simulate",
        baseline,
        "--resume",
        relative(REPO_ROOT, resumeAbs),
        "--duration",
        "18",
        "--seed",
        "401",
        "--run-id",
        "root-resume-artifact",
        "--artifact-out",
        artifactPath,
        "--format",
        "json",
      ]);

      const verified = runCliJson(["replay", "verify", artifactPath, "--format", "json"]);
      expect(verified.ok).toBeTrue();

      const raw = JSON.parse(await readFile(artifactPath, "utf8")) as {
        replay: { args: string[] };
      };
      const replayFlags = replayArgsToFlagMap(raw.replay.args);
      expect(isAbsolute(requiredFlag(replayFlags, "resume"))).toBeTrue();
      expect(requiredFlag(replayFlags, "resume")).toBe(resumeAbs);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
