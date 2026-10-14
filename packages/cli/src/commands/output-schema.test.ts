import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import { ensureDir, writeTextFile } from "../runtime/bun";
import { createTempDir, readJson, readSchema, removePath, runCliJson } from "../testkit/bun";
import { runJudge } from "./judge";

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
  }, 180000);

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
  }, 180000);

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
  }, 180000);

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

  it("jev judge output follows its schemaRef", async () => {
    const dir = await createTempDir("idlekit-jev-schema");
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      await writeTextFile(analysis, JSON.stringify(jevAnalysisFixture()));
      await writeTextFile(rubricPath, JSON.stringify(jevRubricFixture()));
      const validate = jevBundleValidator(
        await readSchema("judge.output.schema.json"),
        await readSchema("jev.advisory.v1.schema.json"),
        await readSchema("jev.judge.output.schema.json"),
      );
      const planned = runCliJson(
        ["judge", analysis, "--rubric", rubricPath, "--provider", "jev", "--dry-run", "--format", "json"],
        { env: { ...process.env, TYPESAFE_API_KEY: "" } },
      );
      expect(planned._meta.schemaRef).toBe("docs/schemas/jev.judge.output.schema.json");
      expect(planned.advisory.status).toBe("skipped");
      validate(planned, "dry-run");
      const { generatedAt: _timestamp, ...withoutTimestamp } = planned._meta;
      expect(() => validate({ ...planned, _meta: withoutTimestamp }, "no generatedAt")).toThrow();
      expect(() => validate({ ...planned, _meta: { ...planned._meta, generatedAt: 42 } }, "non-string generatedAt")).toThrow();
      const outPath = resolve(dir, "advised.json");
      await runJudge(
        { rubric: rubricPath, provider: "jev", format: "json", model: "jev-1.13.0", out: outPath },
        analysis,
        {
          env: { TYPESAFE_API_KEY: "schema-test-key" },
          transport: async () => ({
            status: 200,
            body: JSON.stringify({
              model: "jev-1.13.0",
              answers: { "first-reset": { type: "noul", noul: 0.9 } },
              usage: { input_tokens: 11, output_tokens: 3 },
            }),
          }),
          sleep: async () => {},
        },
      );
      const advised = await readJson<{ _meta: { schemaRef: string }; advisory: { status: string; answers: unknown[] } }>(outPath);
      expect(advised._meta.schemaRef).toBe("docs/schemas/jev.judge.output.schema.json");
      expect(advised.advisory.answers.length).toBe(1);
      validate(advised, "advised");
      expect(() => validate({ ...advised, advisory: { ...advised.advisory, status: "maybe" } }, "bad status")).toThrow();
      // Every emitted bundle carries _meta, and the schema requires it.
      const { _meta: _dropped, ...withoutMeta } = advised;
      expect(() => validate(withoutMeta, "no _meta")).toThrow();
    } finally {
      await removePath(dir);
    }
  });
});

/*
 * The bundle schema references the generated rules and advisory documents by $id. Those documents carry
 * `components` and `idlekitContract`, which strict Ajv rejects as unknown keywords, so this instance is not strict.
 */
function jevBundleValidator(rules: object, advisory: object, bundle: object): (value: unknown, name: string) => void {
  const loose = new Ajv2020({ allErrors: true, strict: false });
  loose.addSchema(rules);
  loose.addSchema(advisory);
  const validate = loose.compile(bundle);
  return (value, name) => {
    if (validate(value)) return;
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim()).join("; ");
    throw new Error(`Schema validation failed (jev.judge.output.schema.json ${name}): ${detail}`);
  };
}

function jevAnalysisFixture(): object {
  return {
    schemaVersion: 1,
    algorithmVersion: "analysis-artifact-v1",
    assumptions: ["seed-19"],
    warnings: [],
    observationCoverage: "complete",
    metrics: [
      {
        metricId: "first-reset",
        metricVersion: 1,
        meaning: "first-reset-hours",
        metricKind: "stock",
        timeAxis: "instant",
        domain: "time",
        reading: "observed",
        status: "ok",
        method: "exact",
        value: 3,
      },
    ],
    goals: [],
    capabilities: {
      metrics: "statically-known",
      goals: "statically-known",
      reset: "statically-known",
      flow: "statically-known",
      advance: "statically-known",
    },
  };
}

function jevRubricFixture(): object {
  return {
    schemaVersion: 1,
    contract: "idlekit.judge.rubric.v1",
    rubricVersion: "rubric-19",
    failOn: ["error"],
    rules: [
      {
        id: "first-reset",
        metricId: "first-reset",
        operator: "lte",
        threshold: 2,
        upperThreshold: null,
        unit: "time",
        severity: "error",
        missingPolicy: "inconclusive",
        definition: "first-reset-hours",
        method: "exact",
        scenarioVersion: null,
        specVersion: null,
        engineId: null,
        pluginVersion: null,
        seed: null,
        algorithmVersion: null,
        recommendationId: "rec.metric.outside-threshold",
      },
    ],
  };
}
