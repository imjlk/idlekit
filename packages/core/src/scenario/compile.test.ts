import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { compileScenario } from "./compile";
import { createModelRegistry, type ModelFactory } from "./registry";
import { createStrategyRegistry, type StrategyFactory } from "../sim/strategy/registry";
import type { ScenarioV1 } from "./types";

function makeScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "10" },
    },
    clock: {
      stepSec: 1,
      durationSec: 10,
    },
    strategy: {
      id: "s",
    },
  };
}

describe("compileScenario", () => {
  it("injects strategy defaultParams when scenario params are omitted", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    let receivedParams: unknown;
    const strategyFactory: StrategyFactory = {
      id: "s",
      defaultParams: { schemaVersion: 1, objective: "minPayback" },
      create: (params) => {
        receivedParams = params;
        return {
          id: "s",
          decide: () => [],
        };
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario: makeScenario(),
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(sc.strategy).toBeDefined();
    expect(receivedParams).toEqual({ schemaVersion: 1, objective: "minPayback" });
  });

  it("uses explicit strategy params over default params", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    let receivedParams: unknown;
    const strategyFactory: StrategyFactory = {
      id: "s",
      defaultParams: { schemaVersion: 1, objective: "minPayback" },
      create: (params) => {
        receivedParams = params;
        return {
          id: "s",
          decide: () => [],
        };
      },
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      strategy: {
        id: "s",
        params: { schemaVersion: 1, objective: "maximizeIncome" },
      },
    };

    compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(receivedParams).toEqual({ schemaVersion: 1, objective: "maximizeIncome" });
  });

  it("passes stepSec hint in context and keeps money event collection runtime-configurable", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 7,
        durationSec: 70,
      },
      sim: {
        fast: true,
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(sc.ctx.stepSec).toBe(7);
    expect(sc.ctx.collectMoneyEvents).toBeUndefined();
    expect(sc.run.fast?.disableMoneyEvents).toBeTrue();
  });

  it("passes sim.eventLog options into run config", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };
    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({ id: "s", decide: () => [] }),
    };
    const scenario: ScenarioV1 = {
      ...makeScenario(),
      sim: {
        eventLog: {
          enabled: false,
          maxEvents: 10,
        },
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(sc.run.eventLog).toEqual({ enabled: false, maxEvents: 10 });
  });

  it("compiles safe untilExpr with &&/|| grammar", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
        durationSec: 10,
        untilExpr: "t >= 5 && money >= 10",
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(sc.run.until?.(sc.initial)).toBeFalse();
    expect(sc.run.until?.({ ...sc.initial, t: 5 })).toBeTrue();
  });

  it("rejects unsafe untilExpr by default", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
        durationSec: 10,
        untilExpr: "s.t >= 1 ? true : false",
      },
    };

    expect(() =>
      compileScenario<number, "COIN", Record<string, unknown>>({
        E: createNumberEngine(),
        scenario,
        registry: createModelRegistry([modelFactory]),
        strategyRegistry: createStrategyRegistry([strategyFactory]),
        unitFactory: (code) => ({ code: code as "COIN" }),
      }),
    ).toThrow();
  });

  it("allows unsafe untilExpr only when explicitly enabled", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
        durationSec: 10,
        untilExpr: "s.t >= 1 ? true : false",
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
      opts: { allowUnsafeUntilExpr: true },
    });

    expect(sc.run.until?.(sc.initial)).toBeFalse();
    expect(sc.run.until?.({ ...sc.initial, t: 1 })).toBeTrue();
  });

  it("rejects invalid numeric right-value at compile time for known paths", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
        durationSec: 10,
        untilExpr: "t >= nope",
      },
    };

    expect(() =>
      compileScenario<number, "COIN", Record<string, unknown>>({
        E: createNumberEngine(),
        scenario,
        registry: createModelRegistry([modelFactory]),
        strategyRegistry: createStrategyRegistry([strategyFactory]),
        unitFactory: (code) => ({ code: code as "COIN" }),
      }),
    ).toThrow();
  });

  it("does not throw at runtime for unknown-path type mismatch in untilExpr", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({
        id: "s",
        decide: () => [],
      }),
    };

    const scenario: ScenarioV1 = {
      ...makeScenario(),
      initial: {
        ...makeScenario().initial,
        vars: { flag: true },
      },
      clock: {
        stepSec: 1,
        durationSec: 10,
        untilExpr: "vars.flag >= nope",
      },
    };

    const sc = compileScenario<number, "COIN", Record<string, unknown>>({
      E: createNumberEngine(),
      scenario,
      registry: createModelRegistry([modelFactory]),
      strategyRegistry: createStrategyRegistry([strategyFactory]),
      unitFactory: (code) => ({ code: code as "COIN" }),
    });

    expect(() => sc.run.until?.(sc.initial)).not.toThrow();
    expect(sc.run.until?.(sc.initial)).toBeFalse();
  });

  it("rejects scenario compile without durationSec and untilExpr", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };
    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({ id: "s", decide: () => [] }),
    };
    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
      },
    };

    expect(() =>
      compileScenario<number, "COIN", Record<string, unknown>>({
        E: createNumberEngine(),
        scenario,
        registry: createModelRegistry([modelFactory]),
        strategyRegistry: createStrategyRegistry([strategyFactory]),
        unitFactory: (code) => ({ code: code as "COIN" }),
      }),
    ).toThrow("clock requires at least one stop condition");
  });

  it("rejects non-positive durationSec in compile", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };
    const strategyFactory: StrategyFactory = {
      id: "s",
      create: () => ({ id: "s", decide: () => [] }),
    };
    const scenario: ScenarioV1 = {
      ...makeScenario(),
      clock: {
        stepSec: 1,
        durationSec: 0,
      },
    };

    expect(() =>
      compileScenario<number, "COIN", Record<string, unknown>>({
        E: createNumberEngine(),
        scenario,
        registry: createModelRegistry([modelFactory]),
        strategyRegistry: createStrategyRegistry([strategyFactory]),
        unitFactory: (code) => ({ code: code as "COIN" }),
      }),
    ).toThrow("clock.durationSec must be > 0");
  });

  it("fails closed when strategy params schema returns invalid shape", () => {
    const modelFactory: ModelFactory = {
      id: "m",
      version: 1,
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };
    const strategyFactory: StrategyFactory = {
      id: "s",
      paramsSchema: {
        "~standard": {
          validate: () => ({}) as any,
        },
      },
      create: () => ({ id: "s", decide: () => [] }),
    };

    expect(() =>
      compileScenario<number, "COIN", Record<string, unknown>>({
        E: createNumberEngine(),
        scenario: makeScenario(),
        registry: createModelRegistry([modelFactory]),
        strategyRegistry: createStrategyRegistry([strategyFactory]),
        unitFactory: (code) => ({ code: code as "COIN" }),
      }),
    ).toThrow("Invalid strategy params");
  });
});
