import { describe, expect, it } from "bun:test";
import { coerceOutputMetaCompat } from "./outputMeta";

describe("output meta compatibility", () => {
  it("coerces legacy meta payload to current contract fields", () => {
    const legacy = {
      command: "simulate",
      generatedAt: "2026-03-06T00:00:00.000Z",
      cliVersion: "0.1.0",
      scenarioHash: "abc",
    };

    const coerced = coerceOutputMetaCompat(legacy);
    expect(coerced.command).toBe("simulate");
    expect(coerced.contractVersion).toBe("1.0.0");
    expect(coerced.schemaRef).toBe("docs/schemas/simulate.output.schema.json");
    expect(coerced.gitSha).toBe("unknown");
    expect(coerced.pluginDigest).toEqual({});
  });

  it("preserves explicit modern fields", () => {
    const modern = {
      command: "compare",
      generatedAt: "2026-03-06T00:00:00.000Z",
      contractVersion: "1.1.0",
      schemaRef: "docs/schemas/compare.output.schema.json",
      cliVersion: "0.1.0",
      gitSha: "abc1234",
      runId: "run-1",
      seed: 42,
      pluginDigest: {
        "/plugin.ts": "deadbeef",
      },
      scenarioHash: {
        a: "a",
        b: "b",
      },
    };

    const coerced = coerceOutputMetaCompat(modern);
    expect(coerced.contractVersion).toBe("1.1.0");
    expect(coerced.schemaRef).toBe("docs/schemas/compare.output.schema.json");
    expect(coerced.gitSha).toBe("abc1234");
    expect(coerced.runId).toBe("run-1");
    expect(coerced.seed).toBe(42);
    expect(coerced.pluginDigest).toEqual({ "/plugin.ts": "deadbeef" });
  });
});
