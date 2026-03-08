import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { parseCsvTelemetry } from "./calibrate";
import { createTempDir, removePath, runCliJson, writeText } from "../testkit/bun";

describe("calibrate csv parser", () => {
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
