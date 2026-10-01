import { describe, expect, it } from "bun:test";
import { buildAnalysisArtifact } from "@idlekit/core";
import { ANALYSIS_ARTIFACT_SCHEMA_REF, OUTPUT_CONTRACT_VERSION, linkAnalysisArtifact } from "./outputMeta";

describe("analysis artifact link", () => {
  it("keeps the artifact beside CLI metadata", () => {
    const analysis = buildAnalysisArtifact({
      assumptions: ["linked"],
      observationCoverage: "complete",
      capabilities: {
        metrics: "statically-known",
        goals: "statically-known",
        reset: "unsupported",
        flow: "unsupported",
        advance: "unknown",
      },
    });
    const linked = linkAnalysisArtifact(
      {
        _meta: {
          command: "simulate",
          generatedAt: "2026-10-01T00:00:00.000Z",
          contractVersion: OUTPUT_CONTRACT_VERSION,
          cliVersion: "0.0.0",
          gitSha: "abc",
          pluginDigest: {},
          schemaRef: ANALYSIS_ARTIFACT_SCHEMA_REF,
        },
      },
      analysis,
    );
    expect(linked._meta.contractVersion).toBe("1.4.0");
    expect("analysis" in linked._meta).toBe(false);
    expect(linked.analysis).toBe(analysis);
    expect(linked._meta.schemaRef).toBe("docs/schemas/generated/analysis.artifact.v1.schema.json");
  });
});
