import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import { ensureDir, writeTextFile } from "../runtime/bun";
import { createTempDir, readSchema, removePath, runCliJson } from "../testkit/bun";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

function validateBySchema(schema: object, value: unknown, name: string): void {
  const schemaId = (schema as { $id?: string }).$id;
  if (schemaId) {
    ajv.removeSchema(schemaId);
  }
  const validate = ajv.compile(schema);
  const ok = validate(value);
  if (ok) return;
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
    .join("; ");
  throw new Error(`Schema validation failed (${name}): ${detail}`);
}

describe("output schema contracts", () => {
  it("simulate output follows schema", () => {
    const out = runCliJson(["simulate", "../../examples/tutorials/01-cafe-baseline.json", "--format", "json"]);
    return readSchema("simulate.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "simulate.output.schema.json");
      expect(out._meta.command).toBe("simulate");
    });
  });

  it("eta output follows schema", () => {
    const out = runCliJson([
      "eta",
      "../../examples/tutorials/01-cafe-baseline.json",
      "--target-worth",
      "1e5",
      "--mode",
      "analytic",
      "--format",
      "json",
    ]);
    return readSchema("eta.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "eta.output.schema.json");
    });
  });

  it("compare output follows schema", () => {
    const out = runCliJson([
      "compare",
      "../../examples/tutorials/01-cafe-baseline.json",
      "../../examples/tutorials/03-cafe-compare-b.json",
      "--metric",
      "etaToTargetWorth",
      "--target-worth",
      "1e5",
      "--max-duration",
      "7200",
      "--format",
      "json",
    ]);
    return readSchema("compare.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "compare.output.schema.json");
      expect(Array.isArray(out.insights?.drivers)).toBeTrue();
    });
  });

  it("compare bundle output follows schema", () => {
    const out = runCliJson([
      "compare",
      "../../examples/tutorials/11-my-game-v1.json",
      "../../examples/tutorials/12-my-game-compare-b.json",
      "--bundle",
      "design",
      "--format",
      "json",
    ]);
    return readSchema("compare.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "compare.output.schema.json");
      expect(out.bundle).toBe("design");
      expect(Array.isArray(out.results)).toBeTrue();
    });
  }, 20000);

  it("experience output follows schema", () => {
    const out = runCliJson([
      "experience",
      "../../examples/tutorials/11-my-game-v1.json",
      "--session-pattern",
      "short-bursts",
      "--days",
      "1",
      "--format",
      "json",
    ]);
    return readSchema("experience.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "experience.output.schema.json");
      expect(out._meta.command).toBe("experience");
    });
  });

  it("evaluate output follows schema", () => {
    const out = runCliJson([
      "evaluate",
      "../../examples/tutorials/11-my-game-v1.json",
      "--session-pattern",
      "short-bursts",
      "--days",
      "1",
      "--step",
      "600",
      "--fast",
      "true",
      "--horizons",
      "30m,2h,24h,7d",
      "--format",
      "json",
    ]);
    return readSchema("evaluate.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "evaluate.output.schema.json");
      expect(out._meta.command).toBe("evaluate");
    });
  }, 40000);

  it("doctor output follows schema", () => {
    const out = runCliJson(["doctor", "--format", "json"]);
    return readSchema("doctor.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "doctor.output.schema.json");
      expect(out._meta.command).toBe("doctor");
    });
  });

  it("setup completions output follows schema", async () => {
    const dir = await createTempDir("idlekit-setup-schema");
    const rcPath = resolve(dir, ".zshrc");
    const out = runCliJson([
      "setup",
      "completions",
      "--shell",
      "zsh",
      "--rc",
      rcPath,
      "--format",
      "json",
    ]);
    try {
      return readSchema("setup.output.schema.json").then((schema) => {
        validateBySchema(schema, out, "setup.output.schema.json");
        expect(out._meta.command).toBe("setup.completions");
      });
    } finally {
      await removePath(dir);
    }
  }, 15000);

  it("tune output follows schema", () => {
    const out = runCliJson([
      "tune",
      "../../examples/tutorials/01-cafe-baseline.json",
      "--tune",
      "../../examples/tutorials/04-cafe-tune.json",
      "--format",
      "json",
    ]);
    return readSchema("tune.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "tune.output.schema.json");
      expect(Array.isArray(out.insights?.patterns)).toBeTrue();
      expect(typeof out.insights?.scoreSpread?.plateau).toBe("boolean");
    });
  });

  it("ltv output follows schema", () => {
    const out = runCliJson([
      "ltv",
      "../../examples/tutorials/01-cafe-baseline.json",
      "--horizons",
      "30m,2h,24h,7d,30d,90d",
      "--step",
      "600",
      "--format",
      "json",
    ]);
    return readSchema("ltv.output.schema.json").then((schema) => {
      validateBySchema(schema, out, "ltv.output.schema.json");
    });
  });

  it("calibrate output follows schema", async () => {
    const telemetry = resolve(process.cwd(), "../../tmp", "schema-telemetry.csv");
    await ensureDir(resolve(process.cwd(), "../../tmp"));
    await writeTextFile(
      telemetry,
      [
        "user_id,day,revenue,ad_revenue,acquisition_cost,active",
        "u1,1,0.6,0.02,1.2,true",
        "u1,7,0.0,0.01,,true",
        "u2,1,0.0,0.02,1.0,true",
      ].join("\n"),
    );
    const out = runCliJson(["calibrate", telemetry, "--input-format", "csv", "--format", "json"]);
    validateBySchema(await readSchema("calibrate.output.schema.json"), out, "calibrate.output.schema.json");
  });

  it("kpi regress output follows schema", async () => {
    const out = runCliJson([
      "kpi",
      "regress",
      "--baseline",
      "../../examples/bench/kpi-baseline.json",
      "--current",
      "../../examples/bench/kpi-baseline.json",
      "--format",
      "json",
    ]);
    validateBySchema(await readSchema("kpi.regress.output.schema.json"), out, "kpi.regress.output.schema.json");
  });
});
