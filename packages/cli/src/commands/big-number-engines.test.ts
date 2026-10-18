import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createTempDir, readJson, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

let dir = "";
let a = "", b = "", small = "", tune = "";
let pluginFlags: string[] = [];
beforeAll(async () => {
  dir = await createTempDir("idlekit-cli-engines");
  const plugin = resolve(dir, "model.mjs");
  await writeText(plugin, `export const models = [{ id: "engine-fixture", version: 1, create() { return {
    id: "engine-fixture", version: 1, income: ctx => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
    netWorth: (_ctx, state) => state.wallet.money, actions: () => []
  }; } }];`);
  pluginFlags = ["--plugin", plugin, "--allow-plugin", "true"];
  const scenario = (amount: string) => ({ schemaVersion: 1, unit: { code: "MANA" }, policy: { mode: "drop" },
    model: { id: "engine-fixture", version: 1 }, initial: { wallet: { unit: "MANA", amount }, vars: {} },
    clock: { stepSec: 1, durationSec: 1 } });
  a = resolve(dir, "a.json"); b = resolve(dir, "b.json"); small = resolve(dir, "small.json"); tune = resolve(dir, "tune.json");
  await writeText(a, JSON.stringify(scenario("1e400")));
  await writeText(b, JSON.stringify(scenario("2e400")));
  await writeText(small, JSON.stringify(scenario("10")));
  await writeText(tune, JSON.stringify({ schemaVersion: 1,
    strategy: { id: "greedy", baseParams: { schemaVersion: 1, objective: "maximizeIncome" }, space: [{ path: "objective", space: {
      kind: "choice", values: ["maximizeIncome", "minPayback"],
    } }] }, objective: { id: "endNetWorthLog10" },
    runner: { seeds: [1], budget: 2, overrideDurationSec: 1, topK: 2 },
  }));
});
afterAll(async () => { await removePath(dir); });

test("compare orders huge monetary values and replays the selected engine", async () => {
  const artifact = resolve(dir, "compare.json");
  const result = runCliJson(["compare", a, b, "--engine", "breakInfinity", ...pluginFlags, "--artifact-out", artifact]);
  expect(result.better).toBe("b");
  expect(result.measured.a.endMoney).toBe("1e+400");
  expect(result.measured.b.endMoney).toBe("2e+400");
  // `_meta.effectiveEngine` names breakInfinity; no value may serialize as Infinity.
  expect(JSON.stringify(result).replaceAll('"breakInfinity"', "")).not.toContain("Infinity");
  expect(result._meta.effectiveEngine).toBe("breakInfinity");
  const saved = await readJson<{ replay: { args: string[] } }>(artifact);
  expect(saved.replay.args).toContain("breakInfinity");
  expect(runCliJson(["replay", "verify", artifact]).ok).toBe(true);
}, 180_000);

test("tune scores huge monetary values finitely and replays its engine", async () => {
  const artifact = resolve(dir, "tuned.json");
  const result = runCliJson(["tune", a, "--tune", tune, "--engine", "breakInfinity", ...pluginFlags, "--artifact-out", artifact]);
  expect(result.ok).toBe(true);
  expect(result.report.best.score).toBe(400);
  expect(result.report.top.every((entry: { score: number }) => Number.isFinite(entry.score))).toBe(true);
  const saved = await readJson<{ replay: { args: string[] }; meta: { effectiveEngine?: string } }>(artifact);
  expect(saved.replay.args).toContain("breakInfinity");
  expect(saved.meta.effectiveEngine).toBe("breakInfinity");
  expect(runCliJson(["replay", "verify", artifact]).ok).toBe(true);
}, 180_000);

test("tune refuses a baseline artifact from another engine", async () => {
  const artifact = resolve(dir, "baseline-big.json");
  runCliJson(["tune", a, "--tune", tune, "--engine", "breakInfinity", ...pluginFlags, "--artifact-out", artifact]);
  const mismatch = runCliFailure(["tune", a, "--tune", tune, ...pluginFlags, "--baseline-artifact", artifact]);
  expect(mismatch.stderr).toContain("CLI_USAGE");
  expect(mismatch.stderr).toContain("Baseline artifact engine mismatch: expected number, got breakInfinity");
  const same = runCliJson(["tune", a, "--tune", tune, "--engine", "breakInfinity", ...pluginFlags, "--baseline-artifact", artifact]);
  expect(same.regression.regressed).toBe(false);
  expect(same._meta.effectiveEngine).toBe("breakInfinity");
  // An artifact written before `_meta.effectiveEngine` still names its engine in the recorded flags.
  const saved = await readJson<{ meta: Record<string, unknown> }>(artifact);
  const { effectiveEngine: _engine, ...legacyMeta } = saved.meta;
  const legacy = resolve(dir, "baseline-legacy.json");
  await writeText(legacy, JSON.stringify({ ...saved, meta: legacyMeta }));
  expect(runCliFailure(["tune", a, "--tune", tune, ...pluginFlags, "--baseline-artifact", legacy]).stderr).toContain("got breakInfinity");
}, 240_000);

test("default and explicit number retain their identities while another engine separates them", () => {
  for (const args of [["compare", small, small], ["tune", small, "--tune", tune]]) {
    const omitted = runCliJson([...args, ...pluginFlags]);
    const explicit = runCliJson([...args, ...pluginFlags, "--engine", "number"]);
    const big = runCliJson([...args, ...pluginFlags, "--engine", "breakInfinity"]);
    expect(omitted._meta.effectiveEngine).toBe("number");
    expect(big._meta.effectiveEngine).toBe("breakInfinity");
    expect(explicit._meta.runId).toBe(omitted._meta.runId);
    expect(explicit._meta.seed).toBe(omitted._meta.seed);
    expect(big._meta.runId).not.toBe(omitted._meta.runId);
    expect(big._meta.seed).not.toBe(omitted._meta.seed);
    expect(runCliFailure([...args, ...pluginFlags, "--engine", "breakEternity"]).stderr).toContain("experimental");
  }
}, 240_000);
