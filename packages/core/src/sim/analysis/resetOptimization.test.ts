import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import { sessionActiveBlocks } from "../session";
import type { Strategy } from "../strategy/types";
import type { Action, CompiledScenario, Model, SimState } from "../types";
import { analyzePrestigeCycle } from "./prestigeCycle";
import type { ResetAdapter } from "./resetCycle";
import {
  analyzeResetPolicies,
  resetPolicyAlgorithmVersion,
  resetPolicyEmpiricalStability,
  resetPolicyJsonSchema,
  resetPolicyRecoveryCrossing,
  resetPolicyRewardRate,
  resetPolicySchemaId,
  resetPolicyScanRank,
  resetPolicySessionReset,
  validateResetPolicyArtifact,
  type ResetPolicyRequest,
} from "./resetOptimization";

type Vars = { generators: number };

const unit = { code: "COIN" as const };
const knownSolution = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../../../fixtures/conformance/reset-policy-rate.json"), "utf8"),
) as { id: string; expectedRate: string; denominator: string };

function state(args?: {
  t?: number;
  money?: number;
  points?: number;
  multiplier?: number;
  count?: number;
  generators?: number;
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
    vars: { generators: args?.generators ?? 0 },
  };
}

function coin(amount: number) {
  return { unit, amount };
}

function scenario(args?: {
  income?: (current: SimState<number, "COIN", Vars>) => number;
  evolve?: Model<number, "COIN", Vars>["evolve"];
  actions?: readonly Action<number, "COIN", Vars>[];
  initial?: SimState<number, "COIN", Vars>;
  multiplierStep?: number;
}): CompiledScenario<number, "COIN", Vars> {
  const E = createNumberEngine();
  const step = args?.multiplierStep ?? 0;
  const actions = args?.actions ?? [
    {
      id: "prestige",
      kind: "prestige" as const,
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, current) => ({
        ...current,
        prestige: {
          count: current.prestige.count + 1,
          points: current.prestige.points + 1,
          multiplier: current.prestige.multiplier + step,
        },
      }),
    },
  ];
  const model: Model<number, "COIN", Vars> = {
    id: "reset-policy",
    version: 1,
    income: (_ctx, current) => coin(args?.income?.(current) ?? 1),
    actions: () => actions,
    ...(args?.evolve ? { evolve: args.evolve } : {}),
  };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model,
    initial: args?.initial ?? state(),
    run: { stepSec: 1, durationSec: 1 },
  };
}

function plainPrestige(): Action<number, "COIN", Vars> {
  const base = scenario();
  const action = base.model.actions(base.ctx, base.initial)[0];
  if (!action) throw new Error("fixture prestige action");
  return action;
}

function withModel(
  base: CompiledScenario<number, "COIN", Vars>,
  patch: Partial<Model<number, "COIN", Vars>>,
): CompiledScenario<number, "COIN", Vars> {
  return { ...base, model: { ...base.model, ...patch } };
}

const twiceDaily = { pattern: { id: "twice-daily" as const, days: 1 }, resetDelaySec: 0 };

function baseRequest(
  createScenario: ResetPolicyRequest<number, "COIN", Vars>["createScenario"],
  patch?: Partial<ResetPolicyRequest<number, "COIN", Vars>>,
): ResetPolicyRequest<number, "COIN", Vars> {
  return {
    createScenario,
    scan: { fromSec: 10, toSec: 10, stepSec: 10 },
    horizonSec: 45,
    cycleBudget: 8,
    objective: "cumulative-reset-reward",
    recovery: { metric: "pre-reset-income" },
    stability: { minObservedCycles: 4, windows: [2, 4], absoluteTolerance: "0", relativeTolerance: 0 },
    knownSolution: { fixtureId: knownSolution.id, expectedRate: knownSolution.expectedRate },
    ...patch,
  };
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate Opening stock stays out of the rate, and the tail is unrealized.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-reward-rate #9ef48a3 Re-read the section: realized reward is 4, the rate is 0.1, and interval 20 realizes 2.
 * @evidence ./resetOptimization.ts#resetPolicyRewardRate Reads the reward-rate denominator.
 * @evidenceReview ./resetOptimization.ts#resetPolicyRewardRate #d0158e9 The declaration is completed-cycle-time-denominator.
 * @evidence ./resetOptimization.ts#validateResetPolicyArtifact The canonical artifact validates.
 * @evidenceReview ./resetOptimization.ts#validateResetPolicyArtifact #02be060 The arrow builds typia.createValidate of ResetPolicyArtifactV1 on first call and reuses it.
 * @evidence ./resetOptimization.ts#analyzeResetPolicies Runs the always-active scan against the fixture rate.
 * @evidenceReview ./resetOptimization.ts#analyzeResetPolicies #614b9c2 The function keeps scanned intervals within toSec up to rounding dust, validates the request, distinct stability windows, a goal for goal-reach-sec, and a finite nonnegative absolute tolerance, evaluates each scanned interval with or without a session, resolving the reset adapter at each boundary under the live constraints and, on a schedule, the block's clocks, hiding prestige actions and the custom reset from the strategy, committing adapter actions without re-resolving them against model.actions, refreshing maxMoneyEver, reading goals on copies of every committed state, each scheduled reset state included, under ids no caller goal uses, reading net worth and income with the live context, playing the tail from the origin-relative horizon, and on a schedule applying offline progression, session clocks, and the full schedule after the budget, measuring cycles in wall time, starting the incomplete span at the last reset, and dry-running the unrealized reset only when active play reaches the horizon, ranks with Engine.cmp, compares a known solution, keeps a refused interval in the incomplete span, reports an incomplete winner or one without stability evidence in the artifact status, and never claims a global optimum. On a schedule it admits a reset at the horizon inside a block's natural span, reads the end state at the horizon after a long delay, forwards boundary action facts, and reports goal and recovery times in wall seconds.
 * @evidence ./resetOptimization.ts#resetPolicySchemaId Reads the reset policy schema id.
 * @evidenceReview ./resetOptimization.ts#resetPolicySchemaId #1dcacc7 The function returns the reset.policy.v1 schema URL constant.
 * @evidence ./resetOptimization.ts#resetPolicyAlgorithmVersion Reads the algorithm version on the artifact.
 * @evidenceReview ./resetOptimization.ts#resetPolicyAlgorithmVersion #0a7c8c5 The function returns the reset policy algorithm version constant.
 */
export function matchesTheoreticalRewardRate(): void {
  expect(resetPolicyRewardRate).toBe("completed-cycle-time-denominator");
  expect(knownSolution.denominator).toBe("completed-cycle-time");
  expect(knownSolution.expectedRate).toBe("0.1");
  const openings: number[] = [];
  const canonical = analyzeResetPolicies(
    baseRequest(() => {
      const initial = state({ points: 100, money: 50 });
      openings.push(initial.prestige.points);
      return scenario({ initial });
    }),
  );
  expect(canonical.schemaVersion).toBe(1);
  expect(canonical.algorithmVersion).toBe(resetPolicyAlgorithmVersion());
  expect(resetPolicySchemaId()).toBe("https://idlekit.dev/schemas/reset.policy.v1.schema.json");
  expect(canonical.globalOptimum).toBe(false);
  expect(canonical.best.comparison.scope).toBe("scan-range");
  expect(canonical.best.comparison.globalOptimum).toBe(false);
  expect(canonical.best.session.assumed).toBe("always-active");
  expect(canonical.best.objective).toEqual({ kind: "cumulative-reset-reward", reading: "flow", value: "4" });
  expect(canonical.best.observation.provedSteadyState).toBe(false);
  expect(canonical.best.observation.stability).toBe("stable");
  const row = canonical.candidates[0];
  expect(row?.realizedReward).toBe("4");
  expect(row?.rewardRate).toBe("0.1");
  expect(row?.rewardRateDenominator).toBe("completed-cycle-time");
  expect(row?.unrealizedReward).toBe("1");
  expect(row?.incomplete).toEqual({ startSec: 40, endSec: 45, durationSec: 5 });
  expect(row?.finalPoints).toBe("104");
  expect(row?.finalNetWorth).toBe("95");
  expect(row?.completedCycles).toBe(4);
  expect(row?.recovery).toEqual({ metric: "pre-reset-income", status: "observed", seconds: 0, threshold: "1" });
  expect(row?.recovery.seconds).not.toBe(Math.min(10, 45));
  expect(row?.stability.provedSteadyState).toBe(false);
  expect(row?.stability.windows).toEqual([2, 4]);
  expect(row?.stability.horizonSec).toBe(45);
  expect(canonical.knownSolution).toEqual({
    fixtureId: "constant-reset-reward",
    expectedRate: "0.1",
    observedRate: "0.1",
    matches: true,
  });
  expect(validateResetPolicyArtifact(canonical).success).toBe(true);
  expect("breakEvenSec" in canonical).toBe(false);
  expect(canonical.candidates.every((candidate) => !("breakEvenSec" in candidate))).toBe(true);
  expect(openings.every((points) => points === 100)).toBe(true);

  const compared = analyzeResetPolicies(
    baseRequest(
      () => scenario({ initial: state({ points: 100, money: 50 }) }),
      {
        scan: { fromSec: 10, toSec: 20, stepSec: 10 },
        horizonSec: 40,
        knownSolution: undefined,
      },
    ),
  );
  expect(compared.best.intervalSec).toBe(10);
  expect(compared.best.objective.value).toBe("4");
  expect(compared.candidates.map((candidate) => candidate.realizedReward)).toEqual(["4", "2"]);
  expect(compared.candidates.map((candidate) => candidate.finalPoints)).toEqual(["104", "102"]);
  expect(compared.candidates.every((candidate) => candidate.finalNetWorth === "90")).toBe(true);

  const legacy = analyzePrestigeCycle({
    scenario: scenario(),
    scan: { fromSec: 10, toSec: 10, stepSec: 10 },
    horizonSec: 45,
    cycles: 4,
    objective: "pointsPerHour",
  });
  expect(legacy.best.breakEvenSec).toBe(Math.min(10, 45));
  expect(legacy.best.stability).toBe("drifting");

  // A prestige action unlocked by the interval's earnings is resolved at the boundary, not at the opening state.
  const prestige = plainPrestige();
  const gated = analyzeResetPolicies(
    baseRequest(
      () => withModel(scenario(), { actions: (_ctx, current) => (current.wallet.money.amount >= 5 ? [prestige] : []) }),
      { knownSolution: undefined },
    ),
  );
  expect(gated.candidates[0]?.status).toBe("ok");
  expect(gated.candidates[0]?.completedCycles).toBe(4);
  expect(gated.candidates[0]?.recovery.status).toBe("observed");

  // A spec adapter's action is not in model.actions. It still commits in recovery and on a schedule.
  const specOnly = () =>
    withModel(scenario({ actions: [] }), {
      prestige: {
        pointsFrom: () => 1,
        multiplierFrom: () => 1,
        resetState: (_ctx, current, gained) => ({
          ...current,
          prestige: { count: current.prestige.count + 1, points: current.prestige.points + gained, multiplier: 1 },
        }),
      },
    });
  const specActive = analyzeResetPolicies(baseRequest(specOnly, { knownSolution: undefined }));
  expect(specActive.candidates[0]?.completedCycles).toBe(4);
  expect(specActive.candidates[0]?.recovery.status).toBe("observed");
  expect(specActive.candidates[0]?.unrealizedReward).toBe("1");
  const specSession = analyzeResetPolicies(
    baseRequest(specOnly, {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: twiceDaily,
      knownSolution: undefined,
    }),
  );
  expect(specSession.candidates[0]?.completedCycles).toBe(3);
  expect(specSession.candidates[0]?.realizedReward).toBe("3");

  // A strategy that would prestige on every step commits nothing outside the policy's own resets.
  const greedy: Strategy<number, "COIN", Vars> = {
    id: "greedy",
    decide(ctx, model, current) {
      const action = model.actions(ctx, current).find((candidate) => candidate.kind === "prestige");
      return action ? [{ action }] : [];
    },
  };
  const suppressed = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario(), strategy: greedy }), { knownSolution: undefined }),
  );
  expect(suppressed.candidates[0]?.completedCycles).toBe(4);
  expect(suppressed.candidates[0]?.finalPoints).toBe("4");
  const suppressedSession = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario(), strategy: greedy }), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: twiceDaily,
      knownSolution: undefined,
    }),
  );
  expect(suppressedSession.candidates[0]?.finalPoints).toBe("3");

  // horizonSec is elapsed time from the scenario origin, so a later origin still plays its tail.
  const later = analyzeResetPolicies(
    baseRequest(() => scenario({ initial: state({ t: 100 }) }), { knownSolution: undefined }),
  );
  expect(later.candidates[0]?.completedCycles).toBe(4);
  expect(later.candidates[0]?.incomplete).toEqual({ startSec: 140, endSec: 145, durationSec: 5 });
  expect(later.candidates[0]?.finalNetWorth).toBe("45");
  expect(later.candidates[0]?.recovery.status).toBe("observed");

  // The unrealized dry run sees the cooldown the committed resets left.
  const cooled = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario(), constraints: { minPrestigeIntervalSec: 10 } }), { knownSolution: undefined }),
  );
  expect(cooled.candidates[0]?.completedCycles).toBe(4);
  expect(cooled.candidates[0]?.unrealizedReward).toBe("0");

  // A winner that was refused partway is incomplete, and so is the artifact.
  const refusing = analyzeResetPolicies(
    baseRequest(
      () =>
        scenario({
          actions: [{ ...prestige, canApply: (_ctx, current) => current.prestige.count < 2 }],
        }),
      { knownSolution: undefined },
    ),
  );
  expect(refusing.candidates[0]?.status).toBe("incomplete");
  expect(refusing.candidates[0]?.completedCycles).toBe(2);
  expect(refusing.status).toBe("incomplete");
  // The refused interval is part of the span after the last committed reset.
  expect(refusing.candidates[0]?.incomplete).toEqual({ startSec: 20, endSec: 45, durationSec: 25 });
  expect(validateResetPolicyArtifact(refusing).success).toBe(true);

  // Net worth is read with the live constraints, as the simulation reads them.
  const anchoredWorth = analyzeResetPolicies(
    baseRequest(
      () =>
        withModel(scenario(), {
          netWorth: (ctx, current) => coin(current.wallet.money.amount + (ctx.constraints?.lastPrestigeResetT ?? 0)),
        }),
      { objective: "final-net-worth", knownSolution: undefined },
    ),
  );
  expect(anchoredWorth.candidates[0]?.finalNetWorth).toBe("85");
  // A caller goal that shares the analysis goal's id does not stand in for the request's goal.
  const shadowed = analyzeResetPolicies(
    baseRequest(
      () => {
        const base = scenario();
        return { ...base, run: { ...base.run, goals: [{ id: "reset-policy.goal", met: () => true }] } };
      },
      { objective: "goal-reach-sec", goal: () => false, knownSolution: undefined },
    ),
  );
  expect(shadowed.candidates[0]?.goalReachSec).toBeNull();
  expect(shadowed.candidates[0]?.goalStatus).toBe("censored");
  // The last goal read is on a copy, so a predicate that writes its argument cannot change the reported state.
  const writer = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      goal: (_ctx, current) => {
        (current.prestige as { points: number }).points = 999;
        return false;
      },
      knownSolution: undefined,
    }),
  );
  expect(writer.candidates[0]?.finalPoints).toBe("4");
  // A custom reset adapter does not let the strategy commit prestige resets during an interval.
  const rebirth: Action<number, "COIN", Vars> = {
    id: "rebirth",
    kind: "custom",
    canApply: () => true,
    cost: () => null,
    apply: (_ctx, current) => ({ ...current, vars: { generators: current.vars.generators + 1 } }),
  };
  const rebirthAdapter: ResetAdapter<number, "COIN", Vars> = {
    id: "rebirth",
    kind: "custom",
    preserved: ["vars"],
    action: () => rebirth,
    reward: (_ctx, current) => current.vars.generators,
  };
  const customPolicy = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario({ actions: [plainPrestige(), rebirth] }), strategy: greedy }), {
      adapter: rebirthAdapter,
      knownSolution: undefined,
    }),
  );
  expect(customPolicy.candidates[0]?.completedCycles).toBe(4);
  expect(customPolicy.candidates[0]?.finalPoints).toBe("0");
  // A huge step does not admit an interval past toSec through a share of the step.
  const wideScan = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      scan: { fromSec: 1e12, toSec: 2e12 - 1000, stepSec: 1e12 },
      horizonSec: 10,
      knownSolution: undefined,
    }),
  );
  expect(wideScan.best.comparison.candidateCount).toBe(1);
  expect(wideScan.candidates.map((candidate) => candidate.intervalSec)).toEqual([1e12]);
  // A goal objective needs a goal, and the absolute tolerance is a finite amount >= 0.
  expect(() =>
    analyzeResetPolicies(baseRequest(() => scenario(), { objective: "goal-reach-sec", knownSolution: undefined })),
  ).toThrow("goal-reach-sec needs a goal predicate");
  expect(() =>
    analyzeResetPolicies(
      baseRequest(() => scenario(), {
        stability: { minObservedCycles: 4, windows: [2, 4], absoluteTolerance: "-1", relativeTolerance: 0 },
        knownSolution: undefined,
      }),
    ),
  ).toThrow("absoluteTolerance must be a finite amount >= 0");
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-empirical-stability Count, drift, and oscillation are different observation states.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-empirical-stability #3acf06e Re-read the section: six rising cycles are drifting, alternating rewards oscillate, and two cycles are insufficient.
 * @evidence ./resetOptimization.ts#resetPolicyEmpiricalStability Reads the empirical stability contract.
 * @evidenceReview ./resetOptimization.ts#resetPolicyEmpiricalStability #86f894b The declaration is window-tolerance-not-cycle-count.
 */
export function separatesEmpiricalStability(): void {
  expect(resetPolicyEmpiricalStability).toBe("window-tolerance-not-cycle-count");
  const drifting = analyzeResetPolicies(
    baseRequest(() => scenario({ multiplierStep: 1, initial: state() }), {
      scan: { fromSec: 10, toSec: 10, stepSec: 10 },
      horizonSec: 60,
      cycleBudget: 6,
      stability: { minObservedCycles: 5, windows: [3, 5], absoluteTolerance: "0", relativeTolerance: 0 },
      knownSolution: undefined,
    }),
  );
  expect(drifting.candidates[0]?.completedCycles).toBe(6);
  expect(drifting.candidates[0]?.realizedReward).toBe("6");
  expect(drifting.best.observation.stability).toBe("drifting");
  expect(drifting.best.observation.stability).not.toBe("stable");
  expect(drifting.best.observation.provedSteadyState).toBe(false);
  expect(drifting.candidates[0]?.stability).toMatchObject({
    kind: "empirical",
    windows: [3, 5],
    absoluteTolerance: "0",
    relativeTolerance: 0,
    horizonSec: 60,
    provedSteadyState: false,
  });

  const alternating = analyzeResetPolicies(
    baseRequest(
      () =>
        scenario({
          actions: [
            {
              id: "prestige",
              kind: "prestige",
              canApply: () => true,
              cost: () => null,
              apply: (_ctx, current) => ({
                ...current,
                prestige: {
                  count: current.prestige.count + 1,
                  points: current.prestige.points + (current.prestige.count % 2 === 0 ? 1 : 3),
                  multiplier: 1,
                },
              }),
            },
          ],
        }),
      {
        horizonSec: 80,
        cycleBudget: 8,
        stability: { minObservedCycles: 5, windows: [3, 5], absoluteTolerance: "0", relativeTolerance: 0 },
        knownSolution: undefined,
      },
    ),
  );
  expect(alternating.candidates[0]?.completedCycles).toBe(8);
  expect(alternating.best.observation.stability).toBe("oscillating");
  expect(alternating.best.observation.provedSteadyState).toBe(false);

  const sparse = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      horizonSec: 20,
      cycleBudget: 2,
      stability: { minObservedCycles: 5, windows: [2, 4], absoluteTolerance: "0", relativeTolerance: 0 },
      knownSolution: undefined,
    }),
  );
  expect(sparse.candidates[0]?.completedCycles).toBe(2);
  expect(sparse.best.observation.stability).toBe("insufficient-data");
  // Missing stability evidence reaches the artifact status, not only the best candidate.
  expect(sparse.status).toBe("insufficient-data");
  // Two copies of one window are one window.
  expect(() =>
    analyzeResetPolicies(
      baseRequest(() => scenario(), {
        stability: { minObservedCycles: 2, windows: [2, 2], absoluteTolerance: "0", relativeTolerance: 0 },
        knownSolution: undefined,
      }),
    ),
  ).toThrow("windows must be distinct");
  expect(sparse.best.observation.stability).not.toBe("stable");
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-recovery-crossing The crossing is 25 seconds, and a miss is censored.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-recovery-crossing #28b60db Re-read the section: horizon 80 reports 25, and horizon 20 does not report min(interval, horizon).
 * @evidence ./resetOptimization.ts#resetPolicyRecoveryCrossing Reads the recovery contract.
 * @evidenceReview ./resetOptimization.ts#resetPolicyRecoveryCrossing #085f724 The declaration is threshold-crossing-or-censored.
 */
export function reportsRecoveryCrossing(): void {
  expect(resetPolicyRecoveryCrossing).toBe("threshold-crossing-or-censored");
  const climb = (): CompiledScenario<number, "COIN", Vars> =>
    scenario({
      initial: state({ generators: 25 }),
      income: (current) => current.vars.generators,
      evolve: (_ctx, current, dt) => {
        if (current.vars.generators >= 25) return current;
        return { ...current, vars: { generators: Math.min(25, current.vars.generators + dt) } };
      },
      actions: [
        {
          id: "prestige",
          kind: "prestige",
          canApply: () => true,
          cost: () => null,
          apply: (_ctx, current) => ({
            ...current,
            vars: { generators: 0 },
            prestige: {
              count: current.prestige.count + 1,
              points: current.prestige.points + 1,
              multiplier: current.prestige.multiplier,
            },
          }),
        },
      ],
    });
  const observed = analyzeResetPolicies(
    baseRequest(climb, {
      horizonSec: 80,
      cycleBudget: 1,
      stability: { minObservedCycles: 5, windows: [2, 4], absoluteTolerance: "0", relativeTolerance: 0 },
      knownSolution: undefined,
    }),
  );
  expect(observed.candidates[0]?.recovery.seconds).toBe(25);
  expect(observed.candidates[0]?.recovery.status).toBe("observed");
  expect(observed.candidates[0]?.recovery.threshold).toBe("25");
  expect(observed.candidates[0]?.recovery.seconds).not.toBe(Math.min(10, 80));

  const censored = analyzeResetPolicies(
    baseRequest(climb, {
      horizonSec: 20,
      cycleBudget: 1,
      stability: { minObservedCycles: 5, windows: [2, 4], absoluteTolerance: "0", relativeTolerance: 0 },
      knownSolution: undefined,
    }),
  );
  expect(censored.candidates[0]?.recovery.status).toBe("censored");
  expect(censored.candidates[0]?.recovery.seconds).toBeNull();
  expect(censored.candidates[0]?.recovery.seconds).not.toBe(Math.min(10, 20));
  expect("breakEvenSec" in censored).toBe(false);

  // A scheduled candidate measures recovery from its own first reset, deferred here from wall 2000 to 43200.
  const windfallReset = (): CompiledScenario<number, "COIN", Vars> =>
    scenario({
      actions: [
        {
          id: "prestige",
          kind: "prestige",
          canApply: () => true,
          cost: () => null,
          apply: (_ctx, current) => ({
            ...current,
            wallet: { ...current.wallet, money: coin(0) },
            prestige: { ...current.prestige, count: current.prestige.count + 1, points: current.prestige.points + 1 },
          }),
        },
      ],
    });
  const scheduled = analyzeResetPolicies(
    baseRequest(windfallReset, {
      scan: { fromSec: 2000, toSec: 2000, stepSec: 2000 },
      horizonSec: 172800,
      cycleBudget: 1,
      recovery: { metric: "pre-reset-net-worth" },
      session: { pattern: { id: "twice-daily", days: 2 }, resetDelaySec: 0 },
      knownSolution: undefined,
    }),
  );
  expect(scheduled.candidates[0]?.resetWallTimes).toEqual([43200]);
  expect(scheduled.candidates[0]?.recovery).toEqual({
    metric: "pre-reset-net-worth",
    status: "observed",
    seconds: 43200,
    threshold: "43200",
  });
  // Recovery is wall seconds: a reset delay and a capped absence count in full, not only the credited seconds.
  const delayedRecovery = analyzeResetPolicies(
    baseRequest(() => ({ ...windfallReset(), run: { stepSec: 1, durationSec: 1, offline: { maxSec: 100 } } }), {
      scan: { fromSec: 2000, toSec: 2000, stepSec: 2000 },
      horizonSec: 172800,
      cycleBudget: 1,
      recovery: { metric: "pre-reset-net-worth" },
      session: { pattern: { id: "twice-daily", days: 2 }, resetDelaySec: 500 },
      knownSolution: undefined,
    }),
  ).candidates[0];
  expect(delayedRecovery?.resetWallTimes).toEqual([43200]);
  expect(delayedRecovery?.recovery).toEqual({
    metric: "pre-reset-net-worth",
    status: "observed",
    seconds: 43700,
    threshold: "1900",
  });
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset Manual resets stay inside twice-daily blocks.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset #0ea6f15 Re-read the section: wall 2000 is skipped, and delay 500 commits 400, 900, and 1400.
 * @evidence ./resetOptimization.ts#resetPolicySessionReset Reads the session reset contract.
 * @evidenceReview ./resetOptimization.ts#resetPolicySessionReset #b288402 The declaration is manual-reset-only-while-active.
 * @evidence ../session.ts#sessionActiveBlocks Reads the active blocks of the twice-daily preset.
 * @evidenceReview ../session.ts#sessionActiveBlocks #59d346c The function rejects a day count that is not a positive integer and returns the preset or explicit schedule blocks that simulateSessionPattern uses.
 */
export function keepsManualResetInsideSession(): void {
  expect(resetPolicySessionReset).toBe("manual-reset-only-while-active");
  const blocks = sessionActiveBlocks({ id: "twice-daily", days: 1 });
  const inside = (wall: number) =>
    blocks.some((block) => {
      const start = block.day * 86400 + block.startOffsetSec;
      return wall >= start && wall < start + block.durationSec;
    });
  const deferred = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      scan: { fromSec: 2000, toSec: 2000, stepSec: 2000 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: { pattern: { id: "twice-daily", days: 1 }, resetDelaySec: 0 },
      knownSolution: undefined,
    }),
  );
  expect(deferred.best.session).toEqual({ assumed: "scheduled", patternId: "twice-daily", resetDelaySec: 0 });
  expect(deferred.candidates[0]?.resetWallTimes).toEqual([43200]);
  expect(deferred.candidates[0]?.resetWallTimes.includes(2000)).toBe(false);
  expect(deferred.candidates[0]?.resetWallTimes.every(inside)).toBe(true);

  const delayed = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: { pattern: { id: "twice-daily", days: 1 }, resetDelaySec: 500 },
      knownSolution: undefined,
    }),
  );
  expect(delayed.best.session.resetDelaySec).toBe(500);
  expect(delayed.candidates[0]?.resetWallTimes).toEqual([400, 900, 1400]);
  expect(delayed.candidates[0]?.resetWallTimes.every(inside)).toBe(true);
  expect(delayed.candidates[0]?.resetWallTimes.includes(800)).toBe(false);
  // A scheduled cycle lasts from the previous reset wall to this one, the caller's delay included.
  expect(delayed.candidates[0]?.rewardRate).toBe(String(3 / 1400));

  // The cycle budget stops resets, not the schedule. Offline gaps keep the default full offline credit.
  const budgetRun = (cycleBudget: number) =>
    analyzeResetPolicies(
      baseRequest(() => scenario(), {
        scan: { fromSec: 400, toSec: 400, stepSec: 400 },
        horizonSec: 86400,
        cycleBudget,
        session: twiceDaily,
        knownSolution: undefined,
      }),
    ).candidates[0];
  expect(budgetRun(1)?.completedCycles).toBe(1);
  expect(budgetRun(1)?.finalNetWorth).toBe("86400");
  expect(budgetRun(3)?.finalNetWorth).toBe("86400");
  // An offline cap limits the credit of each gap, as simulateSessionPattern applies it.
  const capped = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario(), run: { stepSec: 1, durationSec: 1, offline: { maxSec: 100 } } }), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 1,
      session: twiceDaily,
      knownSolution: undefined,
    }),
  ).candidates[0];
  expect(capped?.finalNetWorth).toBe(String(1800 + 100 + 1800 + 100));

  // A model that reads session clocks gets them in every active block of the schedule.
  const seenClocks: number[] = [];
  analyzeResetPolicies(
    baseRequest(
      () =>
        withModel(scenario(), {
          clocks: { respondsTo: ["wall"] },
          income: (ctx) => {
            if (ctx.clocks) seenClocks.push(ctx.clocks.wallT);
            return coin(1);
          },
        }),
      { scan: { fromSec: 400, toSec: 400, stepSec: 400 }, horizonSec: 86400, cycleBudget: 3, session: twiceDaily, knownSolution: undefined },
    ),
  );
  expect(seenClocks.length).toBeGreaterThan(0);
  expect(seenClocks.some((wall) => wall >= 43200)).toBe(true);

  // A boundary adapter sees the anchor of the previous reset, and a reward-granting reset refreshes maxMoneyEver.
  const anchors: (number | undefined)[] = [];
  const windfall: Action<number, "COIN", Vars> = {
    ...plainPrestige(),
    apply: (_ctx, current) => ({
      ...current,
      wallet: { ...current.wallet, money: coin(current.wallet.money.amount + 1000) },
      prestige: { ...current.prestige, count: current.prestige.count + 1, points: current.prestige.points + 1 },
    }),
  };
  const watching: ResetAdapter<number, "COIN", Vars> = {
    id: "watching",
    kind: "prestige",
    preserved: ["points", "multiplier", "count"],
    action: (ctx) => {
      anchors.push(ctx.constraints?.lastPrestigeResetT);
      return windfall;
    },
    reward: (_ctx, current) => current.prestige.points,
  };
  const anchored = analyzeResetPolicies(
    baseRequest(() => scenario({ actions: [windfall] }), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: twiceDaily,
      adapter: watching,
      objective: "goal-reach-sec",
      goal: (_ctx, current) => current.maxMoneyEver.amount >= 1000,
      knownSolution: undefined,
    }),
  );
  expect(anchored.candidates[0]?.resetWallTimes).toEqual([400, 800, 1200]);
  // The horizon falls in the offline span after the evening block, so no reset is dry-run there.
  expect(anchors.filter((anchor) => anchor !== undefined)).toEqual([400, 800]);
  expect(anchored.candidates[0]?.unrealizedReward).toBe("0");
  const alwaysOn = analyzeResetPolicies(
    baseRequest(() => scenario(), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: { pattern: { id: "always-on", days: 1 }, resetDelaySec: 0 },
      knownSolution: undefined,
    }),
  ).candidates[0];
  expect(alwaysOn?.unrealizedReward).toBe("1");
  // A scheduled incomplete span starts at the last committed reset.
  const shortOn = (patch: Partial<ResetPolicyRequest<number, "COIN", Vars>>, create = () => scenario()) =>
    analyzeResetPolicies(
      baseRequest(create, {
        scan: { fromSec: 10, toSec: 10, stepSec: 10 },
        horizonSec: 45,
        session: { pattern: { id: "always-on", days: 1 }, resetDelaySec: 0 },
        knownSolution: undefined,
        ...patch,
      }),
    ).candidates[0];
  expect(shortOn({})?.incomplete).toEqual({ startSec: 40, endSec: 45, durationSec: 5 });
  // A reset delay that runs past the horizon is not active play, so no reset is dry-run there.
  const delayedPast = shortOn({
    scan: { fromSec: 400, toSec: 400, stepSec: 400 },
    horizonSec: 1000,
    session: { pattern: { id: "always-on", days: 1 }, resetDelaySec: 500 },
  });
  expect(delayedPast?.resetWallTimes).toEqual([400, 900]);
  expect(delayedPast?.unrealizedReward).toBe("0");
  // A model that lists its reset only inside a clocked block is resolved with the block's clocks.
  const clockGated = shortOn({}, () =>
    withModel(scenario(), {
      clocks: { respondsTo: ["wall"] },
      actions: (ctx) => (ctx.clocks ? [plainPrestige()] : []),
    }),
  );
  expect(clockGated?.status).toBe("ok");
  expect(clockGated?.completedCycles).toBe(4);
  // Back-to-back resets with no runner between them still read the goal on each committed reset state.
  const toggle: Action<number, "COIN", Vars> = {
    ...plainPrestige(),
    apply: (_ctx, current) => ({
      ...current,
      vars: { generators: current.prestige.count % 2 === 0 ? 1 : 0 },
      prestige: { ...current.prestige, count: current.prestige.count + 1 },
    }),
  };
  const backToBack = shortOn(
    {
      scan: { fromSec: 100, toSec: 100, stepSec: 100 },
      horizonSec: 1000,
      cycleBudget: 2,
      session: { pattern: { id: "always-on", days: 1 }, resetDelaySec: 200 },
      objective: "goal-reach-sec",
      goal: (_ctx, current) => current.vars.generators === 1,
    },
    () => scenario({ actions: [toggle] }),
  );
  expect(backToBack?.completedCycles).toBe(2);
  expect(backToBack?.goalReachSec).toBe(100);

  // A reset exactly at the horizon is still inside an always-on block, as the always-active executor commits it.
  const atHorizon = shortOn({ horizonSec: 40 });
  expect(atHorizon?.resetWallTimes).toEqual([10, 20, 30, 40]);
  expect(atHorizon?.completedCycles).toBe(4);

  // A reset delay that runs past the horizon does not move the final reads past it.
  const clockedWorth = shortOn(
    {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 1000,
      session: { pattern: { id: "always-on", days: 1 }, resetDelaySec: 500 },
    },
    () =>
      withModel(scenario(), {
        clocks: { respondsTo: ["wall"] },
        netWorth: (ctx) => coin(ctx.clocks?.wallT ?? -1),
      }),
  );
  expect(clockedWorth?.resetWallTimes).toEqual([400, 900]);
  expect(clockedWorth?.finalNetWorth).toBe("1000");

  // Scheduled boundary decisions reach onAction, as the executor's do.
  const actionFacts: string[] = [];
  shortOn({}, () => {
    const base = scenario();
    return {
      ...base,
      run: { ...base.run, observer: { onAction: (fact) => void actionFacts.push(`${fact.actionId}:${fact.outcome}@${fact.t}`) } },
    };
  });
  expect(actionFacts).toEqual(["prestige:applied@10", "prestige:applied@20", "prestige:applied@30", "prestige:applied@40"]);

  // Goal times are wall seconds. A capped absence credits 100 reward seconds for a 41400-second gap.
  const cappedGoal = analyzeResetPolicies(
    baseRequest(() => ({ ...scenario(), run: { stepSec: 1, durationSec: 1, offline: { maxSec: 100 } } }), {
      scan: { fromSec: 400, toSec: 400, stepSec: 400 },
      horizonSec: 86400,
      cycleBudget: 3,
      session: twiceDaily,
      objective: "goal-reach-sec",
      goal: (_ctx, current) => current.wallet.money.amount >= 2000,
      knownSolution: undefined,
    }),
  ).candidates[0];
  expect(cappedGoal?.goalReachSec).toBe(43300);
  expect(anchored.candidates[0]?.goalReachSec).toBe(400);

  expect(() => sessionActiveBlocks({ id: "twice-daily", days: 0 })).toThrow("session days must be a positive integer");
  expect(() =>
    analyzeResetPolicies(
      baseRequest(() => scenario(), {
        session: { pattern: { id: "twice-daily", days: Number.NaN }, resetDelaySec: 0 },
        knownSolution: undefined,
      }),
    ),
  ).toThrow("session days must be a positive integer");
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank Engine compare ranks the scan, and a missed goal is not a filled-in time.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-scan-rank #468d46d Re-read the section: the larger infinite reward wins, and horizon 15 does not report 15.
 * @evidence ./resetOptimization.ts#resetPolicyScanRank Reads the scan ranking contract.
 * @evidenceReview ./resetOptimization.ts#resetPolicyScanRank #98e3aaa The declaration is engine-compare-scan-range.
 * @evidence ./resetOptimization.ts#resetPolicyJsonSchema The schema is OpenAPI 3.1.
 * @evidenceReview ./resetOptimization.ts#resetPolicyJsonSchema #e706162 The function memoizes typia.json.schema of ResetPolicyArtifactV1.
 */
export function ranksScanWithoutNumberCollapse(): void {
  expect(resetPolicyScanRank).toBe("engine-compare-scan-range");
  let called = false;
  const guard = (): ResetPolicyRequest<number, "COIN", Vars> =>
    baseRequest(() => {
      called = true;
      return scenario();
    });
  expect(() => analyzeResetPolicies({ ...guard(), scan: { fromSec: 10, toSec: 20, stepSec: 0 } })).toThrow(
    /scan\.stepSec/,
  );
  expect(() => analyzeResetPolicies({ ...guard(), scan: { fromSec: 10, toSec: 20, stepSec: -1 } })).toThrow(
    /scan\.stepSec/,
  );
  expect(() => analyzeResetPolicies({ ...guard(), horizonSec: Number.POSITIVE_INFINITY })).toThrow(/horizonSec/);
  expect(() => analyzeResetPolicies({ ...guard(), cycleBudget: 0 })).toThrow(/cycleBudget/);
  expect(called).toBe(false);

  const E = createBreakInfinityEngine();
  const zero = E.zero();
  const bigUnit = { code: "COIN" as const };
  const big = analyzeResetPolicies({
    createScenario: () => {
      const initial: SimState<ReturnType<typeof E.zero>, "COIN", Vars> = {
        t: 0,
        wallet: { money: { unit: bigUnit, amount: zero }, bucket: zero },
        maxMoneyEver: { unit: bigUnit, amount: zero },
        prestige: { count: 0, points: zero, multiplier: E.from(1) },
        vars: { generators: 0 },
      };
      const model: Model<ReturnType<typeof E.zero>, "COIN", Vars> = {
        id: "huge-reset",
        version: 1,
        income: () => ({ unit: bigUnit, amount: E.from("1e400") }),
        actions: () => [
          {
            id: "prestige",
            kind: "prestige",
            canApply: () => true,
            cost: () => null,
            apply: (_ctx, current) => ({
              ...current,
              wallet: { money: { unit: bigUnit, amount: E.zero() }, bucket: E.zero() },
              maxMoneyEver: { unit: bigUnit, amount: E.zero() },
              prestige: {
                count: current.prestige.count + 1,
                points: E.add(current.prestige.points, current.wallet.money.amount),
                multiplier: E.from(1),
              },
            }),
          },
        ],
      };
      return {
        ctx: { E, unit: bigUnit, tickPolicy: { mode: "drop" }, stepSec: 1 },
        model,
        initial,
        run: { stepSec: 1, durationSec: 1 },
      };
    },
    scan: { fromSec: 10, toSec: 20, stepSec: 10 },
    horizonSec: 20,
    cycleBudget: 1,
    objective: "cumulative-reset-reward",
    recovery: { metric: "pre-reset-net-worth" },
    stability: { minObservedCycles: 5, windows: [2, 4], absoluteTolerance: "0", relativeTolerance: 0 },
  });
  expect(big.best.intervalSec).toBe(20);
  expect(big.best.comparison.globalOptimum).toBe(false);
  expect(big.best.comparison.scope).toBe("scan-range");
  expect(big.best.session.assumed).toBe("always-active");
  expect(big.best.objective.kind).toBe("cumulative-reset-reward");
  expect(big.best.observation.provedSteadyState).toBe(false);
  const early = big.candidates[0];
  const later = big.candidates[1];
  expect(early && later).toBeTruthy();
  if (!early || !later) return;
  expect(E.toNumber(E.from(early.realizedReward))).toBe(Number.POSITIVE_INFINITY);
  expect(E.toNumber(E.from(later.realizedReward))).toBe(Number.POSITIVE_INFINITY);
  expect(E.cmp(E.from(later.realizedReward), E.from(early.realizedReward))).toBe(1);
  expect(big.scope).toBe("scan-range");
  expect(resetPolicyJsonSchema().version).toBe("3.1");

  const goal = analyzeResetPolicies(
    baseRequest(() => scenario({ initial: state({ points: 0, money: 0 }) }), {
      scan: { fromSec: 10, toSec: 20, stepSec: 10 },
      horizonSec: 40,
      objective: "goal-reach-sec",
      goal: (_ctx, current) => current.prestige.points >= 1,
      knownSolution: undefined,
    }),
  );
  expect(goal.best.intervalSec).toBe(10);
  expect(goal.best.objective).toEqual({ kind: "goal-reach-sec", reading: "time", value: "10" });
  expect(goal.candidates.map((candidate) => candidate.goalReachSec)).toEqual([10, 20]);

  const missed = analyzeResetPolicies(
    baseRequest(() => scenario({ initial: state({ points: 0, money: 0 }) }), {
      scan: { fromSec: 20, toSec: 20, stepSec: 20 },
      horizonSec: 15,
      objective: "goal-reach-sec",
      goal: (_ctx, current) => current.prestige.points >= 1,
      knownSolution: undefined,
    }),
  );
  expect(missed.status).toBe("censored");
  expect(missed.candidates[0]?.goalReachSec).toBeNull();
  expect(missed.best.objective.value).toBe("censored");
  expect(missed.best.objective.value).not.toBe("15");

  // A goal met between resets keeps its own time, and a reset that clears the goal resource does not hide it.
  const midway = analyzeResetPolicies(
    baseRequest(
      () =>
        scenario({
          actions: [
            {
              id: "prestige",
              kind: "prestige",
              canApply: () => true,
              cost: () => null,
              apply: (_ctx, current) => ({
                ...current,
                wallet: { ...current.wallet, money: coin(0) },
                prestige: { ...current.prestige, count: current.prestige.count + 1 },
              }),
            },
          ],
        }),
      {
        horizonSec: 40,
        objective: "goal-reach-sec",
        goal: (_ctx, current) => current.wallet.money.amount >= 5,
        knownSolution: undefined,
      },
    ),
  );
  expect(midway.candidates[0]?.goalReachSec).toBe(5);
  expect(midway.best.objective.value).toBe("5");

  const unsupported = analyzeResetPolicies(
    baseRequest(() => scenario({ actions: [], initial: state() }), { knownSolution: undefined }),
  );
  expect(unsupported.status).toBe("unsupported");
  expect(unsupported.best.comparison.candidateCount).toBe(1);
}

describe("reset policy analysis", () => {
  it("matches the theoretical reset reward rate", matchesTheoreticalRewardRate, 60000);
  it("separates empirical stability from cycle count", separatesEmpiricalStability);
  it("reports the recovery crossing or censors it", reportsRecoveryCrossing, 60000);
  it("keeps a manual reset inside the active session", keepsManualResetInsideSession, 60000);
  it("ranks the scan with engine compare", ranksScanWithoutNumberCollapse);
});
