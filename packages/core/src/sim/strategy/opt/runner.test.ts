import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../../engine/breakInfinity";
import { builtinObjectiveFactories } from "./objectives/builtins";
import { createObjectiveRegistry } from "./registry";
import { runCandidateAndScore } from "./runner";
import { runScenario } from "../../simulator";
import { createModelRegistry } from "../../../scenario/registry";
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

  it("keeps missing counters missing when observation is off", () => {
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
      ...builtinObjectiveFactories,
      {
        id: "obj.count",
        create: () => ({
          id: "obj.count",
          score: ({ run }) => Number((run.end.vars as Bag).counter),
        }),
      },
    ]);
    const tune = (objectiveId: string, enabled: boolean) =>
      runCandidateAndScore({
        baseScenario: { ...scenario, run: { ...scenario.run, observation: { enabled } } },
        params: {},
        strategyId: "s",
        objectiveId,
        seeds: [1],
        strategyRegistry,
        objectiveRegistry,
      });

    const observed = tune("obj.count", true);
    expect(observed.seedResults[0]).toMatchObject({ droppedRate: 0, actionsApplied: 1 });
    expect(Number.isFinite(tune("pacingBalancedLog10", true).score)).toBeTrue();

    const off = tune("obj.count", false);
    expect(off.seedResults[0]).toMatchObject({ droppedRate: null, actionsApplied: null });
    expect(() => tune("pacingBalancedLog10", false)).toThrow(
      "pacingBalancedLog10 needs observed money and action counters, but this run has none (run.observation.enabled is false)",
    );
  });

  it("rejects a seed run that maxSteps cut before durationSec", () => {
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

    expect(() =>
      runCandidateAndScore({
        baseScenario: { ...scenario, run: { ...scenario.run, maxSteps: 3 } },
        params: {},
        strategyId: "s",
        objectiveId: "obj.count",
        seeds: [1],
        overrides: { durationSec: 10 },
        strategyRegistry,
        objectiveRegistry,
      }),
    ).toThrow("runCandidateAndScore exceeded maxSteps (3)");
  });
});

describe("builtin objectives over a large start t", () => {
  // 100 moves t=1e18 by 128, so `end.t - start.t` reads 1280 for a 1000 second run.
  it.each(builtinObjectiveFactories.map((factory) => factory.id))("%p scores simulated seconds", (objectiveId) => {
    const base = makeScenario();
    const unit = base.ctx.unit;
    const scenarioAt = (t: number): CompiledScenario<number, "COIN", Bag> => ({
      ...base,
      ctx: { ...base.ctx, stepSec: 100 },
      model: { ...base.model, income: () => ({ unit, amount: 1 }), actions: () => [] },
      initial: { ...base.initial, t },
      run: { stepSec: 100, durationSec: 1000 },
    });
    const strategyRegistry = createStrategyRegistry([
      { id: "idle", create: () => ({ id: "idle", decide: () => [] }) } satisfies StrategyFactory,
    ]);
    const objectiveRegistry = createObjectiveRegistry(builtinObjectiveFactories);
    const score = (t: number) =>
      runCandidateAndScore({
        baseScenario: scenarioAt(t),
        params: {},
        strategyId: "idle",
        objectiveId,
        objectiveParams: objectiveId === "etaToTargetWorthNegSec" ? { targetWorth: "500" } : undefined,
        seeds: [1],
        strategyRegistry,
        objectiveRegistry,
      });

    const near = score(0);
    const far = score(1e18);
    expect(far.seedResults[0]?.durationSec).toBe(1000);
    expect(far.score).toBeCloseTo(near.score, 9);
  });
});

describe("independent objective evaluation runs", () => {
  const idleFactory: StrategyFactory = { id: "idle", create: () => ({ id: "idle", decide: () => [] }) };
  const objectiveRegistry = createObjectiveRegistry([{ id: "money", create: () => ({ id: "money", score: ({ run }) => Number(run.end.wallet.money.amount) }) }]);

  it("refuses a declared stateful model without its factory before any run", () => {
    let ticks = 0;
    const base = makeScenario();
    const scenario: typeof base = { ...base, model: { ...base.model,
      income: (ctx) => { ticks++; return { unit: ctx.unit, amount: ticks }; },
    } };
    expect(() => runCandidateAndScore({ baseScenario: scenario, params: {}, strategyId: "idle", objectiveId: "money",
      seeds: [1, 2], strategyRegistry: createStrategyRegistry([idleFactory]), objectiveRegistry, statefulModel: true,
    } as Parameters<typeof runCandidateAndScore>[0])).toThrow("Run isolation is unavailable");
    expect(ticks).toBe(0);
  });

  it("rejects schema-invalid candidate params before constructing a strategy", () => {
    let creates = 0;
    const strategyRegistry = createStrategyRegistry([{ ...idleFactory,
      paramsSchema: { "~standard": { validate: () => ({ success: false, issues: [{ path: "threshold", message: "threshold must be positive" }] }) } },
      create: () => { creates++; return { id: "idle", decide: () => [] }; },
    }]);
    expect(() => runCandidateAndScore({ baseScenario: makeScenario(), params: { threshold: -1 }, strategyId: "idle", objectiveId: "money",
      seeds: [1, 2], strategyRegistry, objectiveRegistry,
    })).toThrow("Invalid strategy params: threshold must be positive");
    expect(creates).toBe(0);
  });

  it("rejects schema-invalid model params before constructing either factory", () => {
    let creates = 0;
    const modelRegistry = createModelRegistry([{ id: "checked", version: 1,
      paramsSchema: { "~standard": { validate: () => ({ success: false, issues: [{ path: "rate", message: "rate must be finite" }] }) } },
      create: () => { creates++; return makeScenario().model; },
    }]);
    expect(() => runCandidateAndScore({ baseScenario: makeScenario(), params: {}, strategyId: "idle", objectiveId: "money",
      seeds: [1, 2], strategyRegistry: createStrategyRegistry([idleFactory]), objectiveRegistry, modelRegistry,
      model: { id: "checked", version: 1, params: { rate: Infinity } },
    })).toThrow("Invalid model params: rate must be finite");
    expect(creates).toBe(0);
  });

  it("preserves legacy raw params after schema validation for every new instance", () => {
    const params = { threshold: "2" };
    const schema = { "~standard": { validate: () => ({ success: true as const, value: { threshold: 2 } }) } };
    const scenario = makeScenario();
    let modelCreates = 0;
    let strategyCreates = 0;
    const modelRegistry = createModelRegistry([{ id: "raw", version: 1, paramsSchema: schema, create: (raw) => {
      expect(raw).toBe(params); modelCreates++; return scenario.model;
    } }]);
    const strategyRegistry = createStrategyRegistry([{ ...idleFactory, paramsSchema: schema, create: (raw) => {
      expect(raw).toBe(params); strategyCreates++; return { id: "idle", decide: () => [] };
    } }]);
    const objectiveRegistry = createObjectiveRegistry([{ id: "fresh", create: () => ({ id: "fresh", score: ({ evaluation }) => {
      runScenario(evaluation!.open()); return 1;
    } }) }]);
    const out = runCandidateAndScore({ baseScenario: scenario, params, strategyId: "idle", objectiveId: "fresh", seeds: [1, 2],
      strategyRegistry, objectiveRegistry, modelRegistry, model: { id: "raw", version: 1, params }, statefulModel: true });
    expect(out.seedScores).toEqual([1, 1]);
    expect(modelCreates).toBe(4);
    expect(strategyCreates).toBe(4);
  });

  it("offers fresh candidate strategies while preserving seed and run overrides", () => {
    const scenario = makeScenario();
    const strategyRegistry = createStrategyRegistry([{ id: "once", create: () => {
      let used = false;
      return { id: "once", decide: (ctx: any, model: any, state: any) => {
        if (used) return []; used = true;
        return [{ action: model.actions(ctx, state)[0] }];
      } };
    } }]);
    const objectiveRegistry = createObjectiveRegistry([{ id: "fresh", create: () => ({ id: "fresh",
      score: ({ scenario: completed, run, evaluation }) => {
        expect(run.end.vars.counter).toBe(1);
        for (let i = 0; i < 2; i++) {
          const fresh = evaluation!.open();
          expect(fresh.strategy).not.toBe(completed.strategy);
          expect(fresh.ctx.seed).toBe(completed.ctx.seed);
          expect(fresh.run.durationSec).toBe(2);
          expect(fresh.run.eventLog?.enabled).toBeFalse();
          expect(runScenario(fresh).end.vars.counter).toBe(1);
        }
        return run.end.vars.counter;
      },
    }) }]);
    const result = runCandidateAndScore({ baseScenario: scenario, params: {}, strategyId: "once", objectiveId: "fresh",
      seeds: [1, 2], overrides: { durationSec: 2 }, strategyRegistry, objectiveRegistry });
    expect(result.seedScores).toEqual([1, 1]);
  });

  it("rebuilds the model from its source params for every seed and analysis run", () => {
    const scenario = makeScenario();
    const modelRegistry = createModelRegistry([{ id: "closure", version: 1, create: (params: any) => {
      let used = false;
      return { id: "closure", version: 1, income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => used ? [] : [{ id: "once", kind: "custom", canApply: () => true, cost: () => null,
          apply: (_ctx: any, state: any) => { used = true; state.vars.counter += params.delta; return state; } }],
      };
    } }]);
    const strategyRegistry = createStrategyRegistry([{ id: "buy", create: () => ({ id: "buy",
      decide: (ctx: any, model: any, state: any) => model.actions(ctx, state).map((action: any) => ({ action })),
    }) }]);
    const objectiveRegistry = createObjectiveRegistry([{ id: "fresh", create: () => ({ id: "fresh", score: ({ run, evaluation }) => {
      expect(run.end.vars.counter).toBe(3);
      expect(runScenario(evaluation!.open()).end.vars.counter).toBe(3);
      return run.end.vars.counter;
    } }) }]);
    const result = runCandidateAndScore({ baseScenario: scenario, params: {}, strategyId: "buy", objectiveId: "fresh",
      seeds: [1, 2], strategyRegistry, objectiveRegistry, modelRegistry,
      model: { id: "closure", version: 1, params: { delta: 3 } } });
    expect(result.seedScores).toEqual([3, 3]);
    expect(scenario.initial.vars.counter).toBe(0);
  });
});
