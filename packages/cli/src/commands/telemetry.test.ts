import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { readFile } from "node:fs/promises";
import { REPO_ROOT, createTempDir, pathExists, readJson, removePath, runCli, runCliJson, writeText } from "../testkit/bun";

const CSV = resolve(REPO_ROOT, "examples/telemetry/cohorts.csv");
const JSON_BATCH = resolve(REPO_ROOT, "examples/telemetry/cohorts.json");
const SCENARIO = resolve(REPO_ROOT, "examples/tutorials/11-my-game-v1.json");
const VARIANT_B = resolve(REPO_ROOT, "examples/tutorials/12-my-game-compare-b.json");

describe("idk telemetry", () => {
  it("validates CSV and JSON batches together and reports every cohort", () => {
    const out = runCliJson(["telemetry", "validate", CSV, JSON_BATCH]);
    expect(out._meta.command).toBe("telemetry.validate");
    expect(out._meta.schemaRef).toBe("docs/player-telemetry.md");
    expect(out.cohorts.map((cohort: { id: string }) => cohort.id)).toEqual([
      "2026-w40-control", "2026-w40-fast-start", "2026-w41-control", "2026-10-05", "2026-10-06",
    ]);
    const w41 = out.cohorts.find((cohort: { id: string }) => cohort.id === "2026-w41-control");
    expect(w41).toMatchObject({ variant: "control", installDate: "2026-10-12", users: 300 });
  });

  it("rejects an invalid batch with path-tagged issues and duplicate ids across files", async () => {
    const dir = await createTempDir("idlekit-telemetry-invalid");
    try {
      const bad = resolve(dir, "bad.json");
      await writeText(bad, JSON.stringify({ schemaVersion: 1, cohorts: [
        { id: "w1", observedThroughDay: 7, rows: [{ userId: "u1", day: 0, email: "a@example.com" }] },
        { id: "w2", observedThroughDay: 1, rows: [{ userId: "u1", day: 3 }] },
      ] }));
      const failed = runCli(["telemetry", "validate", bad], { check: false });
      expect(failed.exitCode).not.toBe(0);
      expect(failed.stderr).toContain("CLI_USAGE");
      expect(failed.stderr).toContain("$.cohorts[0].rows[0].email");
      expect(failed.stderr).toContain("$.cohorts[1]");
      const duplicate = runCli(["telemetry", "validate", JSON_BATCH, JSON_BATCH], { check: false });
      expect(duplicate.exitCode).not.toBe(0);
      expect(duplicate.stderr).toContain("Duplicate cohort id");
    } finally { await removePath(dir); }
  });

  it("compares cohorts with a baseline and scenario assumptions", () => {
    const out = runCliJson(["telemetry", "compare", CSV, "--baseline", "2026-w40-control", "--scenario", SCENARIO]);
    expect(out.comparison.baseline).toBe("2026-w40-control");
    const d1 = out.comparison.days.find((day: { day: number }) => day.day === 1);
    expect(d1.assumption).toBe(0.4);
    const cell = (id: string) => d1.cohorts.find((entry: { cohortId: string }) => entry.cohortId === id);
    expect(cell("2026-w40-fast-start").differenceFromBaselinePercentagePoints).toBeCloseTo(7, 9);
    expect(cell("2026-w40-fast-start").significance.verdict).toBe("not-significant");
    expect(cell("2026-w41-control").significance.verdict).toBe("significant");
    const missing = runCli(["telemetry", "compare", CSV, "--baseline", "nope"], { check: false });
    expect(missing.exitCode).not.toBe(0);
  });

  it("drift exits 2 only with --fail-on-drift and still writes the report", async () => {
    const dir = await createTempDir("idlekit-telemetry-drift");
    try {
      const report = resolve(dir, "drift.json");
      const failed = runCli(["telemetry", "drift", CSV, "--scenario", SCENARIO, "--fail-on-drift", "--out", report], { check: false });
      expect(failed.exitCode).toBe(2);
      const out = await readJson<any>(report);
      expect(out.status).toBe("drift");
      const w41 = out.cohorts.find((cohort: { id: string }) => cohort.id === "2026-w41-control");
      expect(w41.status).toBe("drift");
      expect(w41.findings.find((finding: { day: number }) => finding.day === 7).drift).toBe(true);
      const control = out.cohorts.find((cohort: { id: string }) => cohort.id === "2026-w40-control");
      expect(control.status).toBe("within-threshold");

      expect(runCli(["telemetry", "drift", CSV, "--scenario", SCENARIO]).exitCode).toBe(0);
      const only = runCli(["telemetry", "drift", CSV, "--scenario", SCENARIO, "--cohort", "2026-w40-control", "--fail-on-drift"], { check: false });
      expect(only.exitCode).toBe(0);
      expect(JSON.parse(only.stdout).status).toBe("within-threshold");
      const loose = runCliJson(["telemetry", "drift", CSV, "--scenario", SCENARIO, "--threshold-pp", "10"]);
      expect(loose.status).toBe("within-threshold");
    } finally { await removePath(dir); }
  });

  it("patch runs observe -> patch -> validate -> re-simulate and leaves the source scenario untouched", async () => {
    const dir = await createTempDir("idlekit-telemetry-patch");
    try {
      const patched = resolve(dir, "patched.json");
      const before = await readFile(SCENARIO, "utf8");
      const out = runCliJson([
        "telemetry", "patch", CSV, "--cohort", "2026-w41-control", "--scenario", SCENARIO,
        "--scenario-out", patched, "--horizons", "30m,7d",
      ]);
      expect(out._meta.command).toBe("telemetry.patch");
      expect(out.patchStatus).toBe("ready");
      expect(out.validation).toEqual({ ok: true });
      expect(out.changes).toEqual([
        { key: "d1", before: 0.4, after: 0.32 },
        { key: "d7", before: 0.18, after: 0.13 },
      ]);
      expect(out.diff.map((row: { horizon: string }) => row.horizon)).toEqual(["30m", "7d"]);
      const week = out.diff[1];
      expect(week.ltvPerUser.delta).toBeLessThan(0);
      expect(week.pacing.changed).toBe(false);
      expect(await readFile(SCENARIO, "utf8")).toBe(before);
      const written = await readJson<any>(patched);
      expect(written.monetization.retention).toMatchObject({ d1: 0.32, d7: 0.13, d30: 0.08, d90: 0.035 });
      expect(runCli(["validate", patched]).exitCode).toBe(0);

      const md = runCli(["telemetry", "patch", CSV, "--cohort", "2026-w41-control", "--scenario", SCENARIO, "--horizons", "7d", "--format", "md"]).stdout;
      expect(md).toContain("## LTV and pacing before and after");
      expect(md).toContain("monetization.retention.d1");
    } finally { await removePath(dir); }
  });

  it("patch exits 3 without writing a scenario when the cohort cannot support a patch", async () => {
    const dir = await createTempDir("idlekit-telemetry-not-ready");
    try {
      const batch = resolve(dir, "day0.json");
      const patched = resolve(dir, "patched.json");
      await writeText(batch, JSON.stringify({ schemaVersion: 1, cohorts: [{ id: "today", observedThroughDay: 0, rows: [{ userId: "u1", day: 0 }] }] }));
      const result = runCli(["telemetry", "patch", batch, "--scenario", SCENARIO, "--scenario-out", patched], { check: false });
      expect(result.exitCode).toBe(3);
      const out = JSON.parse(result.stdout);
      expect(out.patchStatus).not.toBe("ready");
      expect(out.diff).toEqual([]);
      expect(await pathExists(patched)).toBe(false);
      const ambiguous = runCli(["telemetry", "patch", CSV, "--scenario", SCENARIO], { check: false });
      expect(ambiguous.exitCode).not.toBe(0);
      expect(ambiguous.stderr).toContain("--cohort is required");
    } finally { await removePath(dir); }
  });

  it("sizes decreasing variants by their actual direction and treats explicit MDE as directionless", async () => {
    const dir = await createTempDir("idlekit-signed-sizing");
    try {
      const source = await readJson<Record<string, any>>(SCENARIO);
      const paths: string[] = [];
      for (const [id, rate] of [["control", 0.8], ["decrease", 0.7], ["increase", 0.9]] as const) {
        const path = resolve(dir, `${id}.json`);
        const scenario = structuredClone(source);
        scenario.monetization.retention.d1 = rate;
        await writeText(path, JSON.stringify(scenario));
        paths.push(`${id}=${path}`);
      }
      const decrease = runCliJson(["telemetry", "experiment", paths[0]!, paths[1]!, "--day", "1"]);
      expect(decrease.plan.targetRate).toBe(0.7);
      expect(decrease.plan.usersPerGroup).toBe(294);
      const increase = runCliJson(["telemetry", "experiment", paths[0]!, paths[2]!, "--day", "1"]);
      expect(increase.plan.usersPerGroup).toBe(199);
      const explicit = runCliJson(["telemetry", "experiment", paths[0]!, paths[2]!, "--day", "1", "--mde-pp", "10"]);
      expect(explicit.plan.usersPerGroup).toBe(294);
      const mixed = runCliJson(["telemetry", "experiment", ...paths, "--day", "1"]);
      expect(mixed.plan.targetRate).toBe(0.7);
      expect(mixed.plan.usersPerGroup).toBe(356);
    } finally { await removePath(dir); }
  });

  it("experiment plans sample size, observation window and assignment for scenario variants", () => {
    const out = runCliJson([
      "telemetry", "experiment", `control=${SCENARIO}`, `fast-start=${VARIANT_B}`,
      "--day", "1", "--mde-pp", "5", "--daily-installs", "400",
    ]);
    expect(out._meta.command).toBe("telemetry.experiment");
    expect(out.plan.baselineRate).toBe(0.4);
    expect(out.plan.usersPerGroup).toBe(1534);
    expect(out.plan.totalUsers).toBe(3068);
    expect(out.plan.groups.map((group: { id: string }) => group.id)).toEqual(["control", "fast-start"]);
    expect(out.assignment.groups).toEqual(["control", "fast-start"]);
    // Both tutorial variants assume the same D1, so an effect size has to be given explicitly.
    const noEffect = runCli(["telemetry", "experiment", `control=${SCENARIO}`, `fast-start=${VARIANT_B}`, "--day", "1"], { check: false });
    expect(noEffect.exitCode).not.toBe(0);
    expect(runCli(["telemetry", "experiment", `control=${SCENARIO}`], { check: false }).exitCode).not.toBe(0);
  });
});

describe("idk calibrate --cohort", () => {
  it("reads one cohort from a batch with its own cutoff", () => {
    const out = runCliJson(["calibrate", CSV, "--cohort", "2026-w41-control", "--scenario", SCENARIO]);
    expect(out.observation.observedThroughDay).toBe(7);
    expect(out.observation.users).toBe(300);
    expect(out.patchStatus).toBe("ready");
    const mismatch = runCli(["calibrate", CSV, "--cohort", "2026-w41-control", "--observed-through-day", "3"], { check: false });
    expect(mismatch.exitCode).not.toBe(0);
    expect(runCli(["calibrate", CSV], { check: false }).exitCode).not.toBe(0);
    const plain = runCli(["calibrate", resolve(REPO_ROOT, "examples/telemetry/cohort.csv"), "--cohort", "x"], { check: false });
    expect(plain.exitCode).not.toBe(0);
    expect(plain.stderr).toContain("--cohort requires a cohort batch input");
  });
});
