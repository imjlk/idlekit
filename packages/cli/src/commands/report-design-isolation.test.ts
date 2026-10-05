import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readText, removePath, runCliJson, writeText } from "../testkit/bun";

const KEY = "action.buy.generator.firstApplied";
const PLUGIN = `export const strategies = [{ id: "plugin.once", create: () => {
  let used = false;
  return { id: "plugin.once", decide(ctx, model, state) {
    if (used) return []; used = true;
    const action = model.actions(ctx, state)[0];
    return action ? [{ action, bulkSize: 1 }] : [];
  } };
} }];
export const models = [{ id: "plugin.once", version: 1, create: () => {
  let bought = false;
  return { id: "plugin.once", version: 1,
    income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(2) }),
    actions: () => bought ? [] : [{ id: "buy.generator", kind: "buy", canApply: () => true,
      cost: () => null, apply: (_ctx, state) => { bought = true; return state; } }],
  };
} }];`;

describe("report and tuning design isolation", () => {
  let dir = "";
  const paths: Record<string, string> = {};
  let flags: string[];
  let scriptedParams: any;
  beforeAll(async () => {
    dir = await createTempDir("idlekit-report-design-isolation");
    const scenario = JSON.parse(await readText("../../examples/tutorials/01-cafe-baseline.json"));
    scenario.initial.wallet.amount = "100";
    scenario.model.params = { incomePerSec: "2", buyCostBase: "10", buyCostGrowth: 1, buyIncomeDelta: "3" };
    scenario.clock = { stepSec: 60, durationSec: 60 };
    scriptedParams = { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 1 }], loop: false };
    scenario.strategy = { id: "scripted", params: scriptedParams };
    const plugin = resolve(dir, "once.mjs");
    await writeText(plugin, PLUGIN);
    flags = ["--plugin", plugin, "--allow-plugin", "true"];
    for (const source of ["scripted", "strategy", "model"]) {
      paths[source] = resolve(dir, `${source}.json`);
      const input = { ...scenario,
        ...(source === "strategy" ? { strategy: { id: "plugin.once" } } : {}),
        ...(source === "model" ? { model: { id: "plugin.once", version: 1 } } : {}),
      };
      await writeText(paths[source]!, JSON.stringify(input));
    }
  });
  afterAll(async () => { await removePath(dir); });

  for (const source of ["scripted", "strategy", "model"]) {
    it(`report milestones match a fresh experience with a stateful ${source}`, () => {
      const session = ["--session-pattern", "offline-heavy", "--days", "1"];
      const fresh = runCliJson(["experience", paths[source]!, ...flags, ...session, "--draws", "1", "--format", "json"]);
      const report = runCliJson(["report", paths[source]!, ...flags, ...session,
        "--include-milestones", "true", "--include-perceived", "true", "--format", "json"]);
      expect(fresh.milestones.firstActionSec).toBe(0);
      expect(report.milestones).toEqual(fresh.milestones);
      expect(report.perceived).toEqual(fresh.perceived);
    });
  }

  for (const source of ["scripted", "strategy", "model"]) {
    for (const draws of [1, 3]) {
      it(`scores a fresh ${source} candidate across seeds and ${draws} design draw(s)`, async () => {
        const tunePath = resolve(dir, `tune-${source}-${draws}.json`);
        const strategy = source === "strategy"
          ? { id: "plugin.once", baseParams: {}, space: [{ path: "loop", space: { kind: "choice", values: [false] } }] }
          : { id: "scripted", baseParams: scriptedParams, space: [{ path: "loop", space: { kind: "choice", values: [false] } }] };
        const tune = { schemaVersion: 1, strategy,
          objective: { id: "timeToMilestoneNegSec", params: { milestoneKey: KEY, sessionPattern: "offline-heavy", days: 1, draws } },
          runner: { seeds: [1, 2], budget: 2, topK: 2 },
        };
        await writeText(tunePath, JSON.stringify(tune));
        const output = runCliJson(["tune", paths[source]!, ...flags, "--tune", tunePath, "--format", "json"]);
        expect(output.report.best.score).toBe(0);
        expect(output.report.best.seedScores).toEqual([0, 0]);
        expect(output.report.top.every((entry: any) => entry.score === 0)).toBeTrue();
      });
    }
  }

  for (const id of ["visibleProgressScore", "experienceBalancedLog10"]) {
    it(`${id} agrees with a fresh experience after the economy run`, async () => {
      const fresh = runCliJson(["experience", paths.scripted!, "--session-pattern", "offline-heavy", "--days", "1", "--draws", "1", "--format", "json"]);
      const p = fresh.perceived;
      const expected = Math.log10(p.visibleChangesPerMinute + 1) - Math.log10(p.maxNoRewardGapSec + 1)
        + (id === "visibleProgressScore" ? -Math.log10((p.avgPostPurchaseFeedbackSec ?? 0) + 1) : Math.log10(Number(fresh.end.netWorth)));
      const tunePath = resolve(dir, `${id}.json`);
      await writeText(tunePath, JSON.stringify({ schemaVersion: 1,
        strategy: { id: "scripted", baseParams: scriptedParams, space: [{ path: "loop", space: { kind: "choice", values: [false] } }] },
        objective: { id, params: { sessionPattern: "offline-heavy", days: 1, draws: 3 } },
        runner: { seeds: [1, 2], budget: 1, topK: 1 },
      }));
      const output = runCliJson(["tune", paths.scripted!, "--tune", tunePath, "--format", "json"]);
      expect(output.report.best.score).toBeCloseTo(expected, 10);
    });
  }
});
