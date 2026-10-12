import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { emitActionFacts, emitCommittedResets } from "../observation";
import { applyOfflineSeconds } from "../offline";
import { runScenario } from "../simulator";
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
    id: "lcg",
    stateVersion: 1,
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
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: count 3 and multiplier 4 are carried, and cycles 1 is a different state.
 * @evidence ./resetCycle.ts#resetCycleExecution Reads the committed-reset host.
 * @evidenceReview ./resetCycle.ts#resetCycleExecution #8bc8cf1 The declaration is committed-reset-transition.
 * @evidence ./resetCycle.ts#validateResetCycleArtifact The artifact validates.
 * @evidenceReview ./resetCycle.ts#validateResetCycleArtifact #f18ac9a The arrow builds typia.createValidate of ResetCycleArtifactV1 on first call and reuses it.
 * @evidence ./resetCycle.ts#resetCycleJsonSchema The schema is 3.1.
 * @evidenceReview ./resetCycle.ts#resetCycleJsonSchema #c6690d5 The function memoizes typia.json.schema of ResetCycleArtifactV1.
 * @evidence ./resetCycle.ts#executeResetCycles Runs three fixed intervals, an explicit list, a resume, and the horizon and budget guards.
 * @evidenceReview ./resetCycle.ts#executeResetCycles #425d633 The function accepts a maxCycles cap of 0, rejects a checkpoint of another contract or version, copies the resumed state and constraints, rejects a strategyState with no restoreState and an rngState with no rng, discovers adapters under the live constraints, runs each interval with runScenario on a model that delegates every member to the original receiver and hides prestige actions under any adapter and the custom reset, resolved per state and removed by identity when listed, measures the horizon on summed runner seconds with relative slack capped by a share of the interval, censors any budget stop, resolves the adapter at the boundary, commits one reset through applyDecisions with live constraints and forwards its action facts to onAction, refreshes maxMoneyEver, records a refusal instead of forcing it, and records copies of the state, a strategy snapshot only when restoreState exists, and the RNG snapshot. It binds a strategy snapshot to the writing strategy's id and state version and requires one for a restorable strategy, bounds the horizon slack to rounding ULPs, emits boundary events through ctx.emit, and recognizes its own spec and action adapters by identity. Intervals at or below the runner's 1e-12 second resolution are rejected. It binds a checkpoint to its model, rejects nonfinite clock fields before any guard, and keeps the horizon slack below half the interval. It binds a checkpoint to its explicit adapter, carries a budget-cut cycle's played seconds into the resume, hides an adapter's reset whatever its declared kind, and notifies no observer when observation is off. It binds a cut cycle to its planned duration, rejects a non-reset adapter action, a reset that moves t, and nonfinite rewards, and passes the boundary wallT from its elapsed clock. It keeps a resumed cut cycle's start, rejects an accumulated reward that overflows and a negative checkpoint elapsedSec, and announces boundary events only after the boundary is validated. It keeps cut-cycle metadata on a checkpoint that runs no cycle, requires an integer nextIndex >= 0, checks every checkpoint field before restoring the strategy or RNG, binds an RNG snapshot to the generator's id and state version, and reports an unavailable adapter action as cannot-apply. It requires a named, versioned RNG to checkpoint RNG state, caps the horizon slack at a millionth of the interval, and rejects a reset that leaves nonfinite prestige fields. It caps the boundary wallT at the segment's wall end, rejects pending progress at or past the planned duration, and requires a nonempty RNG id and a finite RNG version.
 * @evidence ../observation.ts#emitActionFacts Forwards a boundary decision to onAction.
 * @evidenceReview ../observation.ts#emitActionFacts #be50111 The function returns without onAction, and forwards each applied or skipped action event with its time, id, outcome, and reason.
 * @evidence ./resetCycle.ts#resetAdapterFor Picks the prestige action and returns nothing for a model with neither an action nor a spec.
 * @evidenceReview ./resetCycle.ts#resetAdapterFor #de4bddc The function returns an explicit adapter first, then the prestige action adapter when the given state and context list one, then the spec adapter, and undefined when the model has no spec.
 * @evidence ./resetCycle.ts#resetCycleSchemaId Reads the reset cycle schema id.
 * @evidenceReview ./resetCycle.ts#resetCycleSchemaId #2121231 The function returns the reset.cycle.v1 schema URL constant.
 * @evidence ./resetCycle.ts#resetCycleAlgorithmVersion Reads the algorithm version on the artifact.
 * @evidenceReview ./resetCycle.ts#resetCycleAlgorithmVersion #7b0fecb The function returns the reset-cycle-v1 constant.
 * @evidence ../step.ts#applyDecisions Commits one prestige action directly and checks that no income tick or t advance follows.
 * @evidenceReview ../step.ts#applyDecisions #3afa38a The function pays and applies the decisions, snapshots and records a committed reset only for the requested kinds, and leaves income, evolve, and t to stepOnce. A committed reset's wallT is the segment's wall start plus the reward seconds since the segment began, capped at the segment's wall end. A caller's wallT, from its elapsed clock, takes precedence.
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
  // The first interval runs, because a model can list its prestige action only at the boundary.
  expect(unsupported.artifact.status).toBe("unsupported");
  expect(unsupported.state.t).toBe(1);
  expect(unsupported.state.prestige.count).toBe(0);
  expect(unsupported.artifact.appliedResets).toBe(0);
  expect(unsupported.artifact.cycles[0]?.resetSkippedReason).toBe("missing-adapter");

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

  // A prestige action that appears only after the interval is found at the reset boundary.
  const unlocked = prestigeAction();
  const late = executeResetCycles({
    scenario: {
      ...scenario({ actions: [] }),
      model: {
        ...scenario().model,
        actions: (_ctx, current) => (current.wallet.money.amount >= 2 ? [unlocked] : []),
      },
    },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(late.artifact.status).toBe("ok");
  expect(late.artifact.appliedResets).toBe(1);
  expect(late.state.prestige.count).toBe(1);

  // A strategy that would choose prestige every step cannot reset inside an interval.
  const greedyResets: string[] = [];
  const eager = executeResetCycles({
    scenario: scenario({
      strategy: {
        id: "eager-prestige",
        decide(ctx, model, current) {
          const reset = model.actions(ctx, current).find((candidate) => candidate.kind === "prestige");
          return reset ? [{ action: reset }] : [];
        },
      },
      observer: { onReset: (fact) => greedyResets.push(fact.actionId) },
    }),
    policy: { kind: "fixed-interval", intervalSec: 3, cycles: 2 },
  });
  expect(eager.artifact.appliedResets).toBe(2);
  expect(eager.state.prestige.count).toBe(2);
  expect(greedyResets).toEqual(["prestige", "prestige"]);

  // horizonSec counts from the study origin, not from absolute t 0.
  const shifted = executeResetCycles({
    scenario: scenario({ initial: state({ t: 100 }) }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 3 },
    horizonSec: 2,
  });
  expect(shifted.artifact.appliedResets).toBe(2);
  expect(shifted.artifact.status).toBe("censored");
  expect(shifted.artifact.globalElapsedSec).toBe(2);

  // At a large t a 0.1s tick moves t by 0.125. The cycle duration is the simulated seconds.
  const coarse = scenario({ initial: state({ t: 1e15 }) });
  const rounded = executeResetCycles({
    scenario: { ...coarse, ctx: { ...coarse.ctx, stepSec: 0.1 }, run: { ...coarse.run, stepSec: 0.1 } },
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
  });
  expect(rounded.artifact.cycles[0]?.durationSec).toBeCloseTo(1, 9);
  expect(rounded.artifact.cycles[0]!.endSec - rounded.artifact.cycles[0]!.startSec).not.toBeCloseTo(1, 9);

  // The boundary action sees the live constraints, and a wallet-raising reset refreshes maxMoneyEver.
  const seenAnchors: Array<number | undefined> = [];
  const windfall = prestigeAction((current) => ({
    ...current,
    wallet: { ...current.wallet, money: coin(100), bucket: 0 },
    prestige: { ...current.prestige, count: current.prestige.count + 1 },
  }));
  const watchedCtx = executeResetCycles({
    scenario: scenario({ actions: [windfall], constraints: { minPrestigeIntervalSec: 1 } }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
    adapter: {
      id: "watched",
      kind: "prestige",
      preserved: ["points", "multiplier", "count"],
      action(ctx, current) {
        seenAnchors.push(ctx.constraints?.lastPrestigeResetT);
        return windfall.canApply(ctx, current) ? windfall : undefined;
      },
      reward: (_ctx, current) => current.prestige.count,
    },
  });
  expect(watchedCtx.artifact.appliedResets).toBe(2);
  expect(seenAnchors).toEqual([undefined, 2]);
  expect(watchedCtx.state.maxMoneyEver.amount).toBeGreaterThanOrEqual(watchedCtx.state.wallet.money.amount);

  // Fractional intervals fit a horizon on the summed elapsed clock, not on a rounded t difference.
  const tenths = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 0.1, cycles: 3 },
    horizonSec: 0.3,
  });
  expect(tenths.artifact.appliedResets).toBe(3);
  expect(tenths.artifact.status).toBe("ok");
  expect(tenths.checkpoint.elapsedSec).toBeCloseTo(0.3, 12);

  // Any budget stop censors the cycle, even a stop a hair short of the duration.
  const thirds = scenario();
  const nearly = executeResetCycles({
    scenario: { ...thirds, ctx: { ...thirds.ctx, stepSec: 0.3333333332 }, run: { ...thirds.run, stepSec: 0.3333333332 } },
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    budgetSteps: 3,
  });
  expect(nearly.artifact.status).toBe("censored");
  expect(nearly.artifact.appliedResets).toBe(0);
  expect(nearly.state.prestige.count).toBe(0);

  // A custom reset that appears mid-interval is still hidden from the strategy.
  const scoreAction: Action<number, "COIN", Vars> = {
    id: "score",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, score: current.vars.score + 1 } }),
  };
  const lateCustom = executeResetCycles({
    scenario: {
      ...scenario({ actions: [] }),
      model: {
        ...scenario().model,
        actions: (_ctx, current) => (current.wallet.money.amount >= 1 ? [scoreAction] : []),
      },
      strategy: {
        id: "eager-custom",
        decide(ctx, model, current) {
          const reset = model.actions(ctx, current).find((candidate) => candidate.id === "score");
          return reset ? [{ action: reset }] : [];
        },
      },
    },
    policy: { kind: "fixed-interval", intervalSec: 3, cycles: 1 },
    adapter: {
      id: "score.reset",
      kind: "custom",
      preserved: ["vars"],
      action: (_ctx, current) => (current.wallet.money.amount >= 1 ? scoreAction : undefined),
      reward: (_ctx, current) => current.vars.score,
    },
  });
  expect(lateCustom.artifact.appliedResets).toBe(1);
  expect(lateCustom.state.vars.score).toBe(1);

  // A class-based model keeps its prototype methods through the interval filter.
  class ClassModel {
    readonly id = "class-model";
    readonly version = 1;
    income(_ctx: unknown, current: SimState<number, "COIN", Vars>) {
      return coin(current.prestige.multiplier);
    }
    actions() {
      return [prestigeAction()];
    }
  }
  const classRun = executeResetCycles({
    scenario: { ...scenario(), model: new ClassModel() as unknown as Model<number, "COIN", Vars> },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
  });
  expect(classRun.artifact.appliedResets).toBe(2);
  expect(classRun.state.prestige.count).toBe(2);

  // A class model whose methods use private fields keeps its receiver through the interval filter.
  class PrivateModel {
    readonly id = "private-model";
    readonly version = 1;
    #rate = 1;
    income(_ctx: unknown, current: SimState<number, "COIN", Vars>) {
      return coin(this.#rate * current.prestige.multiplier);
    }
    actions() {
      return this.#rate > 0 ? [prestigeAction()] : [];
    }
  }
  const privateRun = executeResetCycles({
    scenario: { ...scenario(), model: new PrivateModel() as unknown as Model<number, "COIN", Vars> },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
  });
  expect(privateRun.artifact.appliedResets).toBe(2);

  // A zero horizon admits no positive interval, however small.
  const zeroHorizon = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 5e-10, cycles: 1 },
    horizonSec: 0,
  });
  expect(zeroHorizon.artifact.status).toBe("censored");
  expect(zeroHorizon.artifact.appliedResets).toBe(0);

  // An ordinary custom action that shares the reset's id stays available to the strategy.
  const resetDup: Action<number, "COIN", Vars> = {
    id: "dup",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, score: current.vars.score + 1 } }),
  };
  const ordinaryDup: Action<number, "COIN", Vars> = {
    id: "dup",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, bought: current.vars.bought + 1 } }),
  };
  const duplicated = executeResetCycles({
    scenario: scenario({
      actions: [resetDup, ordinaryDup],
      strategy: {
        id: "ordinary-dup",
        decide(ctx, model, current) {
          const listed = model.actions(ctx, current);
          return listed.includes(ordinaryDup) ? [{ action: ordinaryDup }] : [];
        },
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 3, cycles: 1 },
    adapter: {
      id: "dup.reset",
      kind: "custom",
      preserved: ["vars"],
      action: () => resetDup,
      reward: (_ctx, current) => current.vars.score,
    },
  });
  expect(duplicated.artifact.appliedResets).toBe(1);
  expect(duplicated.state.vars.score).toBe(1);
  expect(duplicated.state.vars.bought).toBe(3);

  // An undefined snapshot is recorded and restored, not dropped.
  const undefinedRestores: string[] = [];
  const blankHooks = () => ({
    strategy: {
      id: "blank",
      decide: () => [],
      snapshotState: () => undefined,
      restoreState: (saved: unknown) => undefinedRestores.push(`strategy:${String(saved)}`),
    },
    rng: { id: "undefined-rng", stateVersion: 1, snapshot: () => undefined, restore: (saved: unknown) => undefinedRestores.push(`rng:${String(saved)}`) },
  });
  const blankFirst = blankHooks();
  const blank = executeResetCycles({
    scenario: scenario({ strategy: blankFirst.strategy }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    rng: blankFirst.rng,
  });
  expect("strategyState" in blank.checkpoint).toBe(true);
  expect("rngState" in blank.checkpoint).toBe(true);
  const blankSecond = blankHooks();
  executeResetCycles({
    scenario: scenario({ strategy: blankSecond.strategy }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    resume: blank.checkpoint,
    rng: blankSecond.rng,
  });
  expect(undefinedRestores).toEqual(["strategy:undefined", "rng:undefined"]);

  // A checkpoint keeps its own copy of live strategy and RNG snapshots.
  const liveStrategy = { cursor: 1 };
  const liveRng = { value: 7 };
  const restored: unknown[] = [];
  const snapshotted = executeResetCycles({
    scenario: scenario({
      strategy: {
        id: "live",
        decide: () => [],
        snapshotState: () => liveStrategy,
        restoreState: (saved) => restored.push(saved),
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    rng: { id: "live", stateVersion: 1, snapshot: () => liveRng, restore: (saved) => restored.push(saved) },
  });
  liveStrategy.cursor = 999;
  liveRng.value = 999;
  expect(snapshotted.checkpoint.strategyState).toEqual({ cursor: 1 });
  expect(snapshotted.checkpoint.rngState).toEqual({ value: 7 });
  executeResetCycles({
    scenario: scenario({
      strategy: {
        id: "live",
        decide: () => [],
        snapshotState: () => liveStrategy,
        restoreState: (saved) => restored.push(saved),
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 1, cycles: 1 },
    resume: snapshotted.checkpoint,
    rng: { id: "live", stateVersion: 1, snapshot: () => liveRng, restore: (saved) => restored.push(saved) },
  });
  expect(restored).toEqual([{ cursor: 1 }, { value: 7 }]);
  expect(restored[0]).not.toBe(snapshotted.checkpoint.strategyState);
  expect(restored[1]).not.toBe(snapshotted.checkpoint.rngState);

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

  // maxCycles is a cap: 0 censors the run before any reset, and a negative or fractional cap is rejected.
  const none = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
    maxCycles: 0,
  });
  expect(none.artifact.status).toBe("censored");
  expect(none.artifact.appliedResets).toBe(0);
  expect(none.artifact.cycles).toEqual([]);
  expect(none.artifact.warnings).toContain("max-cycles");
  for (const maxCycles of [-1, 1.5]) {
    expect(() =>
      executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 }, maxCycles }),
    ).toThrow("maxCycles must be an integer >= 0");
  }

  // A model that lists its prestige action only under live constraints is discovered with them.
  const gatedBase = scenario({ constraints: { minPrestigeIntervalSec: 1 } });
  const gated: CompiledScenario<number, "COIN", Vars> = {
    ...gatedBase,
    model: {
      ...gatedBase.model,
      actions: (ctx) => (ctx.constraints?.minPrestigeIntervalSec === 1 ? [prestigeAction()] : []),
    },
  };
  expect(resetAdapterFor(gated)).toBeUndefined();
  expect(resetAdapterFor(gated, undefined, gated.initial, { ...gated.ctx, constraints: gated.constraints })?.id).toBe(
    "prestige.action",
  );
  const gatedRun = executeResetCycles({ scenario: gated, policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 } });
  expect(gatedRun.artifact.status).toBe("ok");
  expect(gatedRun.artifact.appliedResets).toBe(2);

  // A checkpoint holds a copy of the state. In-place edits after it, or during a resume, do not rewrite it.
  const inPlaceBuy: Action<number, "COIN", Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => {
      (current.vars as { bought: number }).bought += 1;
      return current;
    },
  };
  const alwaysBuy: Strategy<number, "COIN", Vars> = {
    id: "always-buy",
    decide(ctx, model, current) {
      const action = model.actions(ctx, current).find((candidate) => candidate.id === "buy");
      return action ? [{ action }] : [];
    },
  };
  const inPlace = () =>
    scenario({ income: 0, actions: [inPlaceBuy, prestigeAction()], strategy: alwaysBuy, initial: state() });
  const opened = executeResetCycles({ scenario: inPlace(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 } });
  const saved = economy(opened.checkpoint.state);
  (opened.state.vars as { bought: number }).bought = 1000;
  expect(economy(opened.checkpoint.state)).toEqual(saved);
  const resumedA = executeResetCycles({
    scenario: inPlace(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    resume: opened.checkpoint,
  });
  const resumedB = executeResetCycles({
    scenario: inPlace(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    resume: opened.checkpoint,
  });
  expect(economy(opened.checkpoint.state)).toEqual(saved);
  expect(economy(resumedA.state)).toEqual(economy(resumedB.state));
  expect(resumedA.state.vars.bought).toBeGreaterThan(saved.bought);

  // A strategy that can snapshot but not restore leaves no strategyState, and a resume that needs one is rejected.
  const snapshotOnly: Strategy<number, "COIN", Vars> = {
    id: "snapshot-only",
    decide: () => [],
    snapshotState: () => ({ cursor: 1 }),
  };
  const unpaired = executeResetCycles({
    scenario: scenario({ strategy: snapshotOnly }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect("strategyState" in unpaired.checkpoint).toBe(false);
  expect(unpaired.artifact.warnings).toContain("strategy state is not checkpointed: snapshotState has no restoreState");
  expect(() =>
    executeResetCycles({
      scenario: scenario({ strategy: snapshotOnly }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: { ...unpaired.checkpoint, strategyState: { cursor: 1 } },
    }),
  ).toThrow("the strategy has no restoreState");
  // A snapshot needs a restorer. A scenario without a strategy, or a resume without an rng, is rejected.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: { ...unpaired.checkpoint, strategyState: { cursor: 1 } },
    }),
  ).toThrow("the strategy has no restoreState");
  const seeded = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    rng: makeRng(3),
  });
  expect("rngState" in seeded.checkpoint).toBe(true);
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: seeded.checkpoint,
    }),
  ).toThrow("no rng was passed");
  // A checkpoint from another contract or version is not read as this one.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: { ...none.checkpoint, version: 2 } as unknown as typeof none.checkpoint,
    }),
  ).toThrow("version 1");
  // The horizon slack is capped by a share of the interval, so a long study does not admit one more short cycle.
  const longStudy = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 0.5, cycles: 1 },
    horizonSec: 1e9,
    resume: { ...none.checkpoint, elapsedSec: 1e9 },
  });
  expect(longStudy.artifact.status).toBe("censored");
  expect(longStudy.artifact.appliedResets).toBe(0);
  const fractional = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 0.1, cycles: 3 },
    horizonSec: 0.3,
  });
  expect(fractional.artifact.appliedResets).toBe(3);
  // multiplierFrom reads the same boundary context as the spec's other callbacks.
  const constrainedSpec = executeResetCycles({
    scenario: scenario({
      actions: [],
      constraints: { minPrestigeIntervalSec: 1 },
      prestige: {
        pointsFrom: () => 1,
        multiplierFrom: (ctx) => (ctx.constraints?.minPrestigeIntervalSec === 1 ? 2 : 99),
        resetState: (_ctx, current, gained) => ({
          ...current,
          prestige: { count: current.prestige.count + 1, points: current.prestige.points + gained, multiplier: 2 },
        }),
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(constrainedSpec.artifact.appliedResets).toBe(1);
  expect(constrainedSpec.artifact.warnings.some((warning) => warning.includes("multiplierFrom was not applied"))).toBe(false);

  // A custom adapter still hides prestige actions from the interval strategy.
  const prestigeTaker: Strategy<number, "COIN", Vars> = {
    id: "prestige-taker",
    decide(ctx, model, current) {
      const action = model.actions(ctx, current).find((candidate) => candidate.kind === "prestige");
      return action ? [{ action }] : [];
    },
  };
  const rebirth: Action<number, "COIN", Vars> = {
    id: "rebirth",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, score: current.vars.score + 1 } }),
  };
  const rebirthAdapter: ResetAdapter<number, "COIN", Vars> = {
    id: "rebirth",
    kind: "custom",
    preserved: ["vars"],
    action: () => rebirth,
    reward: (_ctx, current) => current.vars.score,
  };
  const customOnly = executeResetCycles({
    scenario: scenario({ actions: [prestigeAction(), rebirth], strategy: prestigeTaker }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
    adapter: rebirthAdapter,
  });
  expect(customOnly.artifact.appliedResets).toBe(2);
  expect(customOnly.state.prestige.count).toBe(0);
  expect(customOnly.state.vars.score).toBe(2);

  // The boundary decision reaches onAction, as an action decided inside a step does.
  const actionFacts: string[] = [];
  const observerFor = { onAction: (fact: { t: number; actionId: string; outcome: string }) => void actionFacts.push(`${fact.actionId}:${fact.outcome}@${fact.t}`) };
  executeResetCycles({
    scenario: scenario({ observer: observerFor }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
  });
  expect(actionFacts).toEqual(["prestige:applied@2", "prestige:applied@4"]);
  const directFacts: string[] = [];
  emitActionFacts(
    { onAction: (fact) => void directFacts.push(`${fact.actionId}:${fact.outcome}:${fact.reason ?? ""}@${fact.t}`) },
    7,
    [
      { type: "action.applied", actionId: "a" },
      { type: "action.skipped", actionId: "b", reason: "cooldown" },
    ],
  );
  expect(directFacts).toEqual(["a:applied:@7", "b:skipped:cooldown@7"]);
  emitActionFacts(undefined, 7, [{ type: "action.applied", actionId: "a" }]);

  // A strategy snapshot belongs to the strategy that wrote it.
  const buyAction: Action<number, "COIN", Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, bought: current.vars.bought + 1 } }),
  };
  const writerRng = makeRng(5);
  const written = executeResetCycles({
    scenario: scenario({ income: 0, actions: [buyAction, prestigeAction()], strategy: cursorStrategy(writerRng, "buy") }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    rng: writerRng,
  });
  expect(written.checkpoint.strategyId).toBe("cursor");
  expect(written.checkpoint.strategyStateVersion).toBe(1);
  const otherRng = makeRng(5);
  const other: Strategy<number, "COIN", Vars> = { ...cursorStrategy(otherRng, "buy"), id: "other-cursor" };
  expect(() =>
    executeResetCycles({
      scenario: scenario({ income: 0, actions: [buyAction, prestigeAction()], strategy: other }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: written.checkpoint,
      rng: otherRng,
    }),
  ).toThrow("was written by cursor@1");
  const bumpedRng = makeRng(5);
  const bumped: Strategy<number, "COIN", Vars> = { ...cursorStrategy(bumpedRng, "buy"), stateVersion: 2 };
  expect(() =>
    executeResetCycles({
      scenario: scenario({ income: 0, actions: [buyAction, prestigeAction()], strategy: bumped }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: written.checkpoint,
      rng: bumpedRng,
    }),
  ).toThrow("was written by cursor@1");
  // A restorable strategy resumed from a checkpoint without its snapshot would silently start over.
  const freshRng = makeRng(5);
  expect(() =>
    executeResetCycles({
      scenario: scenario({ strategy: cursorStrategy(freshRng, "buy") }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: none.checkpoint,
    }),
  ).toThrow("no strategyState for a strategy that restores one");

  // The horizon slack is rounding only: 995 then 5.0000005 seconds overshoots a 1000-second horizon.
  const overshoot = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "explicit", steps: [{ durationSec: 995 }, { durationSec: 5.0000005 }] },
    horizonSec: 1000,
  });
  expect(overshoot.artifact.appliedResets).toBe(1);
  expect(overshoot.artifact.status).toBe("censored");

  // Boundary events reach the scenario emitter, as a step's events do.
  const emitted: string[] = [];
  const emitting = scenario();
  executeResetCycles({
    scenario: {
      ...emitting,
      ctx: {
        ...emitting.ctx,
        emit: (events) => {
          for (const event of events) if (event.type === "action.applied") emitted.push(event.actionId);
        },
      },
    },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
  });
  expect(emitted).toEqual(["prestige", "prestige"]);

  // A caller's adapter named prestige.spec is not the spec adapter, so the model's multiplierFrom is not called.
  const namedLikeSpec: ResetAdapter<number, "COIN", Vars> = {
    id: "prestige.spec",
    kind: "prestige",
    preserved: ["points", "multiplier", "count"],
    action: () => prestigeAction(),
    reward: (_ctx, current) => current.prestige.points,
  };
  const impostor = executeResetCycles({
    scenario: scenario({
      actions: [],
      prestige: {
        pointsFrom: () => 1,
        multiplierFrom: () => {
          throw new Error("multiplierFrom must not run");
        },
        resetState: (_ctx, current) => current,
      },
    }),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    adapter: namedLikeSpec,
  });
  expect(impostor.artifact.appliedResets).toBe(1);

  // An interval the runner treats as already complete would commit resets without playing time, so it is rejected.
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 1e-13, cycles: 2 } }),
  ).toThrow("runner's 1e-12 second resolution");
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "explicit", steps: [{ durationSec: 1e-12 }] } }),
  ).toThrow("runner's 1e-12 second resolution");

  // A short interval at a horizon already reached is censored: the rounding slack stays below the interval.
  const reached = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 1e-9, cycles: 1 },
    horizonSec: 1e6,
    resume: { ...none.checkpoint, elapsedSec: 1e6 },
  });
  expect(reached.artifact.appliedResets).toBe(0);
  expect(reached.artifact.status).toBe("censored");
  // A checkpoint records its model, and another model is rejected.
  expect(none.checkpoint.modelId).toBe("reset-cycle");
  const otherModel = scenario();
  expect(() =>
    executeResetCycles({
      scenario: { ...otherModel, model: { ...otherModel.model, id: "other-model" } },
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: none.checkpoint,
    }),
  ).toThrow("belongs to model reset-cycle@1");
  // A nonfinite clock is rejected before a guard can stop early.
  expect(() =>
    executeResetCycles({
      scenario: scenario({ initial: state({ t: Number.NaN }) }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      maxCycles: 0,
    }),
  ).toThrow("clock fields must be finite");
  // A reset fact's wall time advances with reward time inside a session segment.
  const clockedBase = scenario();
  const clockedApply = applyDecisions({
    ctx: { ...clockedBase.ctx, clocks: { wallT: 100, wallEndT: 200, rewardT: 10, activeT: 0 } },
    model: clockedBase.model,
    state: state({ t: 15 }),
    decisions: [{ action: prestigeAction() }],
    resetKinds: new Set(["prestige"]),
    resolveAgainstModel: false,
  });
  expect(clockedApply.committedResets[0]?.wallT).toBe(105);
  // A caller's elapsed wall clock wins over the reward offset.
  const elapsedApply = applyDecisions({
    ctx: { ...clockedBase.ctx, clocks: { wallT: 100, wallEndT: 200, rewardT: 10, activeT: 0 } },
    model: clockedBase.model,
    state: state({ t: 15 }),
    decisions: [{ action: prestigeAction() }],
    resetKinds: new Set(["prestige"]),
    resolveAgainstModel: false,
    wallT: 104.9,
  });
  expect(elapsedApply.committedResets[0]?.wallT).toBe(104.9);

  // A budget-cut cycle resumes for its remaining seconds under the same index, as an uninterrupted run resets.
  const uninterrupted = executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 } });
  const cut = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
    budgetSteps: 5,
  });
  expect(cut.checkpoint.pendingSec).toBe(5);
  const finished = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
    resume: cut.checkpoint,
  });
  expect(finished.artifact.cycles[0]?.resetAtSec).toBe(uninterrupted.artifact.cycles[0]?.resetAtSec);
  expect(finished.artifact.cycles[0]?.index).toBe(0);
  expect(finished.artifact.cycles[0]?.durationSec).toBe(10);

  // A checkpoint accumulates one explicit adapter's reward, so another adapter is rejected on resume.
  const scoreAdapter: ResetAdapter<number, "COIN", Vars> = {
    id: "score",
    kind: "prestige",
    preserved: ["points", "multiplier", "count"],
    action: () => prestigeAction(),
    reward: (_ctx, current) => current.vars.score,
  };
  const pointsAdapter: ResetAdapter<number, "COIN", Vars> = { ...scoreAdapter, id: "points" };
  const scored = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    adapter: scoreAdapter,
  });
  expect(scored.checkpoint.adapterId).toBe("score");
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      adapter: pointsAdapter,
      resume: scored.checkpoint,
    }),
  ).toThrow("accumulates adapter score");

  // A prestige-declared adapter that returns a custom action still hides that action from the interval strategy.
  const sneaky: Action<number, "COIN", Vars> = {
    id: "sneaky-reset",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, score: current.vars.score + 1 } }),
  };
  const customTaker: Strategy<number, "COIN", Vars> = {
    id: "custom-taker",
    decide(ctx, model, current) {
      const action = model.actions(ctx, current).find((candidate) => candidate.id === "sneaky-reset");
      return action ? [{ action }] : [];
    },
  };
  const mislabeled = executeResetCycles({
    scenario: scenario({ actions: [sneaky], strategy: customTaker }),
    policy: { kind: "fixed-interval", intervalSec: 3, cycles: 1 },
    adapter: { ...scoreAdapter, action: () => sneaky },
  });
  expect(mislabeled.state.vars.score).toBe(1);

  // Observation off notifies no reset observer, at the boundary or in the runner.
  const silenced: string[] = [];
  const unobserved = scenario({
    observer: {
      onReset: () => void silenced.push("reset"),
      onAction: () => void silenced.push("action"),
    },
  });
  executeResetCycles({
    scenario: { ...unobserved, run: { ...unobserved.run, observation: { enabled: false } } },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
  });
  expect(silenced).toEqual([]);

  // A cut cycle resumes only under the duration it was planned with.
  expect(cut.checkpoint.pendingDurationSec).toBe(10);
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: cut.checkpoint,
    }),
  ).toThrow("cut a 10-second cycle, not a 2-second one");
  // An adapter must return a reset action, keep t, and report finite rewards.
  const buyReset: ResetAdapter<number, "COIN", Vars> = {
    ...scoreAdapter,
    id: "buy-reset",
    action: () => ({ id: "buy", kind: "buy", canApply: () => true, cost: () => null, apply: (_ctx, current) => current }),
  };
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 }, adapter: buyReset }),
  ).toThrow("returned a buy action, not a reset");
  const timeTravel: ResetAdapter<number, "COIN", Vars> = {
    ...scoreAdapter,
    id: "time-travel",
    action: () => prestigeAction((current) => ({ ...current, t: current.t + 100 })),
  };
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 }, adapter: timeTravel }),
  ).toThrow("changed t from 2 to 102");
  const infiniteReward: ResetAdapter<number, "COIN", Vars> = {
    ...scoreAdapter,
    id: "infinite",
    reward: () => Number.POSITIVE_INFINITY,
  };
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 }, adapter: infiniteReward }),
  ).toThrow("reward is not finite");
  // The boundary reset's wallT is the clock's wall start plus the executor's elapsed seconds.
  const boundaryWalls: (number | null)[] = [];
  const clocked = scenario({ observer: { onReset: (fact) => void boundaryWalls.push(fact.wallT) } });
  executeResetCycles({
    scenario: { ...clocked, ctx: { ...clocked.ctx, clocks: { wallT: 1000, wallEndT: 2000, rewardT: 0, activeT: 0 } } },
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 2 },
  });
  expect(boundaryWalls).toEqual([1002, 1004]);

  // A resumed cut cycle keeps the start it had before the cut, so its span matches its duration.
  expect(cut.checkpoint.pendingStartSec).toBe(0);
  expect(finished.artifact.cycles[0]?.startSec).toBe(0);
  expect(finished.artifact.cycles[0]?.endSec).toBe(10);
  // Finite deltas that sum past the number range are rejected, not stored as Infinity.
  const huge: ResetAdapter<number, "COIN", Vars> = {
    ...scoreAdapter,
    id: "huge",
    action: () => prestigeAction((current) => ({ ...current, vars: { ...current.vars, score: 1e308 } })),
  };
  const zeroing = scenario({ actions: [] });
  expect(() =>
    executeResetCycles({
      scenario: { ...zeroing, model: { ...zeroing.model, evolve: (_ctx, current) => ({ ...current, vars: { ...current.vars, score: 0 } }) } },
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 3 },
      adapter: huge,
    }),
  ).toThrow("accumulated reward is not finite");
  // A rejected boundary announces no action to observers or the emitter.
  const announced: string[] = [];
  const announcedScenario = scenario({ observer: { onAction: () => void announced.push("action") } });
  expect(() =>
    executeResetCycles({
      scenario: { ...announcedScenario, ctx: { ...announcedScenario.ctx, emit: (events) => void announced.push(...events.map((event) => event.type).filter((type) => type.startsWith("action"))) } },
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      adapter: timeTravel,
    }),
  ).toThrow("changed t");
  expect(announced).toEqual([]);
  // Elapsed seconds in a checkpoint cannot be negative.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      horizonSec: 10,
      resume: { ...scored.checkpoint, adapterId: undefined, adapterKind: undefined, elapsedSec: -100 },
    }),
  ).toThrow("elapsedSec must be >= 0");
  // A checkpoint that runs no cycle keeps its cut-cycle metadata.
  const rewritten = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
    maxCycles: 0,
    resume: cut.checkpoint,
  });
  expect(rewritten.checkpoint.pendingDurationSec).toBe(10);
  expect(rewritten.checkpoint.pendingStartSec).toBe(0);
  // The resumed cycle index must be an integer >= 0.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: { ...cut.checkpoint, nextIndex: Number.NaN },
    }),
  ).toThrow("nextIndex must be an integer >= 0");
  // A rejected checkpoint restores neither the strategy nor the RNG.
  const restores: string[] = [];
  const watchedRng: ResetCycleRng = { id: "lcg", stateVersion: 1, snapshot: () => 0, restore: () => void restores.push("rng") };
  const watchedStrategy: Strategy<number, "COIN", Vars> = {
    id: "watched",
    decide: () => [],
    snapshotState: () => 0,
    restoreState: () => void restores.push("strategy"),
  };
  expect(() =>
    executeResetCycles({
      scenario: scenario({ strategy: watchedStrategy }),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: { ...cut.checkpoint, strategyId: "watched", strategyState: 0, rngState: 0, accumulatedReward: Number.NaN },
      rng: watchedRng,
    }),
  ).toThrow("accumulatedReward is not finite");
  expect(restores).toEqual([]);
  // An RNG snapshot belongs to the generator that wrote it.
  const namedRng = { ...makeRng(1), id: "lcg", stateVersion: 1 };
  const seededCut = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    rng: namedRng,
  });
  expect(seededCut.checkpoint.rngId).toBe("lcg");
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      resume: seededCut.checkpoint,
      rng: { ...makeRng(1), id: "other", stateVersion: 1 },
    }),
  ).toThrow("rngState was written by lcg@1, not other@1");
  // An adapter whose reset is unavailable at the boundary is a refusal, not a missing adapter.
  const unavailable = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
    adapter: { ...scoreAdapter, id: "unavailable", action: () => undefined },
  });
  expect(unavailable.artifact.cycles[0]?.resetSkippedReason).toBe("cannot-apply");
  // An RNG without an id and a stateVersion cannot checkpoint its opaque snapshot.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
      rng: { snapshot: () => 0, restore: () => undefined } as unknown as ResetCycleRng,
    }),
  ).toThrow("rng needs an id and a stateVersion");
  // The horizon slack never covers a visible share of the interval, even where the ULP-based bound is seconds.
  const farHorizon = executeResetCycles({
    scenario: scenario(),
    policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
    horizonSec: 1e15,
    resume: { ...none.checkpoint, elapsedSec: 999999999999995 },
  });
  expect(farHorizon.artifact.appliedResets).toBe(0);
  expect(farHorizon.artifact.status).toBe("censored");
  // A reset that leaves a nonfinite prestige count is rejected, not written to the row.
  const nanCount: ResetAdapter<number, "COIN", Vars> = {
    ...scoreAdapter,
    id: "nan-count",
    action: () => prestigeAction((current) => ({ ...current, prestige: { ...current.prestige, count: Number.NaN } })),
  };
  expect(() =>
    executeResetCycles({ scenario: scenario(), policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 }, adapter: nanCount }),
  ).toThrow("left nonfinite prestige fields");
  // A committed reset reaches onAction before onReset, online and offline, as at a reset-cycle boundary.
  const order: string[] = [];
  const takePrestige: Strategy<number, "COIN", Vars> = {
    id: "take-prestige",
    decide: (ctx, model, current) => model.actions(ctx, current).map((action) => ({ action })),
  };
  const ordered = scenario({
    strategy: takePrestige,
    observer: { onAction: () => void order.push("action"), onReset: () => void order.push("reset") },
  });
  runScenario(ordered);
  expect(order).toEqual(["action", "reset"]);
  order.length = 0;
  applyOfflineSeconds({ scenario: ordered, seconds: 1 });
  expect(order).toEqual(["action", "reset"]);
  // The boundary wallT stays within the segment's wall end.
  const cappedWalls: (number | null)[] = [];
  const segment = scenario({ observer: { onReset: (fact) => void cappedWalls.push(fact.wallT) } });
  executeResetCycles({
    scenario: { ...segment, ctx: { ...segment.ctx, clocks: { wallT: 1000, wallEndT: 1002, rewardT: 0, activeT: 0 } } },
    policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
  });
  expect(cappedWalls).toEqual([1002]);
  // A cut cycle has played less than its planned duration.
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
      resume: { ...cut.checkpoint, pendingSec: 11 },
    }),
  ).toThrow("pendingSec must be less than pendingDurationSec");
  const { pendingDurationSec: _legacyDuration, ...legacyCut } = cut.checkpoint;
  expect(() =>
    executeResetCycles({
      scenario: scenario(),
      policy: { kind: "fixed-interval", intervalSec: 10, cycles: 1 },
      resume: { ...legacyCut, pendingSec: 10 },
    }),
  ).toThrow("played 10 seconds of a 10-second cycle");
  // An RNG identity must be a nonempty id and a finite version.
  for (const bad of [{ id: "", stateVersion: 1 }, { id: "lcg", stateVersion: Number.NaN }]) {
    expect(() =>
      executeResetCycles({
        scenario: scenario(),
        policy: { kind: "fixed-interval", intervalSec: 2, cycles: 1 },
        rng: { ...makeRng(1), ...bad },
      }),
    ).toThrow("rng needs an id and a stateVersion");
  }
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
