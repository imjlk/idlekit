import { afterEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBalanceFixture } from "../testkit/balanceFixture";
import { parseCsv, stringifyCsv } from "../balance/sheet";
import { runCli } from "../testkit/bun";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

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
