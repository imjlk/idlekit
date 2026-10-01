import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { emitCommittedResets } from "../observation";
import { applyDecisions, type CommittedResetFact } from "../step";
import type { Strategy } from "../strategy/types";
import type { Action, CompiledScenario, Model, SimState } from "../types";
import { analyzePrestigeCycle } from "./prestigeCycle";
import {
  executeResetCycles,
  resetAdapterFor,
  resetCycleAlgorithmVersion,
  resetCycleExecution,
  resetCycleJsonSchema,
  resetCycleRewardDelta,
  resetCycleSameContract,
  resetCycleSchemaId,
  validateResetCycleArtifact,
  type ResetAdapter,
  type ResetCycleRng,
} from "./resetCycle";

type Vars = { bought: number; score: number };

const unit = { code: "COIN" as const };
const reproSeed = 0x7110;

function state(args?: {
  t?: number;
  money?: number;
  points?: number;
  multiplier?: number;
  count?: number;
  bought?: number;
  score?: number;
}): SimState<number, "COIN", Vars> {
  const money = args?.money ?? 0;
  return {
    t: args?.t ?? 0,
    wallet: { money: { unit, amount: money }, bucket: 0 },
    maxMoneyEver: { unit, amount: money },
    prestige: {
      count: args?.count ?? 0,
      points: args?.points ?? 0,
      multiplier: args?.multiplier ?? 1,
    },
    vars: { bought: args?.bought ?? 0, score: args?.score ?? 0 },
  };
}

function coin(amount: number) {
  return { unit, amount };
}

function prestigeAction(mutate?: (current: SimState<number, "COIN", Vars>) => SimState<number, "COIN", Vars>): Action<number, "COIN", Vars> {
  return {
    id: "prestige",
    kind: "prestige",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) =>
      mutate?.(current) ?? {
        ...current,
        wallet: { ...current.wallet, money: coin(0), bucket: 0 },
        prestige: {
          count: current.prestige.count + 1,
          points: current.prestige.points + 1,
          multiplier: current.prestige.multiplier + 1,
        },
      },
  };
}

function scenario(args?: {
  income?: number;
  actions?: readonly Action<number, "COIN", Vars>[];
  initial?: SimState<number, "COIN", Vars>;
  strategy?: Strategy<number, "COIN", Vars>;
  prestige?: Model<number, "COIN", Vars>["prestige"];
  constraints?: CompiledScenario<number, "COIN", Vars>["constraints"];
  observer?: CompiledScenario<number, "COIN", Vars>["run"]["observer"];
}): CompiledScenario<number, "COIN", Vars> {
  const E = createNumberEngine();
  const actions = args?.actions ?? [prestigeAction()];
  const model: Model<number, "COIN", Vars> = {
    id: "reset-cycle",
    version: 1,
    income: (_ctx, current) => coin((args?.income ?? 1) * current.prestige.multiplier),
    actions: () => actions,
    ...(args?.prestige ? { prestige: args.prestige } : {}),
  };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1, seed: reproSeed },
    model,
    initial: args?.initial ?? state(),
    ...(args?.strategy ? { strategy: args.strategy } : {}),
    ...(args?.constraints ? { constraints: args.constraints } : {}),
    run: {
      stepSec: 1,
      durationSec: 1,
      ...(args?.observer ? { observer: args.observer } : {}),
    },
  };
}

function economy(current: SimState<number, "COIN", Vars>) {
  return {
    t: current.t,
    money: current.wallet.money.amount,
    points: current.prestige.points,
    multiplier: current.prestige.multiplier,
    count: current.prestige.count,
    bought: current.vars.bought,
    score: current.vars.score,
  };
}

function cursorStrategy(rng: ResetCycleRng & { next: () => number }, modelActions: "buy"): Strategy<number, "COIN", Vars> {
  let cursor = 0;
  return {
    id: "cursor",
    stateVersion: 1,
    decide(ctx, model, current) {
      const draw = rng.next();
      cursor += 1;
      if (draw % 2 !== 0) return [];
      const action = model.actions(ctx, current).find((candidate) => candidate.id === modelActions);
      return action ? [{ action }] : [];
    },
    snapshotState: () => ({ cursor }),
    restoreState(saved) {
      if (!saved || typeof saved !== "object" || !("cursor" in saved)) throw new Error("cursor");
      const next = saved.cursor;
      if (typeof next !== "number") throw new Error("cursor");
      cursor = next;
    },
  };
}

function makeRng(seed: number): ResetCycleRng & { next: () => number } {
  let value = seed >>> 0;
  return {
    next() {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value;
    },
    snapshot: () => value,
    restore(saved) {
      if (typeof saved !== "number") throw new Error("rng");
      value = saved >>> 0;
    },
  };
}

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset Three intervals commit three resets, and a resumed run matches the continuous one.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #dff6bbb Re-read the section: count 3 and multiplier 4 are carried, and cycles 1 is a different state.
 * @evidence ./resetCycle.ts#resetCycleExecution Reads the committed-reset host.
 * @evidenceReview ./resetCycle.ts#resetCycleExecution #8bc8cf1 The declaration is committed-reset-transition.
 * @evidence ./resetCycle.ts#validateResetCycleArtifact The artifact validates.
 * @evidenceReview ./resetCycle.ts#validateResetCycleArtifact #f18ac9a The arrow builds typia.createValidate of ResetCycleArtifactV1 on first call and reuses it.
 * @evidence ./resetCycle.ts#resetCycleJsonSchema The schema is 3.1.
 * @evidenceReview ./resetCycle.ts#resetCycleJsonSchema #c6690d5 The function memoizes typia.json.schema of ResetCycleArtifactV1.
 * @evidence ./resetCycle.ts#executeResetCycles Runs three fixed intervals, an explicit list, a resume, and the horizon and budget guards.
 * @evidenceReview ./resetCycle.ts#executeResetCycles #9b86033 The function runs each interval with runScenario, commits one reset through applyDecisions without re-reading model.actions, records a refusal instead of forcing it, and chains the carried state into the next cycle.
 * @evidence ./resetCycle.ts#resetAdapterFor Picks the prestige action and returns nothing for a model with neither an action nor a spec.
 * @evidenceReview ./resetCycle.ts#resetAdapterFor #265bf85 The function returns an explicit adapter first, then the prestige action adapter, then the spec adapter, and undefined when the model has no spec.
 * @evidence ./resetCycle.ts#resetCycleSchemaId Reads the reset cycle schema id.
 * @evidenceReview ./resetCycle.ts#resetCycleSchemaId #2121231 The function returns the reset.cycle.v1 schema URL constant.
 * @evidence ./resetCycle.ts#resetCycleAlgorithmVersion Reads the algorithm version on the artifact.
 * @evidenceReview ./resetCycle.ts#resetCycleAlgorithmVersion #7b0fecb The function returns the reset-cycle-v1 constant.
 * @evidence ../step.ts#applyDecisions Commits one prestige action directly and checks that no income tick or t advance follows.
 * @evidenceReview ../step.ts#applyDecisions #fa1f49c The function pays and applies the decisions, records a committed reset for the requested kinds, and leaves income, evolve, and t to stepOnce.
 * @evidence ../observation.ts#emitCommittedResets Sends the reset facts to onReset and skips an observer without one.
 * @evidenceReview ../observation.ts#emitCommittedResets #05b889d The function returns early without onReset or facts and notifies each fact in order otherwise.
 */
export function runsThreeCommittedResets(): void {
  expect(resetCycleExecution).toBe("committed-reset-transition");
  const seen: string[] = [];
  const watched = executeResetCycles({
    scenario: scenario({
      observer: {
        onReset: (fact) => {
          seen.push(`${fact.actionId}:${fact.rewardDelta}:${fact.wallT ?? "none"}`);
        },
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
  });
  const quiet = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
  });
  expect(economy(watched.state)).toEqual(economy(quiet.state));
  expect(watched.state.prestige.count).toBe(3);
  expect(watched.state.prestige.points).toBe(3);
  expect(watched.state.prestige.multiplier).toBe(4);
  expect(watched.state.t).toBe(6);
  expect(watched.state.wallet.money.amount).toBe(0);
  expect(watched.artifact.appliedResets).toBe(3);
  expect(watched.artifact.cycles.map((row) => row.resetAtSec)).toEqual([2, 4, 6]);
  expect(watched.artifact.cycles.map((row) => row.durationSec)).toEqual([2, 2, 2]);
  expect(watched.artifact.globalElapsedSec).toBe(6);
  expect(seen).toEqual(["prestige:1:none", "prestige:1:none", "prestige:1:none"]);
  expect(validateResetCycleArtifact(watched.artifact).success).toBe(true);
  expect(resetCycleJsonSchema().version).toBe("3.1");
  expect(resetCycleJsonSchema().schema).toBeDefined();
  expect(resetCycleSchemaId()).toBe("https://idlekit.dev/schemas/reset.cycle.v1.schema.json");
  expect(watched.artifact.algorithmVersion).toBe(resetCycleAlgorithmVersion());
  const direct = scenario();
  const committed = applyDecisions({
    ctx: direct.ctx,
    model: direct.model,
    state: state({ t: 5, money: 7 }),
    decisions: [{ action: prestigeAction() }],
  });
  expect(committed.state.t).toBe(5);
  expect(committed.state.wallet.money.amount).toBe(0);
  expect(committed.committedResets).toHaveLength(1);
  expect(committed.committedResets[0]?.before.money).toBe("7");
  expect(committed.committedResets[0]?.rewardDelta).toBe("1");
  const relayed: CommittedResetFact[] = [];
  emitCommittedResets({ onReset: (fact) => relayed.push(fact) }, committed.committedResets);
  emitCommittedResets({}, committed.committedResets);
  emitCommittedResets(undefined, committed.committedResets);
  expect(relayed).toEqual(committed.committedResets);
  expect(JSON.stringify(watched.artifact)).not.toContain("breakEvenSec");
  expect(JSON.stringify(watched.artifact)).not.toContain("stable");

  const once = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(once.state.prestige.count).toBe(1);
  expect(once.artifact.appliedResets).toBe(1);
  expect(once.state.prestige.points).not.toBe(watched.state.prestige.points);

  const explicit = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "explicit", steps: [{ durationSec: 2 }, { durationSec: 2 }, { durationSec: 2 }] },
  });
  expect(economy(explicit.state)).toEqual(economy(quiet.state));

  const calls = { points: 0, multiplier: 0, reset: 0 };
  const both = executeResetCycles({
    scenario: scenario({
      prestige: {
        pointsFrom: () => {
          calls.points += 1;
          return 1;
        },
        multiplierFrom: () => {
          calls.multiplier += 1;
          return 99;
        },
        resetState: (_ctx, current) => {
          calls.reset += 1;
          return current;
        },
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(calls).toEqual({ points: 0, multiplier: 0, reset: 0 });
  expect(both.artifact.warnings.some((warning) => warning.includes("prestige spec was not applied"))).toBe(true);
  expect(both.state.prestige.multiplier).toBe(2);

  const specOnly = executeResetCycles({
    scenario: scenario({
      actions: [],
      prestige: {
        pointsFrom: () => 1,
        multiplierFrom: () => 99,
        resetState: (_ctx, current, gained) => ({
          ...current,
          prestige: {
            count: current.prestige.count + 1,
            points: current.prestige.points + gained,
            multiplier: 2,
          },
        }),
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
  });
  expect(specOnly.state.prestige.points).toBe(1);
  expect(specOnly.state.prestige.multiplier).toBe(2);
  expect(specOnly.artifact.warnings.some((warning) => warning.includes("resetState owns the multiplier"))).toBe(true);

  const bare = scenario({ actions: [] });
  const unsupported = executeResetCycles({
    scenario: bare,
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
  });
  expect(unsupported.artifact.status).toBe("unsupported");
  expect(unsupported.state).toBe(bare.initial);
  expect(unsupported.state.t).toBe(0);
  expect(unsupported.artifact.appliedResets).toBe(0);

  const legacy = analyzePrestigeCycle({
    scenario: scenario(),
    scan: { fromSec: 1, toSec: 1, stepSec: 1 },
    horizonSec: 1,
    cycles: 5,
    objective: "pointsPerHour",
  });
  expect(legacy.warnings.length).toBe(3);
  expect(legacy.rows[0]?.stability).toBe("stable");
  expect(legacy.rows[0]?.cycles).toBe(5);

  const rngA = makeRng(reproSeed);
  const rngB = makeRng(reproSeed);
  const buy: Action<number, "COIN", Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, bought: current.vars.bought + 1 } }),
  };
  const full = executeResetCycles({
    scenario: scenario({
      income: 0,
      actions: [buy, prestigeAction()],
      strategy: cursorStrategy(rngA, "buy"),
    }),
    policy: { kind: "fixed-interval", intervalSec: 4, cycles: 2 },
    rng: rngA,
  });
  const first = executeResetCycles({
    scenario: scenario({
      income: 0,
      actions: [buy, prestigeAction()],
      strategy: cursorStrategy(rngB, "buy"),
    }),
    policy: { kind: "fixed-interval", intervalSec: 4, cycles: 1 },
    rng: rngB,
  });
  const resumedRng = makeRng(1);
  const resumed = executeResetCycles({
    scenario: scenario({
      income: 0,
      actions: [buy, prestigeAction()],
      strategy: cursorStrategy(resumedRng, "buy"),
    }),
    policy: { kind: "fixed-interval", intervalSec: 4, cycles: 1 },
    resume: first.checkpoint,
    rng: resumedRng,
  });
  expect(economy(resumed.state)).toEqual(economy(full.state));
  expect(resumed.checkpoint.strategyState).toEqual(full.checkpoint.strategyState);
  expect(resumed.checkpoint.rngState).toEqual(full.checkpoint.rngState);
  expect(resumed.artifact.globalElapsedSec).toBe(full.artifact.globalElapsedSec);

  const capped = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
    maxCycles: 2,
  });
  expect(capped.artifact.status).toBe("censored");
  expect(capped.artifact.appliedResets).toBe(2);
  const horizon = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
    horizonSec: 2,
  });
  expect(horizon.artifact.status).toBe("censored");
  expect(horizon.artifact.appliedResets).toBe(1);
  const budget = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 4, cycles: 1 },
    budgetSteps: 1,
  });
  expect(budget.artifact.cycles[0]?.resetSkippedReason).toBe("budget");
  expect(budget.state.prestige.count).toBe(0);
  expect(resetAdapterFor(scenario())?.id).toBe("prestige.action");
  expect(resetAdapterFor(scenario({ actions: [] }))).toBeUndefined();
}

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-refused-reset Cost, condition, and cooldown failures pay nothing.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-refused-reset #5bbd1e4 Re-read the section: the refusal is recorded and the reward stock is unchanged.
 * @evidence ./resetCycle.ts#resetCycleSameContract Prestige and custom resets share the receipt.
 * @evidenceReview ./resetCycle.ts#resetCycleSameContract #88c9213 The declaration is prestige-and-custom-reset.
 */
export function recordsRejectedResetWithoutReward(): void {
  expect(resetCycleSameContract).toBe("prestige-and-custom-reset");
  const blocked: Action<number, "COIN", Vars> = {
    ...prestigeAction(),
    canApply: () => false,
  };
  const condition = executeResetCycles({
    scenario: scenario({ actions: [blocked], income: 0 }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 2 },
  });
  expect(condition.artifact.status).toBe("incomplete");
  expect(condition.artifact.cycles).toHaveLength(1);
  expect(condition.artifact.cycles[0]?.resetSkippedReason).toBe("cannot-apply");
  expect(condition.state.prestige.points).toBe(0);
  expect(condition.artifact.appliedResets).toBe(0);

  const costly: Action<number, "COIN", Vars> = {
    ...prestigeAction(),
    cost: () => coin(5),
  };
  const unpaid = executeResetCycles({
    scenario: scenario({ actions: [costly], income: 0, initial: state({ money: 0 }) }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
  });
  expect(unpaid.artifact.cycles[0]?.resetSkippedReason).toBe("insufficient-funds");
  expect(unpaid.state.prestige.points).toBe(0);
  expect(unpaid.state.wallet.money.amount).toBe(0);

  const cooled = executeResetCycles({
    scenario: scenario({
      income: 0,
      constraints: { minPrestigeIntervalSec: 10, lastPrestigeResetT: 0 },
    }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
  });
  expect(cooled.artifact.cycles[0]?.resetSkippedReason).toBe("cooldown");
  expect(cooled.state.prestige.count).toBe(0);

  const custom: ResetAdapter<number, "COIN", Vars> = {
    id: "score.reset",
    kind: "custom",
    preserved: ["vars", "points"],
    action: () => ({
      id: "score",
      kind: "custom",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, current) => ({
        ...current,
        vars: { ...current.vars, score: current.vars.score + 1 },
      }),
    }),
    reward: (_ctx, current) => current.vars.score,
  };
  const customRun = executeResetCycles({
    scenario: scenario({ actions: [], income: 0 }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 2 },
    adapter: custom,
  });
  expect(customRun.artifact.appliedResets).toBe(2);
  expect(customRun.artifact.cycles.map((row) => row.rewardDelta)).toEqual(["1", "1"]);
  expect(customRun.state.vars.score).toBe(2);
  expect(customRun.state.prestige.points).toBe(0);

  const refusedCustom: ResetAdapter<number, "COIN", Vars> = {
    ...custom,
    action: () => ({
      id: "score",
      kind: "custom",
      canApply: () => false,
      cost: () => null,
      apply: (_ctx, current) => current,
    }),
  };
  const refused = executeResetCycles({
    scenario: scenario({ actions: [], income: 0, initial: state({ score: 4 }) }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    adapter: refusedCustom,
  });
  expect(refused.artifact.cycles[0]?.resetSkippedReason).toBe("cannot-apply");
  expect(refused.state.vars.score).toBe(4);

  const base = scenario();
  expect(() =>
    executeResetCycles({ scenario: base, policy: { kind: "fixed-interval", intervalSec: 1, cycles: 0 } }),
  ).toThrow(/positive integer/);
  expect(() =>
    executeResetCycles({ scenario: base, policy: { kind: "fixed-interval", intervalSec: 1, cycles: Number.NaN } }),
  ).toThrow(/positive integer/);
  expect(() =>
    executeResetCycles({
      scenario: base,
      policy: { kind: "fixed-interval", intervalSec: 1, cycles: Number.POSITIVE_INFINITY },
    }),
  ).toThrow(/positive integer/);
  expect(() =>
    executeResetCycles({ scenario: base, policy: { kind: "fixed-interval", intervalSec: 0, cycles: 1 } }),
  ).toThrow(/finite number > 0/);
  expect(base.initial.t).toBe(0);
}

/**
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-reward-delta Opening points stay out of the gained reward.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-reward-delta #ed22025 Re-read the section: a gain of 1 stays 1 when the opening stock is 100.
 * @evidence ./resetCycle.ts#resetCycleRewardDelta Reads the reward-delta host.
 * @evidenceReview ./resetCycle.ts#resetCycleRewardDelta #161b7e3 The declaration is reward-delta-excludes-opening-stock.
 */
export function excludesOpeningRewardFromDelta(): void {
  expect(resetCycleRewardDelta).toBe("reward-delta-excludes-opening-stock");
  const run = executeResetCycles({
    scenario: scenario({ initial: state({ points: 100 }) }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(run.artifact.cycles[0]?.rewardDelta).toBe("1");
  expect(run.artifact.cycles[0]?.accumulatedReward).toBe("1");
  expect(run.artifact.cycles[0]?.carried.points).toBe("101");
  expect(run.artifact.cycles[0]?.carried.reward).toBe("101");
  expect(run.state.prestige.points).toBe(101);
}

describe("reset cycle execution", () => {
  it("commits three resets and resumes the same economy", runsThreeCommittedResets);
  it("records a refused reset without paying a reward", recordsRejectedResetWithoutReward);
  it("keeps opening points out of the reward delta", excludesOpeningRewardFromDelta);
});
