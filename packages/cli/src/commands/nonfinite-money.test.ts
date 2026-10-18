import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createTempDir, removePath, runCli, runCliFailure, runCliJson, writeText } from "../testkit/bun";

let dir = "", a = "", b = "", eta = "", reachThenOverflow = "", tune = "";
let flags: string[] = [];
beforeAll(async () => {
  dir = await createTempDir("idlekit-nonfinite-money");
  const plugin = resolve(dir, "model.mjs");
  await writeText(plugin, `export const models = [{ id: "overflow", version: 1, create: p => ({
    id: "overflow", version: 1, actions: () => [], income: ctx => ({ unit: ctx.unit, amount: ctx.E.zero() }),
    netWorth: (ctx, state) => ({ unit: ctx.unit, amount: p.large || (p.late && state.t > 1)
      ? ctx.E.mulN(ctx.E.from("1e200"), ctx.E.from("1e200")) : ctx.E.from("1e100") }),
  }) }];`);
  flags = ["--plugin", plugin, "--allow-plugin", "true"];
  const scenario = (params: { large?: boolean; late?: boolean }, durationSec = 1) => ({ schemaVersion: 1, unit: { code: "MANA" },
    policy: { mode: "drop" }, model: { id: "overflow", version: 1, params },
    initial: { wallet: { unit: "MANA", amount: "1" } }, clock: { stepSec: 1, durationSec } });
  a = resolve(dir, "a.json"); b = resolve(dir, "b.json"); eta = resolve(dir, "eta.json"); tune = resolve(dir, "tune.json");
  await writeText(a, JSON.stringify(scenario({ large: true })));
  await writeText(b, JSON.stringify(scenario({})));
  await writeText(eta, JSON.stringify(scenario({ late: true })));
  reachThenOverflow = resolve(dir, "reach-then-overflow.json");
  // Net worth is 1e100 until t=1 and overflows Number afterwards, inside this 3-second economy run.
  await writeText(reachThenOverflow, JSON.stringify(scenario({ late: true }, 3)));
  await writeText(tune, JSON.stringify({ schemaVersion: 1,
    strategy: { id: "greedy", baseParams: { schemaVersion: 1, objective: "maximizeIncome" },
      space: [{ path: "objective", space: { kind: "choice", values: ["maximizeIncome", "minPayback"] } }] },
    objective: { id: "endNetWorthLog10" }, runner: { seeds: [1], budget: 1, overrideDurationSec: 1, topK: 1 },
  }));
});
afterAll(async () => { await removePath(dir); });

test("compare rejects overflow from a plugin instead of selecting it as the winner", () => {
  expect(runCliFailure(["compare", a, b, ...flags, "--metric", "endNetWorth"]).stderr).toMatch(/finite/i);
  const result = runCliJson(["compare", a, b, ...flags, "--metric", "endNetWorth", "--engine", "breakInfinity"]);
  expect(result.better).toBe("a");
  expect(result.measured.a.endNetWorth).toBe("1e+400");
}, 180_000);

test("ETA rejects overflow encountered only in its longer measurement", () => {
  expect(runCliFailure(["compare", eta, b, ...flags, "--metric", "etaToTargetWorth", "--target-worth", "1e200",
    "--max-duration", "3"]).stderr).toMatch(/finite/i);
  const result = runCliJson(["compare", b, b, ...flags, "--metric", "etaToTargetWorth", "--target-worth", "1e200", "--max-duration", "3"]);
  expect(result.better).toBe("tie");
  expect(result.measured.a.etaToTargetWorth).toBe("unreached");
}, 180_000);

test("ETA reached before a later economy overflow keeps its contract; end metrics still fail", () => {
  const result = runCliJson(["compare", reachThenOverflow, b, ...flags, "--metric", "etaToTargetWorth",
    "--target-worth", "1e100", "--max-duration", "3"]);
  expect(result.better).toBe("tie");
  expect(result.measured.a.etaToTargetWorth).toBe("0");
  expect(result.measured.a.endNetWorth).toBe("Infinity");
  expect(result.insights.drivers.map((driver: { key: string }) => driver.key)).not.toContain("endNetWorth");
  for (const metric of ["endNetWorth", "endMoney"]) {
    const args = ["compare", reachThenOverflow, b, ...flags, "--metric", metric];
    if (metric === "endNetWorth") expect(runCliFailure(args).stderr).toMatch(/finite/i);
    else expect(runCliJson(args).better).toBe("tie");
  }
  const markdown = runCli(["compare", reachThenOverflow, b, ...flags, "--metric", "droppedRate", "--format", "md"]);
  expect(markdown.exitCode).toBe(0);
  expect(markdown.stdout).toContain("left the selected engine's finite range");
}, 180_000);

test("tune rejects overflow instead of reporting a successful -300 score", () => {
  expect(runCliFailure(["tune", a, "--tune", tune, ...flags]).stderr).toMatch(/finite/i);
  const result = runCliJson(["tune", a, "--tune", tune, ...flags, "--engine", "breakInfinity"]);
  expect(result.ok).toBe(true);
  expect(result.report.best.score).toBe(400);
}, 180_000);
