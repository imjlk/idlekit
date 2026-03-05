import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";

function runCliJson(args: string[]): any {
  const out = execFileSync("bun", ["src/main.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function readSchema(name: string): object {
  const path = resolve(process.cwd(), "../../docs/schemas", name);
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

function validateBySchema(schema: object, value: unknown, name: string): void {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
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
    validateBySchema(readSchema("simulate.output.schema.json"), out, "simulate.output.schema.json");
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
    validateBySchema(readSchema("eta.output.schema.json"), out, "eta.output.schema.json");
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
    validateBySchema(readSchema("compare.output.schema.json"), out, "compare.output.schema.json");
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
    validateBySchema(readSchema("tune.output.schema.json"), out, "tune.output.schema.json");
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
    validateBySchema(readSchema("ltv.output.schema.json"), out, "ltv.output.schema.json");
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
    validateBySchema(readSchema("calibrate.output.schema.json"), out, "calibrate.output.schema.json");
  });
});
