import { afterEach, expect, it } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBalanceFixture } from "../testkit/balanceFixture";
import { parseCsv, stringifyCsv } from "../balance/sheet";
import { REPO_ROOT, runCli, runCliJson } from "../testkit/bun";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("seeded synthetic rewards replay every exported variant without sharing random state across trials", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "idlekit-balance-seeded-"));
  roots.push(root);
  const directory = resolve(root, "fixture");
  const { config, flags } = await createBalanceFixture(directory, { seededRewards: true });
  const workflow = {
    ...config, exportVariants: true,
    pacing: { ...config.pacing, seeds: [19, 7], targets: [{ metric: "wallet", unit: "TOKEN", min: 0 }], sensitivity: [{ path: "machine.alpha.cost", values: [3] }] },
    metrics: [{ id: "wallet", kind: "endWallet" }],
  };
  await writeFile(resolve(directory, "workflow.json"), JSON.stringify(workflow));
  const plugin = ["--allow-plugin", "true", "--plugin", flags.plugin, "--plugin-root", directory];
  const call = (args: string[]) => runCliJson([...args, ...plugin], { cwd: root });
  const first = call(["balance", resolve(directory, "workflow.json")]);
  expect(first.outcome.ok).toBe(true);
  const report = JSON.parse(await readFile(resolve(first.generationPath, "results.json"), "utf8"));
  const index = JSON.parse(await readFile(resolve(first.generationPath, "variants.json"), "utf8"));
  expect(report.seeds).toEqual([7, 19]);
  expect(new Set(report.runs.slice(0, 2).map((entry: any) => entry.results[0].value)).size).toBe(2);
  for (const entry of report.runs) {
    const exported = index.variants.find((variant: { id: string }) => variant.id === entry.run.variantId);
    const replay = call(["simulate", resolve(first.generationPath, exported.scenario), "--seed", String(entry.run.seed), "--engine", "number", "--format", "json"]);
    expect(Number(replay.endMoney)).toBe(entry.results[0].value);
  }
  workflow.pacing.seeds.reverse();
  await writeFile(resolve(directory, "workflow.json"), JSON.stringify(workflow));
  const repeated = call(["balance", resolve(directory, "workflow.json")]);
  expect(JSON.parse(await readFile(resolve(repeated.generationPath, "results.json"), "utf8"))).toEqual(report);
}, 180_000);

it("public CSV outputs compose with simulation, comparison, strategy tuning, and offline sessions outside the checkout", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "idlekit-balance-consumer-"));
  roots.push(root);
  await cp(resolve(REPO_ROOT, "examples/balance/linear"), root, { recursive: true });
  const call = (args: string[]) => runCliJson(args, { cwd: root });
  const bundle = call(["balance", "workflow.json"]);
  expect(bundle.outcome.ok).toBe(true);
  const generation = bundle.generationPath;
  const index = JSON.parse(await readFile(resolve(generation, "variants.json"), "utf8"));
  expect(index.variants.map((entry: { id: string }) => entry.id)).toEqual(["baseline", "buyCostGrowth=1.05", "buyCostGrowth=1.25"]);
  const baseline = resolve(generation, index.variants[0].scenario);
  const variant = resolve(generation, index.variants[1].scenario);
  const report = JSON.parse(await readFile(resolve(generation, "results.json"), "utf8"));
  // The stock linear model is deterministic; a repeated seed is not an uncertainty estimate.
  expect(report.runs[0].results).toEqual(report.runs[1].results);
  const replay = call(["simulate", baseline, "--engine", "number", "--seed", "7", "--format", "json"]);
  expect(Number(replay.endNetWorth)).toBe(report.runs[0].results[0].value);

  const compared = call(["compare", baseline, variant, "--metric", "endNetWorth", "--seed", "7", "--format", "json"]);
  expect(compared.metric).toBe("endNetWorth");
  expect(compared.better).toBe("b");

  // Compare honors each scenario's strategy. A shared --strategy flag would replace both.
  const waiting = JSON.parse(await readFile(baseline, "utf8"));
  waiting.strategy = { id: "scripted", params: { schemaVersion: 1, program: [], loop: false } };
  await writeFile(resolve(root, "waiting.json"), JSON.stringify(waiting));
  const strategies = call(["compare", baseline, "waiting.json", "--metric", "endNetWorth", "--seed", "7", "--format", "json"]);
  expect(strategies.better).toBe("a");

  const tuned = call(["tune", baseline, "--tune", "tune.json", "--format", "json"]);
  expect(tuned.ok).toBe(true);
  expect(Number.isFinite(tuned.report.best.score)).toBe(true);
  expect(["maximizeIncome", "minPayback", "maximizeNetWorth"]).toContain(tuned.report.best.params.objective);

  const experienced = call(["experience", baseline, "--session-pattern", "offline-heavy", "--days", "1", "--draws", "1", "--seed", "7", "--format", "json"]);
  expect(experienced.session).toMatchObject({ elapsedSec: 86400, activeSec: 300, offlineElapsedSec: 86100, offlineCreditedSec: 3600, lostRewardSec: 82500, stopReason: "horizon" });
  // Separate analyses neither mutate nor silently join the balance publication.
  expect(call(["balance", "workflow.json", "--check", "true"]).state).toBe("current");
}, 180_000);

it("balance CLI refreshes, checks without writing, and exits nonzero for stale/breached targets", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "idlekit-balance-cli-"));
  roots.push(root);
  const directory = resolve(root, "sheet");
  const { config, flags } = await createBalanceFixture(directory);
  config.pacing.sensitivity = [];
  const configPath = resolve(directory, "workflow.json");
  await writeFile(configPath, JSON.stringify(config));
  const args = ["balance", configPath, "--allow-plugin", "true", "--plugin", flags.plugin, "--plugin-root", directory];
  const output = runCli(args);
  expect(JSON.parse(output.stdout).outcome.ok).toBe(true);
  const pointer = resolve(directory, "results/current.json");
  const before = await readFile(pointer, "utf8");
  const checked = runCli([...args, "--check", "true"]);
  expect(JSON.parse(checked.stdout).state).toBe("current");
  expect(await readFile(pointer, "utf8")).toBe(before);
  const path = resolve(directory, "parameters.csv");
  const rows = parseCsv(await readFile(path, "utf8"));
  rows.find((row) => row[0] === "machine.alpha.cost")![1] = "60";
  await writeFile(path, stringifyCsv(rows));
  const stale = runCli([...args, "--check", "true"], { check: false });
  expect(stale.exitCode).toBe(1);
  expect(JSON.parse(stale.stdout).state).toBe("stale");
  expect(await readFile(pointer, "utf8")).toBe(before);
  const breached = runCli(args, { check: false });
  expect(breached.exitCode).toBe(1);
  expect(JSON.parse(breached.stdout).outcome.ok).toBe(false);
}, 90_000);
