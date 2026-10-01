import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import { sessionActiveBlocks } from "../session";
import type { Action, CompiledScenario, Model, SimState } from "../types";
import { analyzePrestigeCycle } from "./prestigeCycle";
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
 * @evidenceReview ./resetOptimization.ts#analyzeResetPolicies #ef528b0 The function validates the request, evaluates each scanned interval with or without a session, ranks with Engine.cmp, compares a known solution, and reports a scan-range artifact that never claims a global optimum.
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
}

/**
 * @evidence docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset Manual resets stay inside twice-daily blocks.
 * @evidenceReview docs/requirements/active/reset-cycle-analysis.md#req-pr11-session-reset #0ea6f15 Re-read the section: wall 2000 is skipped, and delay 500 commits 400, 900, and 1400.
 * @evidence ./resetOptimization.ts#resetPolicySessionReset Reads the session reset contract.
 * @evidenceReview ./resetOptimization.ts#resetPolicySessionReset #b288402 The declaration is manual-reset-only-while-active.
 * @evidence ../session.ts#sessionActiveBlocks Reads the active blocks of the twice-daily preset.
 * @evidenceReview ../session.ts#sessionActiveBlocks #bccb8d5 The function returns the preset or explicit schedule blocks that simulateSessionPattern uses.
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

  const unsupported = analyzeResetPolicies(
    baseRequest(() => scenario({ actions: [], initial: state() }), { knownSolution: undefined }),
  );
  expect(unsupported.status).toBe("unsupported");
  expect(unsupported.best.comparison.candidateCount).toBe(1);
}

describe("reset policy analysis", () => {
  it("matches the theoretical reset reward rate", matchesTheoreticalRewardRate);
  it("separates empirical stability from cycle count", separatesEmpiricalStability);
  it("reports the recovery crossing or censors it", reportsRecoveryCrossing);
  it("keeps a manual reset inside the active session", keepsManualResetInsideSession);
  it("ranks the scan with engine compare", ranksScanWithoutNumberCollapse);
});
