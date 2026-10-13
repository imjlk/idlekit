import {
  builtinStrategyFactories,
  createModelRegistry,
  createStrategyRegistry,
  runElapsedSec,
  runScenario,
  type Model,
  type ScenarioV1,
} from "@idlekit/core";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { planResolvedRun, prepareResolvedRun } from "./runConfiguration";

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

const model: Model<number, string, Record<string, unknown>> = {
  id: "linear",
  version: 1,
  income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
  actions: () => [],
};

describe("shared resolved clock boundary matrix", () => {
  for (const engineRequest of ["number", "breakInfinity"]) {
    for (const boundary of matrix.cases) {
      it(`${engineRequest}: ${boundary.id}`, () => {
        const args = {
          scenario: {
            ...structuredClone(matrix.scenario),
            initial: { ...matrix.scenario.initial, t: boundary.initialT },
            clock: boundary.clock,
          },
          engineRequest,
          modelRegistry: createModelRegistry([{ id: "linear", version: 1, create: () => model }]),
          strategyRegistry: createStrategyRegistry(builtinStrategyFactories),
          seed: 1,
        };
        if (boundary.error) {
          expect(() => planResolvedRun(args)).toThrow(boundary.error);
          expect(() => runScenario(prepareResolvedRun(args).open("simulate", boundary.id).scenario)).toThrow(boundary.error);
          return;
        }
        const planned = planResolvedRun(args).planFor("simulate");
        const prepared = prepareResolvedRun(args);
        expect(planned).toEqual(prepared.planFor("simulate"));
        const opened = prepared.open("simulate", boundary.id);
        const run = runScenario(opened.scenario);
        const expected = boundary.expected!;
        expect(runElapsedSec(run)).toBe(expected.elapsedSec);
        expect(run.stop?.steps).toBe(expected.steps);
        expect(run.stop?.reason).toBe(expected.reason);
        expect(opened.scenario.ctx.E.toString(run.end.wallet.money.amount)).toBe(expected.endMoney);
        expect(run.end.t !== run.start.t).toBe(expected.timestampChanged);
        if (expected.timestampDelta !== undefined) expect(run.end.t - run.start.t).toBe(expected.timestampDelta);
      });
    }
  }
});
