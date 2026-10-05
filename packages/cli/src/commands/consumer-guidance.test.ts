import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, runCliFailure, writeText } from "../testkit/bun";

describe("consumer CLI guidance", () => {
  let dir = "";
  let path = "";
  beforeAll(async () => {
    dir = await createTempDir("idlekit-consumer-guidance");
    path = resolve(dir, "flat.json");
    const scenario = JSON.parse(await readText("../../examples/tutorials/01-cafe-baseline.json"));
    scenario.model.params = { incomePerSec: "2", buyCostBase: "10", buyCostGrowth: 1, buyIncomeDelta: "3" };
    scenario.initial.wallet.amount = "100";
    scenario.clock = { stepSec: 60, durationSec: 60 };
    scenario.strategy = { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 1 }], loop: false } };
    await writeText(path, JSON.stringify(scenario));
  });
  afterAll(async () => { await removePath(dir); });

  for (const args of [["simulate", "--help"], ["init", "scenario", "--help"]]) {
    it(`shows ${args.join(" ")} without executing a handler`, () => {
      const result = runCli(args);
      expect(result.stdout).toContain("Options:");
      expect(result.stderr).not.toContain("CLI_USAGE");
    });
  }
  it("renders evaluate as Markdown with labeled asset values and conversion assumptions", () => {
    const result = runCli(["evaluate", path, "--days", "1", "--horizons", "10s", "--step", "60", "--format", "md"]);
    expect(result.stdout.startsWith("# Evaluate Report\n")).toBeTrue();
    expect(result.stdout).toContain("End net worth (COIN)");
    expect(result.stdout).toContain("10s");
    expect(result.stdout).toContain("exchange rate");
    expect(result.stdout).toContain("retention");
    expect(result.stdout).toContain("Modeled LTV/user");
    expect(result.stdout).not.toContain("```json");
  });
  it("names an output path that cannot be written", async () => {
    const blocked = resolve(dir, "file.json");
    await writeText(blocked, "existing file");
    const result = runCliFailure(["simulate", path, "--out", resolve(blocked, "result.json"), "--format", "json"]);
    expect(result.stderr).toContain("[OUTPUT_WRITE_FAILED]");
    expect(result.stderr).toContain(resolve(blocked, "result.json"));
    expect(result.stderr).toContain("writable");
  });
});
