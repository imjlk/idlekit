import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, writeText } from "../testkit/bun";

const baseline = resolve(import.meta.dir, "../../../../examples/bench/kpi-baseline.json");

function checkFile(firstResetHours: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    contract: "idlekit.balance-checks.v1",
    failOn: ["error"],
    advisory: null,
    checks: [
      {
        id: "first-reset",
        metricId: "first-reset",
        operator: "lte",
        threshold: 2,
        upperThreshold: null,
        unit: "h",
        severity: "error",
        missingPolicy: "inconclusive",
        definition: "design-threshold",
        method: "observation",
        scenarioVersion: "scenario-v1",
        specVersion: "checks-v1",
        engineId: "number",
        pluginVersion: "none",
        seed: "17",
        algorithmVersion: "1",
      },
    ],
    observations: [
      {
        identity: {
          metricId: "first-reset",
          definition: "design-threshold",
          method: "observation",
          scenarioVersion: "scenario-v1",
          specVersion: "checks-v1",
          engineId: "number",
          pluginVersion: "none",
          seed: "17",
          unit: "h",
          algorithmVersion: "1",
        },
        status: "measured",
        value: firstResetHours,
        lower: firstResetHours,
        upper: firstResetHours,
      },
    ],
  });
}

describe("balance check command", () => {
  it("passes a measured first reset and fails a later one without a scenario", async () => {
    const dir = await createTempDir("idlekit-balance-checks");
    const passPath = resolve(dir, "pass.json");
    const failPath = resolve(dir, "fail.json");
    await writeText(passPath, checkFile(1.5));
    await writeText(failPath, checkFile(3));
    const passed = runCli(["evaluate", "--checks", passPath, "--format", "json"]);
    expect(passed.exitCode).toBe(0);
    const passJson = JSON.parse(passed.stdout);
    expect(passJson.contract).toBe("idlekit.balance-checks.v1");
    expect(passJson.pass).toBe(true);
    expect(passJson.externalProvider).toBe(false);
    const failed = runCli(["evaluate", "--checks", failPath, "--format", "json"], { check: false });
    expect(failed.exitCode).toBe(2);
    const failJson = JSON.parse(failed.stdout);
    expect(failJson.kind).toBe("balance-check-error");
    expect(failJson.failed[0].metricId).toBe("first-reset");
    expect(failJson.failed[0].evidence.value).toBe(3);
    const usage = runCli(["evaluate", "--checks", passPath, "--fail-on", "nope"], { check: false });
    expect(usage.exitCode).toBe(1);
    await removePath(dir);
  });

  it("keeps the kpi regress fixture exit codes", async () => {
    const same = runCli([
      "kpi",
      "regress",
      "--baseline",
      baseline,
      "--current",
      baseline,
      "--format",
      "json",
    ]);
    expect(same.exitCode).toBe(0);
    const sameJson = JSON.parse(same.stdout);
    expect(sameJson.pass).toBe(true);
    expect(sameJson._meta.command).toBe("kpi.regress");
    const raw = JSON.parse(await readText(baseline)) as {
      ltv: { a: { summary: { at7d: { endNetWorth: string } } } };
    };
    raw.ltv.a.summary.at7d.endNetWorth = "1";
    const dir = await createTempDir("idlekit-kpi-fail");
    const current = resolve(dir, "current.json");
    await writeText(current, JSON.stringify(raw));
    const failed = runCli(
      ["kpi", "regress", "--baseline", baseline, "--current", current, "--format", "json"],
      { check: false },
    );
    expect(failed.exitCode).toBe(2);
    expect(JSON.parse(failed.stdout).pass).toBe(false);
    await removePath(dir);
  });
});
