import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  builtinStrategyFactories, compileScenario, createModelRegistry, createNumberEngine,
  createStrategyRegistry, runElapsedSec, runScenario,
} from "@idlekit/core";
import { createBreakInfinityEngine } from "@idlekit/money";

const matrix = JSON.parse(readFileSync(new URL("./time-boundaries.json", import.meta.url), "utf8"));
const moneyEngine = createBreakInfinityEngine();
const coreEngine = createNumberEngine();
let boundaryChecks = 0;

// Run the installed compiled exports under the supported Bun runtime without compiler preload.
for (const name of ["core", "money"]) {
  const resolved = fileURLToPath(import.meta.resolve(`@idlekit/${name}`));
  const installed = fileURLToPath(new URL(`./node_modules/@idlekit/${name}/dist/index.js`, import.meta.url));
  assert.equal(realpathSync(resolved), realpathSync(installed), `compiled installed ${name} entry`);
}
for (const E of [coreEngine, moneyEngine]) {
  for (const boundary of matrix.cases) {
    const execute = () => runScenario(compileScenario({
      E,
      scenario: {
        ...structuredClone(matrix.scenario),
        initial: { ...matrix.scenario.initial, t: boundary.initialT },
        clock: boundary.clock,
      },
      registry: createModelRegistry([{
        id: "linear", version: 1,
        create: () => ({
          id: "linear", version: 1,
          income: (ctx) => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
          actions: () => [],
        }),
      }]),
      strategyRegistry: createStrategyRegistry(builtinStrategyFactories),
      unitFactory: () => ({ code: "COIN" }),
    }));
    if (boundary.error) {
      assert.throws(execute, (error) => error instanceof Error && error.message.includes(boundary.error), boundary.id);
    } else {
      const run = execute();
      const expected = boundary.expected;
      assert.equal(runElapsedSec(run), expected.elapsedSec, boundary.id);
      assert.equal(run.stop?.steps, expected.steps, boundary.id);
      assert.equal(run.stop?.reason, expected.reason, boundary.id);
      assert.equal(E.toString(run.end.wallet.money.amount), expected.endMoney, boundary.id);
      assert.equal(run.end.t !== run.start.t, expected.timestampChanged, boundary.id);
      if (expected.timestampDelta !== undefined) assert.equal(run.end.t - run.start.t, expected.timestampDelta, boundary.id);
    }
    boundaryChecks++;
  }
}

assert.equal(boundaryChecks, 26, "all 13 shared cases must run under both engines");
console.log(JSON.stringify({
  money: moneyEngine.toString(moneyEngine.from("1e6")),
  core: coreEngine.toString(coreEngine.add(2, 3)),
  boundaryChecks,
}));
