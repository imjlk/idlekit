import assert from "assert/strict";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import {
  builtinStrategyFactories, compileScenario, createModelRegistry, createNumberEngine,
  createStrategyRegistry, defineModelFactory, runElapsedSec, runScenario, validateScenarioStructure,
  deriveMonetizationConfig, estimateLtvPerUser, estimateLtvDistribution,
  observeCohort, compareRetention, planRetentionPatch, applyRetentionPatch,
  simulateSessionPattern, type CompiledScenario, type SessionOfflinePreparer,
} from "@idlekit/core";
import { createBreakInfinityEngine, type Engine } from "@idlekit/money";
import matrix from "../../../fixtures/regressions/time-boundaries.json";
import { checkResearchTower } from "./research-tower-smoke";

const moneyEngine = createBreakInfinityEngine();
const coreEngine = createNumberEngine();
const parsedScenario = validateScenarioStructure(matrix.scenario);
assert.ok(parsedScenario.success, "shared scenario must match the public contract");
const scenario = parsedScenario.data;
const ltvArgs = { config: deriveMonetizationConfig(scenario), horizonDays: 1.5, progression: 0 };
const ltv = estimateLtvPerUser(ltvArgs);
assert.ok(Number.isFinite(ltv.cumulativeLtvPerUser), 'public installed LTV point API');
const ltvSample = { ...ltvArgs, draws: 10, quantiles: [0.5, 0.9], seed: 42 };
assert.deepEqual(estimateLtvDistribution(ltvSample), estimateLtvDistribution(ltvSample),
  'installed distribution API is seeded and standalone');
const observation = observeCohort([
  { userId: "returning", day: 0 }, { userId: "inactive", day: 0, active: false },
  { userId: "returning", day: 1 },
], 1);
const cohortScenario = { ...scenario, monetization: {
  retention: { d1: 0.8, d7: 0.2, d30: 0.1, d90: 0.05 },
  revenue: { payerConversion: 0.03 },
} };
assert.equal(planRetentionPatch(observation, cohortScenario.monetization.retention).status, "ready");
assert.equal(compareRetention(observation, cohortScenario.monetization.retention)[0]?.observed, 0.5);
const calibrated = applyRetentionPatch({ scenario: cohortScenario, observation });
assert.equal(calibrated.monetization?.retention?.d1, 0.5, "installed public cohort API applies measured retention");
assert.equal(calibrated.monetization?.retention?.d7, 0.2, "future retention remains an assumption");
assert.deepEqual(calibrated.monetization?.revenue, cohortScenario.monetization.revenue);
assert.equal(cohortScenario.monetization.retention.d1, 0.8, "consumer scenario is not mutated");
assert.throws(() => applyRetentionPatch({ scenario: cohortScenario,
  observation: observeCohort([{ userId: "inactive", day: 0 }], 1) }), /requires-review/);

export type LibrarySmokeResult = Readonly<{
  money: string;
  core: string;
  boundaryChecks: number;
  towerChecks: number;
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

function checkOfflinePreparation<N>(E: Engine<N>): void {
  const unit = { code: "COIN" as const };
  type Vars = { returns: number };
  const prepared: CompiledScenario<N, "COIN", Vars> = {
    ctx: { E, unit, tickPolicy: { mode: "drop" } },
    model: { id: "active", version: 1, income: () => ({ unit, amount: E.from(1) }), actions: () => [] },
    initial: { t: 0, vars: { returns: 0 },
      wallet: { money: { unit, amount: E.zero() }, bucket: E.zero() },
      maxMoneyEver: { unit, amount: E.zero() },
      prestige: { count: 0, points: E.zero(), multiplier: E.from(1) } },
    run: { stepSec: 1, offline: { actions: { mode: "none" } } },
  };
  const prepareOffline: SessionOfflinePreparer<N, "COIN", Vars> = ({ state, seconds, wallStartT, wallEndT }) => {
    assert.deepEqual([seconds, wallStartT, wallEndT], [86399, 1, 86400]);
    return { stepSec: 2, policy: { maxSec: 2 }, model: {
      id: "away", version: 1, actions: () => [],
      income: () => ({ unit, amount: E.from(3) }),
      evolve: (_ctx, current) => ({ ...current, vars: { returns: state.vars.returns + 1 } }),
    } };
  };
  const result = simulateSessionPattern({ scenario: prepared, prepareOffline,
    pattern: { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 0, durationSec: 1 }] } });
  assert.equal(E.toString(result.end.wallet.money.amount), "7");
  assert.equal(result.end.vars.returns, 1);
  assert.equal(result.summary.elapsedSec, 86400);
  assert.equal(result.summary.offlineCreditedSec, 2);
  assert.equal(prepared.initial.vars.returns, 0);
}
checkOfflinePreparation(coreEngine);
checkOfflinePreparation(moneyEngine);
const boundaryChecks = checkBoundaries(coreEngine) + checkBoundaries(moneyEngine);
assert.equal(boundaryChecks, 26, "all 13 shared cases must run under both engines");
const result: LibrarySmokeResult = {
  money: moneyEngine.toString(moneyEngine.from("1e6")),
  core: coreEngine.toString(coreEngine.add(2, 3)),
  boundaryChecks,
  towerChecks: checkResearchTower(),
};
console.log(JSON.stringify(result));
