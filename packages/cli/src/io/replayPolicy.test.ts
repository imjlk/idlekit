import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildOutputMeta } from "./outputMeta";
import { writeCommandReplayArtifact } from "./replayPolicy";

describe("replay policy", () => {
  it("omits command-specific flags and keeps forced flags", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-replay-policy-"));
    try {
      const outPath = resolve(dir, "simulate.artifact.json");
      const meta = buildOutputMeta({
        command: "simulate",
        scenarioPath: "examples/tutorials/01-cafe-baseline.json",
        scenario: { schemaVersion: 1 },
        runId: "run-1",
        seed: 7,
      });

      await writeCommandReplayArtifact({
        command: "simulate",
        outPath,
        positional: ["/abs/scenario.json"],
        flags: {
          out: "/tmp/out.json",
          "artifact-out": outPath,
          "state-out": "/tmp/state.json",
        },
        forcedFlags: {
          seed: 7,
          "run-id": "run-1",
          format: "json",
        },
        result: { ok: true },
        meta,
      });

      const raw = JSON.parse(await readFile(outPath, "utf8"));
      const replayArgs = raw.replay?.args as string[];
      expect(replayArgs).toContain("simulate");
      expect(replayArgs).toContain("--seed");
      expect(replayArgs).toContain("7");
      expect(replayArgs).not.toContain("--out");
      expect(replayArgs).not.toContain("--artifact-out");
      expect(replayArgs).not.toContain("--state-out");
      expect(raw.replay?.verify?.runId).toBe("run-1");
      expect(raw.replay?.verify?.seed).toBe(7);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies tune omission policy for regression-only flags", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-replay-policy-tune-"));
    try {
      const outPath = resolve(dir, "tune.artifact.json");
      const meta = buildOutputMeta({
        command: "tune",
        scenarioPath: "examples/tutorials/01-cafe-baseline.json",
        scenario: { schemaVersion: 1 },
      });

      await writeCommandReplayArtifact({
        command: "tune",
        outPath,
        positional: ["/abs/scenario.json"],
        flags: {
          "baseline-artifact": "/tmp/base.json",
          "regression-tolerance": 0.1,
          "fail-on-regression": true,
        },
        forcedFlags: {
          tune: "/abs/tune.json",
          format: "json",
        },
        result: { ok: true },
        meta,
      });

      const raw = JSON.parse(await readFile(outPath, "utf8"));
      const replayArgs = raw.replay?.args as string[];
      expect(replayArgs).toContain("tune");
      expect(replayArgs).toContain("--tune");
      expect(replayArgs).not.toContain("--baseline-artifact");
      expect(replayArgs).not.toContain("--regression-tolerance");
      expect(replayArgs).not.toContain("--fail-on-regression");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
