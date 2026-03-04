import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../../engine/breakInfinity";
import { createObjectiveRegistry } from "./registry";
import { runCandidateAndScore } from "./runner";
import { createStrategyRegistry, type StrategyFactory } from "../registry";
import type { CompiledScenario } from "../../types";

class Bag {
  counter = 0;

  bump(): void {
    this.counter += 1;
  }
}

function makeScenario(): CompiledScenario<number, "COIN", Bag> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };
  const action = {
    id: "act.bump",
    kind: "custom" as const,
    canApply: () => true,
    cost: () => null,
    apply: (_ctx: any, state: any) => {
      state.vars.bump();
      return state;
    },
  };

  return {
    ctx: {
      E,
      unit,
      tickPolicy: { mode: "drop" },
      stepSec: 1,
    },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: 0 }),
      actions: () => [action],
    },
    initial: {
      t: 0,
      wallet: {
        money: { unit, amount: 0 },
        bucket: 0,
      },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: new Bag(),
    },
    run: {
      stepSec: 1,
      durationSec: 1,
    },
    strategy: undefined,
  };
}

describe("runCandidateAndScore", () => {
  it("injects seed into ctx for each run", () => {
    const scenario = makeScenario();
    const strategyRegistry = createStrategyRegistry([
      {
        id: "s",
        create: () => ({
          id: "s",
          decide: (ctx: any, model: any, state: any) => {
            const a = model.actions(ctx, state)[0];
            return a ? [{ action: a }] : [];
          },
        }),
      } satisfies StrategyFactory,
    ]);
    const objectiveRegistry = createObjectiveRegistry([
      {
        id: "obj.seed",
        create: () => ({
          id: "obj.seed",
          score: ({ scenario: sc }) => Number(sc.ctx.seed ?? -1),
        }),
      },
    ]);

    const out = runCandidateAndScore({
      baseScenario: scenario,
      params: {},
      strategyId: "s",
      objectiveId: "obj.seed",
      seeds: [7, 11],
      strategyRegistry,
      objectiveRegistry,
    });

    expect(out.seedScores).toEqual([7, 11]);
    expect(out.score).toBe(9);
    expect(out.seedResults.map((x) => x.seed)).toEqual([7, 11]);
    expect(out.seedResults.every((x) => !Number.isNaN(x.endMoneyLog10))).toBeTrue();
  });

  it("clones initial state per seed while preserving class prototype", () => {
    const scenario = makeScenario();
    const strategyRegistry = createStrategyRegistry([
      {
        id: "s",
        create: () => ({
          id: "s",
          decide: (ctx: any, model: any, state: any) => {
            const a = model.actions(ctx, state)[0];
            return a ? [{ action: a }] : [];
          },
        }),
      } satisfies StrategyFactory,
    ]);
    const objectiveRegistry = createObjectiveRegistry([
      {
        id: "obj.count",
        create: () => ({
          id: "obj.count",
          score: ({ run }) => Number((run.end.vars as Bag).counter),
        }),
      },
    ]);

    const out = runCandidateAndScore({
      baseScenario: scenario,
      params: {},
      strategyId: "s",
      objectiveId: "obj.count",
      seeds: [1, 2],
      strategyRegistry,
      objectiveRegistry,
    });

    expect(out.seedScores).toEqual([1, 1]);
    expect(out.score).toBe(1);
    expect(out.seedResults.length).toBe(2);
    expect(out.seedResults[0]?.actionsApplied).toBe(1);
    expect(scenario.initial.vars.counter).toBe(0);
    expect(scenario.initial.vars).toBeInstanceOf(Bag);
  });

  it("disables event retention for tuning runs", () => {
    const scenario = makeScenario();
    const strategyRegistry = createStrategyRegistry([
      {
        id: "s",
        create: () => ({
          id: "s",
          decide: (ctx: any, model: any, state: any) => {
            const a = model.actions(ctx, state)[0];
            return a ? [{ action: a }] : [];
          },
        }),
      } satisfies StrategyFactory,
    ]);
    const objectiveRegistry = createObjectiveRegistry([
      {
        id: "obj.events",
        create: () => ({
          id: "obj.events",
          score: ({ run }) => run.events.length,
        }),
      },
    ]);

    const out = runCandidateAndScore({
      baseScenario: scenario,
      params: {},
      strategyId: "s",
      objectiveId: "obj.events",
      seeds: [1],
      strategyRegistry,
      objectiveRegistry,
    });

    expect(out.seedScores).toEqual([0]);
  });
});
