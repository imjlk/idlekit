import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { link, readFile, symlink } from "node:fs/promises";
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
  it("refuses to overwrite telemetry in both exploratory and observed modes", async () => {
    const dir = await createTempDir("idlekit-calibrate-input-protection");
    try {
      for (const extension of ["csv", "json"]) for (const observed of [false, true]) {
        const path = resolve(dir, `cohort.${extension}`);
        const source = extension === "csv" ? "user_id,day\na,0\n" : JSON.stringify([{ userId: "a", day: 0 }]);
        await writeText(path, source);
        const output = runCli(["calibrate", path, ...(observed ? ["--observed-through-day", "1"] : []), "--out", path], { check: false });
        expect(output.exitCode).not.toBe(0);
        expect(output.stderr).toContain("CLI_USAGE");
        expect(await readFile(path, "utf8")).toBe(source);
      }
    } finally { await removePath(dir); }
  });

  it("protects the scenario and telemetry aliases from output writes", async () => {
    const dir = await createTempDir("idlekit-calibrate-alias-protection");
    try {
      const input = resolve(dir, "cohort.csv");
      const source = "user_id,day\na,0\n";
      await writeText(input, source);
      const scenario = resolve(dir, "scenario.json");
      const assumptions = JSON.stringify({ schemaVersion: 1, monetization: { retention: { d1: 0.8, d7: 0.4, d30: 0.2, d90: 0.1 } } });
      await writeText(scenario, assumptions);
      const hardLink = resolve(dir, "cohort-copy.csv");
      await link(input, hardLink);
      const directoryAlias = resolve(dir, "directory-alias");
      await symlink(dir, directoryAlias, process.platform === "win32" ? "junction" : "dir");
      for (const out of [scenario, hardLink, resolve(directoryAlias, "cohort.csv")]) {
        const result = runCli(["calibrate", input, "--observed-through-day", "1", "--scenario", scenario, "--out", out], { check: false });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("CLI_USAGE");
        expect(await readFile(input, "utf8")).toBe(source);
        expect(await readFile(scenario, "utf8")).toBe(assumptions);
      }
      const report = resolve(dir, "report.json");
      expect(runCli(["calibrate", input, "--observed-through-day", "1", "--scenario", scenario, "--out", report]).exitCode).toBe(0);
      expect(JSON.parse(await readFile(report, "utf8")).ok).toBe(true);
    } finally { await removePath(dir); }
  });

  it("includes Wilson intervals in CSV and leaves future intervals unavailable", async () => {
    const dir = await createTempDir("idlekit-cohort-csv-intervals");
    try {
      const path = resolve(dir, "cohort.csv");
      await writeText(path, "user_id,day\na,0\nb,0\na,1\n");
      const args = ["calibrate", path, "--observed-through-day", "1"];
      const json = runCliJson<any>(args);
      const lines = runCli([...args, "--format", "csv"]).stdout.trim().split(/\r?\n/).map(line => line.split(","));
      const min = lines[0]!.indexOf("interval95Min");
      const max = lines[0]!.indexOf("interval95Max");
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeGreaterThanOrEqual(0);
      expect(Number(lines[1]![min])).toBe(json.observation.retention[0].interval95.min);
      expect(Number(lines[1]![max])).toBe(json.observation.retention[0].interval95.max);
      expect(lines[2]![min]).toBe("null");
      expect(lines[2]![max]).toBe("null");
    } finally { await removePath(dir); }
  });

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
      const unspecified = runCliJson<any>(["calibrate", path, "--observed-through-day", "1"]);
      expect(unspecified.patchStatus).toBe("requires-review");
      expect(unspecified.scenarioPatch.monetization.retention).toEqual({});
      expect(unspecified.patchWarnings.join(" ")).toContain("Unobserved D7");
    } finally { await removePath(dir); }
  });

  it("compares mature retention with explicit assumptions and keeps future days unobserved", async () => {
    const dir = await createTempDir("idlekit-observed-cohort");
    try {
      const path = resolve(dir, "cohort.csv");
      await writeText(path, "user_id,day,revenue,ad_revenue,active\na,0,0,0,true\nb,0,0,0,true\na,1,0,0,true\n");
      const scenario = resolve(dir, "scenario.json");
      await writeText(scenario, JSON.stringify({ schemaVersion: 1, monetization: { retention: { d1: 0.8, d7: 0.4, d30: 0.2, d90: 0.1 } } }));
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
