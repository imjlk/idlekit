import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import { coerceOutputMetaCompat } from "../io/outputMeta";
import { readJson, readSchema } from "../testkit/bun";

const REPO_ROOT = resolve(process.cwd(), "../..");
const COMPAT_ROOT = resolve(REPO_ROOT, "fixtures", "compat", "v1");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

function validateBySchema(schema: object, value: unknown, name: string): void {
  const validate = ajv.compile(schema);
  const ok = validate(value);
  if (ok) return;
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
    .join("; ");
  throw new Error(`Schema validation failed (${name}): ${detail}`);
}

describe("compatibility fixtures", () => {
  it("frozen output fixtures match current schemas and output meta compat rules", async () => {
    const fixtures = [
      ["simulate.output.v1.json", "simulate.output.schema.json"],
      ["compare.output.v1.json", "compare.output.schema.json"],
      ["experience.output.v1.json", "experience.output.schema.json"],
      ["ltv.output.v1.json", "ltv.output.schema.json"],
    ] as const;

    for (const [fixtureName, schemaName] of fixtures) {
      const fixture = await readJson<any>(resolve(COMPAT_ROOT, "outputs", fixtureName));
      validateBySchema(await readSchema(schemaName), fixture, schemaName);
      const meta = coerceOutputMetaCompat(fixture._meta);
      expect(typeof meta.command).toBe("string");
      expect(typeof meta.contractVersion).toBe("string");
      expect(typeof meta.cliVersion).toBe("string");
    }
  });

  it("frozen artifact fixtures match the artifact schema", async () => {
    const schema = await readSchema("artifact.v1.schema.json");
    const fixtures = [
      "simulate.artifact.v1.json",
      "experience.artifact.v1.json",
    ] as const;

    for (const fixtureName of fixtures) {
      const fixture = await readJson<any>(resolve(COMPAT_ROOT, "artifacts", fixtureName));
      validateBySchema(schema, fixture, "artifact.v1.schema.json");
      expect(fixture.kind).toBe("idk.replay.artifact");
      expect(fixture.v).toBe(1);
    }
  });
});
