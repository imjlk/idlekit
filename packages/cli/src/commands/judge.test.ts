import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, writeText } from "../testkit/bun";

function artifact(value: number, reading: "observed" | "estimated" | "unavailable" = "observed"): string {
  return JSON.stringify({
    schemaVersion: 1,
    algorithmVersion: "analysis-artifact-v1",
    assumptions: ["seed-18"],
    warnings: [],
    observationCoverage: reading === "unavailable" ? "incomplete" : "complete",
    metrics: [
      {
        metricId: "first-reset",
        metricVersion: 1,
        meaning: "first-reset-hours",
        metricKind: "stock",
        timeAxis: "instant",
        domain: "time",
        reading,
        status: reading === "unavailable" ? "insufficient-data" : "ok",
        method: "exact",
        ...(reading === "unavailable" ? {} : { value }),
      },
    ],
    goals: [],
    capabilities: {
      metrics: reading === "unavailable" ? "unknown" : "statically-known",
      goals: "statically-known",
      reset: "statically-known",
      flow: "statically-known",
      advance: "statically-known",
    },
  });
}

function rubric(metricId = "first-reset"): string {
  return JSON.stringify({
    schemaVersion: 1,
    contract: "idlekit.judge.rubric.v1",
    rubricVersion: "rubric-18",
    failOn: ["error"],
    rules: [
      {
        id: "first-reset",
        metricId,
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
  });
}

describe("judge command", () => {
  it("advises from rules without rewriting the numerical verdict", async () => {
    const dir = await createTempDir("idlekit-judge");
    const analysis = resolve(dir, "analysis.json");
    const rubricPath = resolve(dir, "rubric.json");
    await writeText(analysis, artifact(3));
    await writeText(rubricPath, rubric());
    const judged = runCli(["judge", analysis, "--rubric", rubricPath, "--provider", "rules", "--format", "json"]);
    expect(judged.exitCode).toBe(0);
    const json = JSON.parse(judged.stdout);
    expect(json.contract).toBe("idlekit.judge.v1");
    expect(json.provider).toBe("rules");
    expect(json.externalProvider).toBe(false);
    expect(json.numerical.pass).toBe(false);
    expect(json.numerical.results[0].verdict).toBe("fail");
    expect(json.numerical.results[0].evidence.value).toBe(3);
    expect(json.diagnostics[0].status).toBe("conflict");
    expect(json._meta.command).toBe("judge");
    expect(json._meta.schemaRef).toBe("docs/schemas/judge.output.schema.json");
    const again = runCli(["judge", analysis, "--rubric", rubricPath, "--provider", "rules", "--format", "json"]);
    const second = JSON.parse(again.stdout);
    expect(second.advisoryDigest).toBe(json.advisoryDigest);
    const bad = runCli(["judge", analysis, "--rubric", rubricPath, "--provider", "nope"], { check: false });
    expect(bad.exitCode).toBe(1);
    await writeText(rubricPath, rubric("absent-metric"));
    const missing = runCli(["judge", analysis, "--rubric", rubricPath, "--provider", "rules"], { check: false });
    expect(missing.exitCode).toBe(1);
    await writeText(analysis, artifact(1.5, "unavailable"));
    await writeText(rubricPath, rubric());
    const thin = runCli(["judge", analysis, "--rubric", rubricPath, "--provider", "rules", "--format", "json"]);
    const thinJson = JSON.parse(thin.stdout);
    expect(thinJson.diagnostics[0].status).toBe("insufficient");
    expect(JSON.stringify(thinJson).includes("balanced")).toBe(false);
    expect(JSON.stringify(thinJson).includes("healthy")).toBe(false);
    const doctor = runCli(["doctor", "--format", "json"]);
    const doctorJson = JSON.parse(doctor.stdout);
    expect(doctorJson._meta.command).toBe("doctor");
    expect(doctorJson.contract).toBeUndefined();
    const markdown = runCli(["judge", analysis, "--rubric", rubricPath, "--format", "md"]);
    expect(markdown.stdout).toContain("This is not doctor");
    expect((await readText(resolve(dir, "analysis.json"))).length).toBeGreaterThan(0);
    await removePath(dir);
  });
});
