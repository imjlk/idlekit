import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { parseCsvTelemetry, parseJsonTelemetry } from "./calibrate";
import { createTempDir, removePath, runCli, runCliJson, writeText } from "../testkit/bun";

describe("calibrate csv parser", () => {
  it("strict cohort inputs preserve inactive users and reject invented IDs, days and activity", () => {
    const rows = [{ userId: "a", day: 0, active: "false" }];
    expect(parseJsonTelemetry(JSON.stringify(rows), true)[0]?.active).toBe(false);
    expect(parseCsvTelemetry("user_id,day,active\na,0,false", true)[0]?.active).toBe(false);
    for (const csv of ["day\n0", "user_id,day\na,", "user_id,day,active\na,0,maybe", "user_id,day,day\na,0,1"]) {
      expect(() => parseCsvTelemetry(csv, true)).toThrow();
    }
    for (const input of [[{ day: 0 }], [{ userId: "a", day: null }], [{ userId: "a", day: 0, revenue: "" }]]) {
      expect(() => parseJsonTelemetry(JSON.stringify(input), true)).toThrow();
    }
  });

  it("parses quoted commas, escaped quotes, and multiline cells", () => {
    const csv = [
      "user_id,day,revenue,ad_revenue,acquisition_cost,active",
      "\"u,1\",1,\"1,200.5\",0.02,1.2,true",
      "\"u\"\"2\",7,0.0,0.01,,true",
      "\"u",
      "3\",1,0.0,0.01,1.1,true",
    ].join("\n");

    const rows = parseCsvTelemetry(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]?.userId).toBe("u,1");
    expect(rows[0]?.iapRevenue).toBe(1200.5);
    expect(rows[1]?.userId).toBe("u\"2");
    expect(rows[2]?.userId).toBe("u\n3");
  });

  it("rejects unterminated quoted field", () => {
    const csv = [
      "user_id,day,revenue,ad_revenue",
      "\"u1,1,0.2,0.01",
    ].join("\n");

    expect(() => parseCsvTelemetry(csv)).toThrow("unterminated quoted field");
  });
});

describe("calibrate command", () => {
  it("withholds a retention patch that conflicts with the remaining LTV assumptions", async () => {
    const dir = await createTempDir("idlekit-cohort-patch-conflict");
    try {
      const path = resolve(dir, "cohort.json");
      await writeText(path, JSON.stringify([{ userId: "a", day: 0, active: true }]));
      const scenario = resolve(dir, "scenario.json");
      await writeText(scenario, JSON.stringify({ schemaVersion: 1, monetization: { retention: { d1: 0.8, d7: 0.4, d30: 0.2, d90: 0.1 } } }));
      const args = ["calibrate", path, "--observed-through-day", "1", "--scenario", scenario];
      const result = runCliJson<any>(args);
      expect(result.observation.retention[0].rate).toBe(0);
      expect(result.comparison[0].observed).toBe(0);
      expect(result.patchStatus).toBe("requires-review");
      expect(result.scenarioPatch.monetization.retention).toEqual({});
      expect(result.patchWarnings[0]).toContain("D7");
      expect(runCli([...args, "--format", "md"]).stdout).toContain("requires-review");
    } finally { await removePath(dir); }
  });

  it("compares mature retention with explicit assumptions and keeps future days unobserved", async () => {
    const dir = await createTempDir("idlekit-observed-cohort");
    try {
      const path = resolve(dir, "cohort.csv");
      await writeText(path, "user_id,day,revenue,ad_revenue,active\na,0,0,0,true\nb,0,0,0,true\na,1,0,0,true\n");
      const scenario = resolve(dir, "scenario.json");
      await writeText(scenario, JSON.stringify({ schemaVersion: 1, monetization: { retention: { d1: 0.8, d7: 0.4 } } }));
      const args = ["calibrate", path, "--observed-through-day", "1", "--scenario", scenario];
      const output = runCliJson<any>(args);
      expect(output.observation.retention[0]).toMatchObject({ day: 1, status: "observed", users: 2, activeUsers: 1, rate: 0.5 });
      expect(output.observation.retention[1]).toMatchObject({ day: 7, status: "not-observed", rate: null });
      expect(output.comparison[0].differencePercentagePoints).toBeCloseTo(-30);
      expect(output.scenarioPatch).toEqual({ monetization: { retention: { d1: 0.5 } } });
      expect(output.monetization.retention.d7).toBeUndefined();
      expect(typeof output._meta.scenarioHash).toBe("string");
      const human = runCli([...args, "--format", "md"]).stdout;
      expect(human).toContain("Observed player retention");
      expect(human).toContain("not-observed");
      expect(human).toContain("causal");
      const invalid = runCli(["calibrate", path, "--scenario", scenario], { check: false });
      expect(invalid.exitCode).not.toBe(0);
      expect(invalid.stderr).toContain("observed-through-day");
    } finally { await removePath(dir); }
  });

  it("returns estimated correlation in monetization uncertainty", async () => {
    const dir = await createTempDir("idlekit-calibrate");
    try {
      const path = resolve(dir, "telemetry.csv");
      await writeText(
        path,
        [
          "user_id,day,revenue,ad_revenue,acquisition_cost,active",
          "u1,1,1.0,0.03,1.5,true",
          "u1,7,0.5,0.02,,true",
          "u1,30,0.0,0.01,,true",
          "u2,1,0.0,0.02,1.4,true",
          "u2,7,0.0,0.01,,true",
          "u3,1,0.0,0.01,1.3,true",
          "u4,1,2.0,0.05,1.6,true",
          "u4,7,1.1,0.04,,true",
          "u4,30,0.7,0.03,,true",
        ].join("\n"),
      );

      const parsed = runCliJson<any>(["calibrate", path, "--input-format", "csv", "--format", "json"]);
      expect(parsed.ok).toBeTrue();
      expect(typeof parsed.monetization?.uncertainty?.correlation?.retentionConversion).toBe("number");
      expect(typeof parsed.diagnostics?.estimatedCorrelationRaw?.retentionConversion).toBe("number");
      expect(typeof parsed.diagnostics?.correlationConfidence?.retentionConversion).toBe("number");
      expect(typeof parsed._meta?.telemetryHash).toBe("string");
    } finally {
      await removePath(dir);
    }
  });
});
