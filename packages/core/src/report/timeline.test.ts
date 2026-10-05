import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import { compileScenario } from "../scenario/compile";
import { createModelRegistry, type ModelFactory } from "../scenario/registry";
import { runScenario } from "../sim/simulator";
import { builtinStrategyFactories } from "../sim/strategy/builtins";
import { createStrategyRegistry } from "../sim/strategy/registry";
import { buildTimeline } from "./timeline";

function purchasedRun(E: any) {
  const factory: ModelFactory = {
    id: "retained-generator", version: 1,
    create: () => ({
      id: "retained-generator", version: 1,
      income: (ctx: any, state: any) => ({ unit: ctx.unit, amount: ctx.E.from(2 + 3 * state.vars.owned) }),
      actions: (ctx: any) => [{
        id: "buy.generator", kind: "buy" as const,
        canApply: () => true,
        cost: () => ({ unit: ctx.unit, amount: ctx.E.from(10) }),
        apply: (_ctx: any, state: any) => ({ ...state, vars: { owned: state.vars.owned + 1 } }),
      }],
      netWorth: (ctx: any, state: any) => ({ unit: ctx.unit, amount: ctx.E.add(state.wallet.money.amount, ctx.E.from(10 * state.vars.owned)) }),
    }),
  };
  const scenario = compileScenario({
    E,
    registry: createModelRegistry([factory]),
    strategyRegistry: createStrategyRegistry(builtinStrategyFactories),
    scenario: {
      schemaVersion: 1, unit: { code: "COIN" }, policy: { mode: "accumulate" },
      model: { id: factory.id, version: 1 }, initial: { wallet: { unit: "COIN", amount: "100" }, vars: { owned: 0 } },
      clock: { stepSec: 1, durationSec: 10 },
      strategy: { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "buy.generator", bulkSize: 1 }], loop: false } },
    },
  });
  return { scenario, run: runScenario({ ...scenario, run: { ...scenario.run, trace: { everySteps: 1 } } }) };
}

describe("timeline net worth", () => {
  for (const [name, createEngine] of [["number", createNumberEngine], ["breakInfinity", createBreakInfinityEngine]] as const) {
    it(`values the holdings of each selected snapshot (${name})`, () => {
      const E = createEngine();
      const { scenario, run } = purchasedRun(E);
      const timeline = buildTimeline({
        run, checkpointsSec: [0, 1, 10],
        formatMoney: (amount) => E.toString(amount), formatNetWorth: (amount) => E.toString(amount),
        getNetWorth: (state) => scenario.model.netWorth!(scenario.ctx, state).amount,
      });
      expect(timeline.map((point) => point.money)).toEqual(["100", "95", "140"]);
      expect(timeline.map((point) => point.netWorth)).toEqual(["100", "105", "150"]);
    });
    it(`uses current wallet as the no-valuation fallback (${name})`, () => {
      const E = createEngine();
      const { run } = purchasedRun(E);
      const timeline = buildTimeline({ run, checkpointsSec: [0, 1, 10], formatMoney: (amount) => E.toString(amount), formatNetWorth: (amount) => E.toString(amount) });
      expect(timeline.map((point) => point.money)).toEqual(["100", "95", "140"]);
      expect(timeline.map((point) => point.netWorth)).toEqual(["100", "95", "140"]);
    });
  }
});
