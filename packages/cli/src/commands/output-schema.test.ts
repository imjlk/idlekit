import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  const?: unknown;
};

function runCliJson(args: string[]): any {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function readSchema(name: string): JsonSchema {
  const path = resolve(process.cwd(), "../../docs/schemas", name);
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchema;
}

function isTypeMatch(value: unknown, typeName: string): boolean {
  if (typeName === "null") return value === null;
  if (typeName === "array") return Array.isArray(value);
  if (typeName === "object") return !!value && typeof value === "object" && !Array.isArray(value);
  return typeof value === typeName;
}

function validateBySchema(schema: JsonSchema, value: unknown, path = "root"): void {
  if (schema.const !== undefined && value !== schema.const) {
    throw new Error(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => isTypeMatch(value, t))) {
      throw new Error(`${path}: type mismatch, expected ${allowed.join("|")}`);
    }
  }

  if (schema.required && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${path}: required fields declared for non-object schema`);
  }

  if (schema.required && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required) {
      if (!(key in obj)) {
        throw new Error(`${path}.${key}: missing required field`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (!(key in obj)) continue;
      validateBySchema(sub, obj[key], `${path}.${key}`);
    }
  }
}

describe("output schema contracts", () => {
  it("simulate output follows schema", () => {
    const out = runCliJson(["simulate", "../../examples/tutorials/01-cafe-baseline.json", "--format", "json"]);
    validateBySchema(readSchema("simulate.output.schema.json"), out);
    expect(out._meta.command).toBe("simulate");
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
    validateBySchema(readSchema("eta.output.schema.json"), out);
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
    validateBySchema(readSchema("compare.output.schema.json"), out);
  });

  it("tune output follows schema", () => {
    const out = runCliJson([
      "tune",
      "../../examples/tutorials/01-cafe-baseline.json",
      "--tune",
      "../../examples/tutorials/04-cafe-tune.json",
      "--format",
      "json",
    ]);
    validateBySchema(readSchema("tune.output.schema.json"), out);
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
    validateBySchema(readSchema("ltv.output.schema.json"), out);
  });

  it("calibrate output follows schema", () => {
    const telemetry = resolve(process.cwd(), "../../tmp", "schema-telemetry.csv");
    mkdirSync(resolve(process.cwd(), "../../tmp"), { recursive: true });
    writeFileSync(
      telemetry,
      [
        "user_id,day,revenue,ad_revenue,acquisition_cost,active",
        "u1,1,0.6,0.02,1.2,true",
        "u1,7,0.0,0.01,,true",
        "u2,1,0.0,0.02,1.0,true",
      ].join("\n"),
    );
    const out = runCliJson(["calibrate", telemetry, "--input-format", "csv", "--format", "json"]);
    validateBySchema(readSchema("calibrate.output.schema.json"), out);
  });
});
