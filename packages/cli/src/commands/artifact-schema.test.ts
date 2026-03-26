import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import { createTempDir, readJson, readSchema, removePath, runCliJson } from "../testkit/bun";

const BASELINE = "../../examples/tutorials/01-cafe-baseline.json";
const COMPARE_B = "../../examples/tutorials/03-cafe-compare-b.json";
const TUNE = "../../examples/tutorials/04-cafe-tune.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });

function validateBySchema(schema: object, value: unknown, name: string): void {
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
    .join("; ");
  throw new Error(`Schema validation failed (${name}): ${detail}`);
}

describe("artifact schema contracts", () => {
  it("simulate/compare/tune/ltv artifact files follow artifact schema", async () => {
    const dir = await createTempDir("idlekit-artifact-schema");
    try {
      const simArtifact = resolve(dir, "simulate.artifact.json");
      const cmpArtifact = resolve(dir, "compare.artifact.json");
      const experienceArtifact = resolve(dir, "experience.artifact.json");
      const tuneArtifact = resolve(dir, "tune.artifact.json");
      const ltvArtifact = resolve(dir, "ltv.artifact.json");

      runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "30",
        "--seed",
        "11",
        "--run-id",
        "schema-sim-run",
        "--artifact-out",
        simArtifact,
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
        "11",
        "--run-id",
        "schema-cmp-run",
        "--artifact-out",
        cmpArtifact,
        "--format",
        "json",
      ]);

      runCliJson([
        "experience",
        BASELINE,
        "--session-pattern",
        "short-bursts",
        "--days",
        "1",
        "--seed",
        "11",
        "--run-id",
        "schema-experience-run",
        "--artifact-out",
        experienceArtifact,
        "--format",
        "json",
      ]);

      runCliJson([
        "tune",
        BASELINE,
        "--tune",
        TUNE,
        "--seed",
        "11",
        "--run-id",
        "schema-tune-run",
        "--artifact-out",
        tuneArtifact,
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
        "11",
        "--run-id",
        "schema-ltv-run",
        "--artifact-out",
        ltvArtifact,
        "--format",
        "json",
      ]);

      const artifactSchema = await readSchema("artifact.v1.schema.json");
      for (const path of [simArtifact, cmpArtifact, experienceArtifact, tuneArtifact, ltvArtifact]) {
        const parsed = await readJson<any>(path);
        validateBySchema(artifactSchema, parsed, "artifact.v1.schema.json");
      }
    } finally {
      await removePath(dir);
    }
  }, 20000);

  it("replay verify output follows schema", async () => {
    const dir = await createTempDir("idlekit-replay-verify-schema");
    try {
      const artifactPath = resolve(dir, "simulate.artifact.json");
      runCliJson([
        "simulate",
        BASELINE,
        "--duration",
        "20",
        "--seed",
        "17",
        "--run-id",
        "replay-verify-schema-run",
        "--artifact-out",
        artifactPath,
        "--format",
        "json",
      ]);

      const out = runCliJson(["replay", "verify", artifactPath, "--format", "json"]);
      validateBySchema(await readSchema("replay.verify.output.schema.json"), out, "replay.verify.output.schema.json");
      expect(out.ok).toBeTrue();
    } finally {
      await removePath(dir);
    }
  });
});
