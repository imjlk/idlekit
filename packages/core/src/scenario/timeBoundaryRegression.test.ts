import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { runScenario } from "../sim/simulator";
import { builtinStrategyFactories } from "../sim/strategy/builtins";
import { createStrategyRegistry } from "../sim/strategy/registry";
import { runElapsedSec, type Model } from "../sim/types";
import { compileScenario } from "./compile";
import { createModelRegistry } from "./registry";
import type { ScenarioV1 } from "./types";

type BoundaryCase = {
  id: string;
  initialT: number;
  clock: ScenarioV1["clock"];
  error?: string;
  expected?: {
    elapsedSec: number;
    steps: number;
    reason: "duration" | "until";
    endMoney: string;
    timestampChanged: boolean;
    timestampDelta?: number;
  };
};

const matrix = JSON.parse(readFileSync(
  new URL("../../../../fixtures/regressions/time-boundaries.json", import.meta.url),
  "utf8",
)) as { scenario: ScenarioV1; cases: BoundaryCase[] };

function compileCase<N>(E: Engine<N>, boundary: BoundaryCase) {
  const model: Model<N, "COIN", Record<string, unknown>> = {
    id: "linear",
    version: 1,
    income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
    actions: () => [],
  };
  return compileScenario<N, "COIN", Record<string, unknown>>({
    E,
    scenario: {
      ...structuredClone(matrix.scenario),
      initial: { ...matrix.scenario.initial, t: boundary.initialT },
      clock: boundary.clock,
    },
    registry: createModelRegistry([{ id: "linear", version: 1, create: () => model }]),
    strategyRegistry: createStrategyRegistry(builtinStrategyFactories),
    unitFactory: () => ({ code: "COIN" }),
  });
}

function checkCase<N>(E: Engine<N>, boundary: BoundaryCase): void {
  if (boundary.error) {
    expect(() => runScenario(compileCase(E, boundary))).toThrow(boundary.error);
    return;
  }
  const expected = boundary.expected!;
  const run = runScenario(compileCase(E, boundary));
  expect(runElapsedSec(run)).toBe(expected.elapsedSec);
  expect(run.stop?.steps).toBe(expected.steps);
  expect(run.stop?.reason).toBe(expected.reason);
  expect(E.toString(run.end.wallet.money.amount)).toBe(expected.endMoney);
  expect(run.end.t !== run.start.t).toBe(expected.timestampChanged);
  if (expected.timestampDelta !== undefined) expect(run.end.t - run.start.t).toBe(expected.timestampDelta);
}

describe("shared public clock boundary matrix", () => {
  for (const boundary of matrix.cases) {
    it(`number: ${boundary.id}`, () => checkCase(createNumberEngine(), boundary));
    it(`breakInfinity: ${boundary.id}`, () => checkCase(createBreakInfinityEngine(), boundary));
  }
});
