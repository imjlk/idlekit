import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCli, writeText } from "../testkit/bun";

describe("report timeline valuation", () => {
  let dir = "";
  let path = "";
  beforeAll(async () => {
    dir = await createTempDir("idlekit-report-timeline");
    path = resolve(dir, "flat.json");
    const scenario = JSON.parse(await readText("../../examples/tutorials/01-cafe-baseline.json"));
    scenario.model.params = { incomePerSec: "2", buyCostBase: "10", buyCostGrowth: 1, buyIncomeDelta: "3" };
    scenario.initial.wallet.amount = "100";
    scenario.clock = { stepSec: 1, durationSec: 10 };
    scenario.strategy = { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 1 }], loop: false } };
    await writeText(path, JSON.stringify(scenario));
  });
  afterAll(async () => { await removePath(dir); });

  it("values retained generators at each checkpoint instead of historical peak money", () => {
    const result = JSON.parse(runCli(["report", path, "--checkpoints", "0,1,10", "--format", "json"]).stdout);
    // Buy at t=0: wallet 100-10, then income 5/s; the retained generator is worth 10.
    expect(result.timeline.map((point: any) => point.money)).toEqual(["100 COIN", "95 COIN", "140 COIN"]);
    expect(result.timeline.map((point: any) => point.netWorth)).toEqual(["100 COIN", "105 COIN", "150 COIN"]);
  });
});
