import assert from "assert/strict";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import {
  builtinStrategyFactories, compileScenario, createModelRegistry, createNumberEngine,
  createStrategyRegistry, defineModelFactory, runElapsedSec, runScenario, validateScenarioStructure,
} from "@idlekit/core";
import { createBreakInfinityEngine, type Engine } from "@idlekit/money";
import matrix from "../../../fixtures/regressions/time-boundaries.json";

const moneyEngine = createBreakInfinityEngine();
const coreEngine = createNumberEngine();
const parsedScenario = validateScenarioStructure(matrix.scenario);
assert.ok(parsedScenario.success, "shared scenario must match the public contract");
const scenario = parsedScenario.data;

export type LibrarySmokeResult = Readonly<{
  money: string;
  core: string;
  boundaryChecks: number;
}>;

// Run the installed compiled exports under the supported Bun runtime without compiler preload.
for (const name of ["core", "money"]) {
  const resolved = fileURLToPath(import.meta.resolve(`@idlekit/${name}`));
  const installed = fileURLToPath(new URL(`./node_modules/@idlekit/${name}/dist/index.js`, import.meta.url));
  assert.equal(realpathSync(resolved), realpathSync(installed), `compiled installed ${name} entry`);
}
function checkBoundaries<N>(E: Engine<N>): number {
  for (const boundary of matrix.cases) {
    const execute = () => runScenario(compileScenario<N, "COIN", unknown>({
      E,
      scenario: {
        ...structuredClone(scenario),
        initial: { ...scenario.initial, t: boundary.initialT },
        clock: boundary.clock,
      },
      registry: createModelRegistry([defineModelFactory<N, "COIN", unknown>({
        id: "linear", version: 1,
        create: () => ({
          id: "linear", version: 1,
          income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
          actions: () => [],
        }),
      })]),
      strategyRegistry: createStrategyRegistry(builtinStrategyFactories),
      unitFactory: () => ({ code: "COIN" }),
    }));
    if (boundary.error) {
      const message = boundary.error;
      assert.throws(execute, (error: unknown) => error instanceof Error && error.message.includes(message), boundary.id);
    } else {
      const run = execute();
      const expected = boundary.expected;
      assert.ok(expected, `${boundary.id} must declare an expected result`);
      assert.equal(runElapsedSec(run), expected.elapsedSec, boundary.id);
      assert.equal(run.stop?.steps, expected.steps, boundary.id);
      assert.equal(run.stop?.reason, expected.reason, boundary.id);
      assert.equal(E.toString(run.end.wallet.money.amount), expected.endMoney, boundary.id);
      assert.equal(run.end.t !== run.start.t, expected.timestampChanged, boundary.id);
      if (expected.timestampDelta !== undefined) assert.equal(run.end.t - run.start.t, expected.timestampDelta, boundary.id);
    }
  }
  return matrix.cases.length;
}

const boundaryChecks = checkBoundaries(coreEngine) + checkBoundaries(moneyEngine);
assert.equal(boundaryChecks, 26, "all 13 shared cases must run under both engines");
const result: LibrarySmokeResult = {
  money: moneyEngine.toString(moneyEngine.from("1e6")),
  core: coreEngine.toString(coreEngine.add(2, 3)),
  boundaryChecks,
};
console.log(JSON.stringify(result));
