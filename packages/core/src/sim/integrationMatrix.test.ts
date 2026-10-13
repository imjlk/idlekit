import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { createBreakEternityEngine } from "../engine/breakEternity";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { compileScenario } from "../scenario/compile";
import { createModelRegistry, type ModelFactory } from "../scenario/registry";
import type { ScenarioV1 } from "../scenario/types";
import { executeResetCycles } from "./analysis/resetCycle";
import { checkPartialFinalTick } from "../testkit/conformance";
import { runScenario } from "./simulator";
import {
  expectedBudgetEnd,
  expectedLinearEnd,
  expectedQuotedWallet,
  expectedResetCarry,
  integrationHandAnswer,
  integrationReleaseScope,
  integrationUnsupportedEngine,
} from "./integrationMatrix";
import { createRunFactory } from "./runFactory";
import { builtinStrategyFactories } from "./strategy/builtins";
import { createStrategyRegistry } from "./strategy/registry";
import type { Action, Model, SimContext, SimState } from "./types";

type UnitCode = "COIN";
type Vars = { owned: number };
type Matrix = {
  schemaVersion: number;
  seed: number;
  linear: { initial: string; incomePerSec: string; stepSec: number; durationSec: number; expectedEnd: string; expectedStop: string };
  partial: { initial: string; incomePerSec: string; stepSec: number; durationSec: number; expectedEnd: string; expectedStop: string };
  budget: { initial: string; incomePerSec: string; stepSec: number; durationSec: number; maxSteps: number; expectedEnd: string; expectedStop: string };
  goal: { initial: string; incomePerSec: string; stepSec: number; durationSec: number; target: string; expectedEnd: string; expectedStatus: string };
  bulk: { start: string; unitCost: string; quoteSize: number; quoteCost: string; expectedWallet: string; expectedOwned: number };
  reset: { initialWallet: string; gain: string; carryWallet: string; intervalSec: number };
  big: { initial: string; incomePerSec: string; stepSec: number; durationSec: number };
  offline: { maxSec: number; overflowPolicy: "clamp" | "reject" };
  logs: { capped: number };
  stateful: { programLength: number };
  unsupported: string;
};

function matrix(): Matrix {
  return JSON.parse(readFileSync(new URL("../../../../examples/analysis/integration-matrix.json", import.meta.url), "utf8")) as Matrix;
}

function scenario(args: {
  incomePerSec: string;
  initial: string;
  stepSec: number;
  durationSec: number;
  strategy?: ScenarioV1["strategy"];
  offline?: ScenarioV1["sim"];
}): ScenarioV1 {
  return {
    schemaVersion: 1,
    meta: { id: "integration-matrix", title: "integration-matrix" },
    unit: { code: "COIN" },
    policy: { mode: "accumulate" },
    model: { id: "flat", version: 1, params: { incomePerSec: args.incomePerSec } },
    initial: {
      t: 0,
      wallet: { unit: "COIN", amount: args.initial, bucket: "0" },
      vars: { owned: 0 },
      prestige: { count: 0, points: "0", multiplier: "1" },
    },
    clock: { stepSec: args.stepSec, durationSec: args.durationSec },
    ...(args.strategy ? { strategy: args.strategy } : {}),
    ...(args.offline ? { sim: args.offline } : {}),
  };
}

function factoryFor<N>(args: {
  incomePerSec: string;
  actions?: (engine: Engine<N>) => Action<N, UnitCode, Vars>[];
  prestige?: Model<N, UnitCode, Vars>["prestige"];
}): ModelFactory {
  return {
    id: "flat",
    version: 1,
    create: () => ({
      id: "flat",
      version: 1,
      income: (ctx: SimContext<N, UnitCode, Vars>, _state: SimState<N, UnitCode, Vars>) => ({
        unit: ctx.unit,
        amount: ctx.E.from(args.incomePerSec),
      }),
      actions: (ctx: SimContext<N, UnitCode, Vars>, _state: SimState<N, UnitCode, Vars>) => args.actions?.(ctx.E) ?? [],
      ...(args.prestige ? { prestige: args.prestige } : {}),
    }),
  };
}

function compile<N>(engine: Engine<N>, input: ScenarioV1, model: ModelFactory) {
  return compileScenario<N, UnitCode, Vars>({
    E: engine,
    scenario: input,
    registry: createModelRegistry([model]),
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories]),
    unitFactory: (code) => ({ code: code as UnitCode }),
  });
}

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix The matrix matches the hand formulas and leaves breakEternity unsupported.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #d001f4e Re-read the section, then ran this function: linear, budget, goal, bulk, reset, logs, offline, and fresh cursors matched, the declared partial-final-tick relation held on the fixture case, equal reset wallets spelled differently were refused, and breakEternity threw.
 * @evidence ./integrationMatrix.ts#integrationReleaseScope Reads the scope marker.
 * @evidenceReview ./integrationMatrix.ts#integrationReleaseScope #01b8e4c The declaration is selected-optional-tracks.
 * @evidence ./integrationMatrix.ts#integrationUnsupportedEngine Reads the unsupported engine marker.
 * @evidenceReview ./integrationMatrix.ts#integrationUnsupportedEngine #abf4eb9 The declaration is breakEternity.
 * @evidence ./integrationMatrix.ts#integrationHandAnswer Reads the hand-answer marker.
 * @evidenceReview ./integrationMatrix.ts#integrationHandAnswer #3b85260 The declaration is integer-income-times-duration.
 * @evidence ./integrationMatrix.ts#expectedLinearEnd Computes the constant-income end wallet with integers.
 * @evidenceReview ./integrationMatrix.ts#expectedLinearEnd #7379d25 Re-read the helper without the step-grid check: 0 plus 2 per second for 5 seconds is 10, a fractional duration throws, and 6-second steps over 10 seconds end at income times 10 seconds, as the run does.
 * @evidence ./integrationMatrix.ts#expectedBudgetEnd Computes the end wallet when maxSteps stops first.
 * @evidenceReview ./integrationMatrix.ts#expectedBudgetEnd #6d3152f Three steps of 2 per second end at 6, not the 100-second answer.
 * @evidence ./integrationMatrix.ts#expectedQuotedWallet Subtracts one quoted bulk total.
 * @evidenceReview ./integrationMatrix.ts#expectedQuotedWallet #ffd7c24 50 minus the quote 20 is 30, not 50 minus 3 times 10.
 * @evidence ./integrationMatrix.ts#expectedResetCarry Returns the declared gain and carry wallet.
 * @evidenceReview ./integrationMatrix.ts#expectedResetCarry #144d2d5 Gain 4 and carry 1 come back as declared, and a carry equal in value to the pre-reset wallet throws, including 01 against 1 and -0 against 0.
 */
export function checksIntegrationMatrix(): void {
  const spec = matrix();
  expect(spec.seed).toBe(19);
  expect(integrationReleaseScope).toBe("selected-optional-tracks");
  expect(integrationUnsupportedEngine).toBe("breakEternity");
  expect(spec.unsupported).toBe("breakEternity");
  expect(integrationUnsupportedEngine).toBe("breakEternity");
  expect(integrationHandAnswer).toBe("integer-income-times-duration");

  const linearAnswer = expectedLinearEnd(spec.linear);
  expect(() => expectedLinearEnd({ ...spec.linear, durationSec: spec.linear.stepSec * 3 + 0.5 })).toThrow();
  expect(() => expectedResetCarry({ ...spec.reset, carryWallet: spec.reset.initialWallet })).toThrow("carry wallet must differ");
  // Equal wallets spelled differently are still equal.
  expect(() => expectedResetCarry({ ...spec.reset, initialWallet: "1", carryWallet: "01" })).toThrow("carry wallet must differ");
  expect(() => expectedResetCarry({ ...spec.reset, initialWallet: "0", carryWallet: "-0" })).toThrow("carry wallet must differ");
  expect(linearAnswer).toBe(spec.linear.expectedEnd);
  const engine = createNumberEngine();
  const linear = compile(engine, scenario(spec.linear), factoryFor({ incomePerSec: spec.linear.incomePerSec }));
  const linearRun = runScenario(linear);
  expect(engine.toString(linearRun.end.wallet.money.amount)).toBe(linearAnswer);
  expect(spec.linear.expectedStop).toBe("duration");
  expect(linearRun.stop?.reason).toBe("duration");
  // A duration off the step grid ends on a shorter final tick. The relation lives in the conformance harness,
  // which also runs it across the seed corpus; this matrix row invokes it on the fixture case.
  expect(expectedLinearEnd(spec.partial)).toBe(spec.partial.expectedEnd);
  expect(spec.partial.expectedStop).toBe("duration");
  const partialCheck = checkPartialFinalTick(true, spec.partial);
  expect(partialCheck.applicable).toBe(true);
  expect(partialCheck.ok).toBe(true);

  const budgetAnswer = expectedBudgetEnd(spec.budget);
  expect(budgetAnswer).toBe(spec.budget.expectedEnd);
  expect(budgetAnswer).not.toBe(expectedLinearEnd({ ...spec.budget, durationSec: spec.budget.durationSec }));
  const budgetCompiled = compile(engine, scenario(spec.budget), factoryFor({ incomePerSec: spec.budget.incomePerSec }));
  const budgetRun = runScenario({ ...budgetCompiled, run: { ...budgetCompiled.run, maxSteps: spec.budget.maxSteps } });
  expect(engine.toString(budgetRun.end.wallet.money.amount)).toBe(budgetAnswer);
  expect(budgetRun.stop?.reason).toBe("budget");

  const goalAnswer = expectedLinearEnd(spec.goal);
  expect(goalAnswer).toBe(spec.goal.expectedEnd);
  expect(BigInt(goalAnswer) < BigInt(spec.goal.target)).toBe(true);
  const goalCompiled = compile(engine, scenario(spec.goal), factoryFor({ incomePerSec: spec.goal.incomePerSec }));
  const goalRun = runScenario({
    ...goalCompiled,
    run: {
      ...goalCompiled.run,
      goals: [{ id: "wallet", met: (state) => engine.cmp(state.wallet.money.amount, engine.from(spec.goal.target)) >= 0 }],
    },
  });
  expect(engine.toString(goalRun.end.wallet.money.amount)).toBe(goalAnswer);
  expect(goalRun.stop?.reason).toBe("duration");
  expect(spec.goal.expectedStatus).toBe("unreached");
  expect(goalRun.observation?.goals[0]).toEqual({ id: "wallet", status: "unreached" });

  const quoted = expectedQuotedWallet(spec.bulk.start, spec.bulk.quoteCost);
  expect(quoted).toBe(spec.bulk.expectedWallet);
  const unitTotal = (BigInt(spec.bulk.unitCost) * BigInt(spec.bulk.quoteSize)).toString();
  expect(quoted).not.toBe((BigInt(spec.bulk.start) - BigInt(unitTotal)).toString());
  const bulkScenario = scenario({
    incomePerSec: "0",
    initial: spec.bulk.start,
    stepSec: 1,
    durationSec: 1,
    strategy: {
      id: "scripted",
      params: { schemaVersion: 1, program: [{ actionId: "buy", bulkSize: spec.bulk.quoteSize }], onCannotApply: "skip", loop: false },
    },
  });
  const bulk = compile(
    engine,
    bulkScenario,
    factoryFor({
      incomePerSec: "0",
      actions: (current) => [buyAction(current, spec.bulk.unitCost, spec.bulk.quoteSize, spec.bulk.quoteCost)],
    }),
  );
  const bulkRun = runScenario(bulk);
  expect(engine.toString(bulkRun.end.wallet.money.amount)).toBe(quoted);
  expect(bulkRun.end.vars.owned).toBe(spec.bulk.expectedOwned);

  const carry = expectedResetCarry(spec.reset);
  expect(carry.wallet).toBe(spec.reset.carryWallet);
  expect(carry.rewardDelta).toBe(spec.reset.gain);
  const resetCompiled = compile(
    engine,
    scenario({ incomePerSec: "0", initial: spec.reset.initialWallet, stepSec: 1, durationSec: spec.reset.intervalSec }),
    factoryFor({
      incomePerSec: "0",
      prestige: {
        pointsFrom: (ctx) => ctx.E.from(spec.reset.gain),
        multiplierFrom: (ctx) => ctx.E.from(1),
        resetState: (ctx, state, gained) => ({
          ...state,
          wallet: {
            ...state.wallet,
            money: { ...state.wallet.money, amount: ctx.E.from(spec.reset.carryWallet) },
          },
          prestige: {
            count: state.prestige.count + 1,
            points: ctx.E.add(state.prestige.points, gained),
            multiplier: ctx.E.from(1),
          },
        }),
      },
    }),
  );
  const reset = executeResetCycles({
    scenario: resetCompiled,
    policy: { kind: "fixed-interval", cycles: 1, intervalSec: spec.reset.intervalSec },
  });
  expect(reset.artifact.cycles[0]?.rewardDelta).toBe(carry.rewardDelta);
  expect(engine.toString(reset.state.wallet.money.amount)).toBe(carry.wallet);
  expect(engine.toString(reset.state.wallet.money.amount)).not.toBe(spec.reset.initialWallet);

  const full = runScenario(linear);
  expect(full.eventLog?.retained).toBe(full.eventLog?.totalSeen);
  expect(full.eventLog?.retained ?? 0).toBeGreaterThan(1);
  const capped = runScenario({ ...linear, run: { ...linear.run, eventLog: { enabled: true, maxEvents: spec.logs.capped } } });
  expect(capped.eventLog?.retained).toBe(spec.logs.capped);
  expect(capped.eventLog?.dropped ?? 0).toBeGreaterThan(0);
  const off = runScenario({ ...linear, run: { ...linear.run, eventLog: { enabled: false, maxEvents: 0 } } });
  expect(off.eventLog?.retained).toBe(0);

  const offlineInput = scenario({ ...spec.linear, offline: { offline: spec.offline } });
  const offline = compile(engine, offlineInput, factoryFor({ incomePerSec: spec.linear.incomePerSec }));
  expect(offline.run.offline?.maxSec).toBe(spec.offline.maxSec);
  expect(engine.toString(runScenario(offline).end.wallet.money.amount)).toBe(linearAnswer);
  expect(linear.run.offline).toBeUndefined();

  const scripted = scenario({
    incomePerSec: "0",
    initial: "0",
    stepSec: 1,
    durationSec: 1,
    strategy: {
      id: "scripted",
      params: {
        schemaVersion: 1,
        program: Array.from({ length: spec.stateful.programLength }, () => ({ actionId: "buy" })),
        onCannotApply: "skip",
        loop: false,
      },
    },
  });
  const scriptedCompiled = compile(
    engine,
    scripted,
    factoryFor({
      incomePerSec: "0",
      actions: (current) => [buyAction(current, "0", 1, "0")],
    }),
  );
  const binding = createRunFactory({
    models: createModelRegistry([factoryFor({ incomePerSec: "0", actions: (current) => [buyAction(current, "0", 1, "0")] })]),
    strategies: createStrategyRegistry([...builtinStrategyFactories]),
  }).bind(scriptedCompiled, {
    statefulStrategy: true,
    strategy: { id: "scripted", params: scripted.strategy?.params },
  });
  const first = binding.fresh({ trialId: "integration-a", seed: spec.seed });
  expect(first.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 0 });
  runScenario(first.scenario);
  expect(first.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 1 });
  const second = binding.fresh({ trialId: "integration-b", seed: spec.seed });
  expect(second.scenario.strategy?.snapshotState?.()).toEqual({ cursor: 0 });
  binding.release();

  const bigEngine = createBreakInfinityEngine();
  const big = compile(bigEngine, scenario(spec.big), factoryFor({ incomePerSec: spec.big.incomePerSec }));
  const bigEnd = bigEngine.toString(runScenario(big).end.wallet.money.amount);
  const bigStart = bigEngine.toString(bigEngine.from(spec.big.initial));
  expect(bigEnd).toBe(bigStart);
  expect(bigEnd).not.toBe("Infinity");
  expect(bigEnd.includes("e")).toBe(true);

  expect(() => createBreakEternityEngine().zero()).toThrow();
}

function buyAction<N>(engine: Engine<N>, unitCost: string, quoteSize: number, quoteCost: string): Action<N, UnitCode, Vars> {
  return {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => ({ unit: { code: "COIN" }, amount: engine.from(unitCost) }),
    bulk: () => [{ size: quoteSize, cost: { unit: { code: "COIN" }, amount: engine.from(quoteCost) } }],
    apply: (_ctx, state, bulkSize = 1) => ({
      ...state,
      vars: { owned: state.vars.owned + bulkSize },
    }),
  };
}

describe("analysis integration matrix", () => {
  it("checks the integration matrix", checksIntegrationMatrix);
});
