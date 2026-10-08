import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportSheetCsv, type SheetSchema } from "../balance/sheet";

/** Tiny synthetic contract fixture. No production game design or balance data. */
export async function createBalanceFixture(destination: string, options: { seededRewards?: boolean } = {}) {
  const template = {
    schemaVersion: 1,
    unit: { code: "TOKEN" },
    policy: { mode: "accumulate", maxLogGap: 14 },
    model: { id: "sheet-fixture", version: 1, params: {
      rate: 2, startBalance: 0, awayCap: 120,
      machines: [{ id: "alpha", cost: 6 }, { id: "beta", cost: 11 }],
    } },
    initial: { t: 0, wallet: { unit: "TOKEN", amount: "0" }, vars: { count: 0 } },
    clock: { stepSec: 1, durationSec: 60 },
    strategy: { id: "fixture.buy" },
    sim: { offline: { maxSec: 120, overflowPolicy: "clamp", actions: { mode: "none" } } },
  };
  const schema: SheetSchema = { version: 1, fields: [
    { id: "rate", path: "/model/params/rate", type: "number", unit: "TOKEN/second", min: 0 },
    { id: "machine.alpha.cost", path: "/model/params/machines/0/cost", parentId: "alpha", type: "number", unit: "TOKEN", min: 1 },
    { id: "startBalance", path: "/model/params/startBalance", type: "number", unit: "TOKEN", min: 0 },
    { id: "awayCap", path: "/model/params/awayCap", type: "integer", unit: "seconds", min: 0 },
  ] };
  const config = {
    version: 1, sheet: "parameters.csv", schema: "schema.json", scenario: "scenario-template.json", outputDir: "results",
    bindings: [
      { field: "startBalance", path: "initial.wallet.amount" },
      { field: "awayCap", path: "sim.offline.maxSec" },
    ],
    pacing: {
      horizonSec: 60, seeds: [7], strategy: "fixture.buy",
      targets: [{ metric: "firstMachineSec", unit: "seconds", min: 2, max: 4 }],
      sensitivity: [] as { path: string; values: number[] }[],
      limits: { maxRuns: 10, maxResults: 20, maxHorizonSec: 600 },
    },
    metrics: [{ id: "firstMachineSec", kind: "firstAction", actionId: "buy.machine" }],
  };
  const pluginSource = `export const models = [{
    id: "sheet-fixture", version: 1,
    create(p) {
      let randomState;
      function reward(seed) {
        randomState ??= seed ?? 1;
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        return (randomState >>> 0) % 7;
      }
      return {
      id: "sheet-fixture", version: 1,
      income(ctx, state) { return { unit: ctx.unit, amount: p.rate * (1 + state.vars.count) }; },
      netWorth(ctx, state) { return { unit: ctx.unit, amount: state.wallet.money.amount + p.machines[0].cost * state.vars.count }; },
      actions(ctx) { return [{
        id: "buy.machine", kind: "buy", actor: "automation", canApply: () => true,
        cost: () => ({ unit: ctx.unit, amount: p.machines[0].cost }),
        apply(ctx, state) { return {
          ...state, vars: { ...state.vars, count: state.vars.count + 1 },
          wallet: { ...state.wallet, money: { ...state.wallet.money, amount: state.wallet.money.amount + ${options.seededRewards ? "reward(ctx.seed)" : "0"} } }
        }; }
      }]; }
    }; }
  }];
  export const strategies = [{ id: "fixture.buy", create() { return {
    id: "fixture.buy", decide(ctx, model, state) {
      const action = model.actions(ctx, state)[0];
      return action && action.cost(ctx, state).amount <= state.wallet.money.amount ? [{ action }] : [];
    }
  }; } }];\n`;
  await mkdir(destination);
  for (const [name, text] of Object.entries({
    "parameters.csv": exportSheetCsv(template, schema),
    "schema.json": JSON.stringify(schema, null, 2),
    "scenario-template.json": JSON.stringify(template, null, 2),
    "workflow.json": JSON.stringify(config, null, 2),
    "plugin.ts": pluginSource,
  })) await writeFile(resolve(destination, name), text, { flag: "wx" });
  const flags = {
    plugin: resolve(destination, "plugin.ts"), "allow-plugin": true,
    "plugin-root": destination, "plugin-sha256": "", "plugin-trust-file": "",
  };
  return { config, schema, template, flags };
}
