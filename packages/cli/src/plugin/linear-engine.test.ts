import { describe, expect, it } from "bun:test";
import { compileScenario, createBreakInfinityEngine, createNumberEngine, runCandidateAndScore, runScenario, type ScenarioV1 } from "@idlekit/core";
import { loadRegistries } from "./load";

const registries = await loadRegistries();
function input(bulkSize: number, scale = ""): any {
  const amount = (n: number) => `${n}${scale}`;
  return { schemaVersion: 1, unit: { code: "COIN" }, policy: { mode: "accumulate" },
    model: { id: "linear", version: 1, params: { incomePerSec: amount(2), buyCostBase: amount(10), buyCostGrowth: 1, buyIncomeDelta: amount(3) } },
    initial: { t: 0, wallet: { unit: "COIN", amount: amount(100) }, vars: { owned: 0 }, prestige: { count: 0, points: "0", multiplier: "1" } },
    clock: { durationSec: 10, stepSec: 1 },
    strategy: { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize }], loop: false } },
  };
}
function compile(E: any, scenario: ScenarioV1): any {
  return compileScenario({ E, scenario, registry: registries.modelRegistry, strategyRegistry: registries.strategyRegistry });
}

describe("linear engine arithmetic", () => {
  for (const [bulk, money, worth] of [[1, 140, 150], [10, 320, 420]] as const) {
    it(`preserves the independent ${bulk}-buy baseline in both engines`, () => {
      for (const E of [createNumberEngine(), createBreakInfinityEngine()]) {
        const scenario = compile(E, input(bulk));
        const run: any = runScenario(scenario);
        expect(E.toNumber(run.end.wallet.money.amount)).toBeCloseTo(money, 8);
        expect(E.toNumber(scenario.model.netWorth(scenario.ctx, run.end).amount)).toBeCloseTo(worth, 8);
      }
    });
    it(`keeps ${bulk}-buy costs, income and net worth finite above Number range`, () => {
      const E = createBreakInfinityEngine();
      const scenario = compile(E, input(bulk, "e400"));
      const run: any = runScenario(scenario);
      const netWorth = scenario.model.netWorth(scenario.ctx, run.end).amount;
      expect(E.isFinite(run.end.wallet.money.amount)).toBeTrue();
      expect(E.isFinite(netWorth)).toBeTrue();
      expect(E.absLog10(run.end.wallet.money.amount)).toBeCloseTo(400 + Math.log10(money), 8);
      expect(E.absLog10(netWorth)).toBeCloseTo(400 + Math.log10(worth), 8);
      expect(run.end.vars.owned).toBe(bulk);
    });
  }

  it("computes exponential inventory worth without overflowing an intermediate Number", () => {
    const E = createBreakInfinityEngine();
    const raw = input(1, "e400");
    raw.initial.vars = { owned: 10000 };
    raw.model.params = { incomePerSec: "2", buyCostBase: "1e400", buyCostGrowth: 1.15, buyIncomeDelta: "3" };
    raw.strategy = { id: "scripted", params: { schemaVersion: 1, program: [], loop: false } };
    const scenario = compile(E, raw);
    const run: any = runScenario(scenario);
    const netWorth = scenario.model.netWorth(scenario.ctx, run.end).amount;
    const expectedLog = 400 + 10000 * Math.log10(1.15) - Math.log10(0.15);
    expect(E.isFinite(netWorth)).toBeTrue();
    expect(E.absLog10(netWorth)).toBeCloseTo(expectedLog, 8);
    const action = scenario.model.actions(scenario.ctx, run.end)[0];
    expect(E.absLog10(action.cost(scenario.ctx, run.end).amount)).toBeCloseTo(400 + 10000 * Math.log10(1.15), 8);
    const quote = action.bulk(scenario.ctx, run.end).find((q: any) => q.size === 10);
    expect(E.isFinite(quote.cost.amount)).toBeTrue();
    expect(E.absLog10(quote.cost.amount)).toBeCloseTo(400 + 10000 * Math.log10(1.15) + Math.log10((1.15 ** 10 - 1) / .15), 8);
  });

  it("keeps tuning rankings sensitive to generator purchases in a huge flat economy", () => {
    const E = createBreakInfinityEngine();
    const raw = input(1, "e400");
    const baseScenario = compile(E, raw);
    const scores = [1, 10].map((bulkSize) => runCandidateAndScore({
      baseScenario, params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize }], loop: false },
      strategyId: "scripted", objectiveId: "endNetWorthLog10", seeds: [1, 2],
      strategyRegistry: registries.strategyRegistry, objectiveRegistry: registries.objectiveRegistry,
    }));
    expect(scores[0]!.score).toBeCloseTo(400 + Math.log10(150), 8);
    expect(scores[1]!.score).toBeCloseTo(400 + Math.log10(420), 8);
    expect(scores[1]!.score).toBeGreaterThan(scores[0]!.score);
  });

  it("rejects non-numeric amount strings instead of a Decimal sentinel", () => {
    const raw = input(1); raw.model.params.incomePerSec = "Infinity";
    expect(() => { const sc = compile(createBreakInfinityEngine(), raw); runScenario(sc); }).toThrow("decimal or scientific amount");
  });

  it("rejects Number overflow with guidance to select breakInfinity", () => {
    expect(() => { const sc = compile(createNumberEngine(), input(1, "e400")); runScenario(sc); })
      .toThrow("breakInfinity");
  });
  it("rejects overflow from bounded Number inputs rather than returning a successful Infinity result", () => {
    const raw = input(1); raw.initial.wallet.amount = "1e308";
    raw.model.params = { incomePerSec: "1e308", buyCostBase: "10", buyCostGrowth: 1, buyIncomeDelta: "3" };
    const sc = compile(createNumberEngine(), raw);
    expect(() => { const run = runScenario(sc); sc.model.netWorth(sc.ctx, run.end); }).toThrow("breakInfinity");
  });
});
