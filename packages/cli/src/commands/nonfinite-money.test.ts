import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createTempDir, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

let dir = "", a = "", b = "", eta = "", tune = "";
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
  const scenario = (params: { large?: boolean; late?: boolean }) => ({ schemaVersion: 1, unit: { code: "MANA" },
    policy: { mode: "drop" }, model: { id: "overflow", version: 1, params },
    initial: { wallet: { unit: "MANA", amount: "1" } }, clock: { stepSec: 1, durationSec: 1 } });
  a = resolve(dir, "a.json"); b = resolve(dir, "b.json"); eta = resolve(dir, "eta.json"); tune = resolve(dir, "tune.json");
  await writeText(a, JSON.stringify(scenario({ large: true })));
  await writeText(b, JSON.stringify(scenario({})));
  await writeText(eta, JSON.stringify(scenario({ late: true })));
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

test("tune rejects overflow instead of reporting a successful -300 score", () => {
  expect(runCliFailure(["tune", a, "--tune", tune, ...flags]).stderr).toMatch(/finite/i);
  const result = runCliJson(["tune", a, "--tune", tune, ...flags, "--engine", "breakInfinity"]);
  expect(result.ok).toBe(true);
  expect(result.report.best.score).toBe(400);
}, 180_000);
