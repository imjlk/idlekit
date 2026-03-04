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
});
